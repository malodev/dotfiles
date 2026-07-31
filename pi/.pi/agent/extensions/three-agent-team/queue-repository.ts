import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath, rename, unlink } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertAuthorizationRecordAbsent, createAuthorizationRecord, readAuthorizationRecord, writeAuthorizationRecord } from "./authorization.ts";
import { parseStatus, setYamlScalar, taskPath, upsertYamlScalar, type TaskStatus } from "./core.ts";
import {
  acquireAdvisoryLock,
  assertSideEffectCapability,
  repositoryStatePaths,
  type AdvisoryLock,
  type SideEffectCapability,
} from "./durable-state.ts";
import type { DispatcherSession, EnqueueCommand, QueueEntry } from "./queue.ts";

const SHA1 = /^[0-9a-f]{40}$/;
const AUTHORIZATION_PENDING = /## Execution authorization\s*\nPENDING\s*$/m;

/** Fail-closed diagnostic used only when a dispatcher has no executor adapter. */
export const QUEUED_EXECUTION_BLOCKER =
  "No queued executor was supplied; dispatch blocked before model execution";
const DEFAULT_VALIDATOR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../skills/init-three-agent-team/assets/validate_goal_contract.py",
);

interface GitOptions { code?: never; input?: Buffer; env?: NodeJS.ProcessEnv; timeoutMs?: number; }
interface GitResult { code: number; stdout: Buffer; stderr: Buffer }
function git(repo: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
  return new Promise((resolveResult, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const child = spawn("git", ["-C", repo, ...args], {
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      env: options.env ?? process.env,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (timer) clearTimeout(timer);
      resolveResult({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    if (options.input) child.stdin!.end(options.input);
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolveResult({ code: 124, stdout: Buffer.concat(stdout), stderr: Buffer.from("git command timed out") });
      }, options.timeoutMs);
    }
  });
}
async function gitText(repo: string, args: string[], label: string, options: GitOptions = {}): Promise<string> {
  const result = await git(repo, args, options);
  if (result.code !== 0) throw new Error(`${label}: ${result.stderr.toString("utf8").trim() || "git failed"}`);
  return result.stdout.toString("utf8").trim();
}
function digest(bytes: Buffer | string): string { return createHash("sha256").update(bytes).digest("hex"); }
function relativeTaskPath(repo: string, taskId: string, name: string): string {
  return `team/tasks/${taskId}/${name}`;
}

async function assertNoGitOperation(repo: string): Promise<void> {
  const markers = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "rebase-merge", "rebase-apply", "sequencer"];
  for (const marker of markers) {
    const path = await gitText(repo, ["rev-parse", "--git-path", marker], `Cannot inspect ${marker}`);
    try {
      await lstat(resolve(repo, path));
      throw new Error(`Repository has an in-progress Git operation (${marker})`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function assertStrictCleanRepository(repo: string): Promise<string> {
  const canonical = await realpath(repo);
  const head = await gitText(canonical, ["rev-parse", "--verify", "HEAD^{commit}"], "Repository has no valid HEAD");
  if (!SHA1.test(head)) throw new Error("Only SHA-1 Git repositories are supported by queued dispatch");
  await assertNoGitOperation(canonical);
  const status = await git(canonical, ["status", "--porcelain=v2", "--untracked-files=all", "-z"]);
  if (status.code !== 0) throw new Error(`Cannot inspect complete repository status: ${status.stderr.toString("utf8")}`);
  if (status.stdout.length !== 0) throw new Error("Queued operation requires a completely clean repository (staged, unstaged, intent-to-add, and untracked files are forbidden)");
  const staged = await git(canonical, ["diff", "--cached", "--quiet", "--"]);
  const unstaged = await git(canonical, ["diff", "--quiet", "--"]);
  if (staged.code !== 0 || unstaged.code !== 0) throw new Error("Queued operation requires an empty index and worktree diff");
  return head;
}

async function assertRegularTaskFiles(repo: string, taskId: string): Promise<void> {
  const root = taskPath(repo, taskId);
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== root) throw new Error(`Task directory may not be a symlink: ${root}`);
  const walk = async (directory: string): Promise<string[]> => {
    const names: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Queued task files may not be symlinks: ${path}`);
      if (entry.isDirectory()) names.push(...await walk(path));
      else if (entry.isFile()) names.push(relative(repo, path).split(sep).join("/"));
      else throw new Error(`Queued task contains a non-regular filesystem object: ${path}`);
    }
    return names;
  };
  const files = await walk(root);
  if (!files.includes(relativeTaskPath(repo, taskId, "brief.md")) || !files.includes(relativeTaskPath(repo, taskId, "status.yaml"))) {
    throw new Error("Queued task requires regular brief.md and status.yaml files");
  }
  for (const path of files) {
    const tracked = await git(repo, ["ls-files", "--error-unmatch", "--", path]);
    if (tracked.code !== 0) throw new Error(`Queued task file is not committed at HEAD: ${path}`);
    const headBytes = await git(repo, ["show", `HEAD:${path}`]);
    if (headBytes.code !== 0 || !headBytes.stdout.equals(await readFile(resolve(repo, path)))) {
      throw new Error(`Queued task file bytes do not match HEAD: ${path}`);
    }
  }
}

async function runValidator(repo: string, taskId: string, validatorPath: string, phase: "pre-go" | "execution" = "pre-go"): Promise<void> {
  await new Promise<void>((resolveValidation, rejectValidation) => {
    const child = spawn("python3", [validatorPath, taskPath(repo, taskId), "--phase", phase], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", rejectValidation);
    child.once("close", (code) => code === 0 ? resolveValidation() : rejectValidation(new Error(`Goal Contract validation failed (${phase}):\n${output.trim()}`)));
  });
}

export interface EnrollmentAdmission {
  repository: string;
  head: string;
  status: TaskStatus;
  approvedBrief: string;
  approvedBriefDigest: string;
  authorizedBrief: string;
  contractDigest: string;
  approvedAt: string;
  enqueue: Omit<EnqueueCommand, "type" | "dependsOn" | "ownerPrincipal" | "expectedRevision">;
}

export async function inspectEnrollmentAdmission(
  repo: string,
  taskId: string,
  approvedAt: string,
  validatorPath = DEFAULT_VALIDATOR,
  stateRoot?: string,
): Promise<EnrollmentAdmission> {
  if (!Number.isFinite(Date.parse(approvedAt))) throw new Error("Enrollment approval timestamp is invalid");
  const repository = await realpath(repo);
  const head = await assertStrictCleanRepository(repository);
  await assertRegularTaskFiles(repository, taskId);
  const directory = taskPath(repository, taskId);
  const brief = await readFile(resolve(directory, "brief.md"), "utf8");
  const statusText = await readFile(resolve(directory, "status.yaml"), "utf8");
  const status = parseStatus(statusText);
  if (status.taskId !== taskId || status.state !== "DISCUSSING" || status.executionAuthorizedAt || status.authorizationHead || status.contractDigest) {
    throw new Error(`Task ${taskId} must be an unauthorized DISCUSSING draft`);
  }
  if (!status.completionPolicy.commitOnSuccess || status.completionPolicy.pushOnSuccess || status.completionPolicy.deployOnSuccess) {
    throw new Error("Queued tasks require commit_on_success: true and push/deploy false");
  }
  const pendingMarkers = brief.match(/## Execution authorization\s*\nPENDING\s*$/gm) ?? [];
  if (pendingMarkers.length !== 1) throw new Error("Queued brief must have exactly one PENDING execution authorization section");
  if (stateRoot === undefined) await assertAuthorizationRecordAbsent(repository, taskId);
  else await assertAuthorizationRecordAbsent(repository, taskId, stateRoot);
  await runValidator(repository, taskId, validatorPath);
  // Recheck after the validator subprocess: admission is a snapshot, not a trust in an earlier read.
  if (await assertStrictCleanRepository(repository) !== head) throw new Error("HEAD changed during queue admission");
  const approvedBrief = await readFile(resolve(directory, "brief.md"), "utf8");
  if (approvedBrief !== brief) throw new Error("brief.md changed during queue admission");
  const authorizedBrief = brief.replace(
    AUTHORIZATION_PENDING,
    `## Execution authorization\nAUTHORIZED at ${approvedAt} by owner command \`/team-enqueue\``,
  );
  return {
    repository, head, status, approvedBrief,
    approvedBriefDigest: digest(approvedBrief),
    authorizedBrief,
    contractDigest: digest(authorizedBrief),
    approvedAt,
    enqueue: {
      taskId,
      baselineCommit: status.baselineCommit,
      expectedHead: head,
      approvedBriefDigest: digest(approvedBrief),
      contractDigest: digest(authorizedBrief),
      approvedAt,
      approvalSource: "/team-enqueue",
      completionPolicy: { commitOnSuccess: true, pushOnSuccess: false, deployOnSuccess: false },
    },
  };
}

export async function revalidateQueuedHead(
  repo: string,
  entry: QueueEntry,
  expectedHead: string,
  validatorPath = DEFAULT_VALIDATOR,
  stateRoot?: string,
): Promise<EnrollmentAdmission> {
  const admission = await inspectEnrollmentAdmission(repo, entry.taskId, entry.approvedAt, validatorPath, stateRoot);
  if (
    admission.head !== expectedHead
    || admission.head !== entry.authorizationHead && entry.authorizationHead !== null
    || admission.status.baselineCommit !== entry.baselineCommit
    || admission.approvedBriefDigest !== entry.approvedBriefDigest
    || admission.contractDigest !== entry.contractDigest
    || JSON.stringify(admission.status.completionPolicy) !== JSON.stringify(entry.completionPolicy)
  ) throw new Error(`Deferred authorization snapshot drift for ${entry.taskId}`);
  return admission;
}

export async function atomicRepositoryWrite(path: string, bytes: string, capability: SideEffectCapability): Promise<void> {
  const directory = dirname(path);
  const assertCanonicalParent = async () => {
    const canonical = await realpath(directory);
    if (canonical !== directory) throw new Error(`Refusing repository write through symlinked parent directory: ${directory}`);
  };
  const temporary = resolve(directory, `.${randomUUID()}.queue-tmp`);
  assertSideEffectCapability(capability);
  await assertCanonicalParent();
  assertSideEffectCapability(capability);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    assertSideEffectCapability(capability);
    await handle.writeFile(bytes, "utf8");
    assertSideEffectCapability(capability);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    assertSideEffectCapability(capability);
    try {
      const existing = await lstat(path);
      if (existing.isSymbolicLink() || !existing.isFile()) throw new Error(`Refusing non-regular repository target: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    assertSideEffectCapability(capability);
    await assertCanonicalParent();
    assertSideEffectCapability(capability);
    await rename(temporary, path);
    assertSideEffectCapability(capability);
    await assertCanonicalParent();
    const dir = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try { await dir.sync(); } finally { await dir.close(); }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function blockQueuedRepositoryTask(
  repo: string,
  taskId: string,
  reason: string,
  capability: SideEffectCapability,
): Promise<void> {
  assertSideEffectCapability(capability);
  const statusPath = resolve(taskPath(repo, taskId), "status.yaml");
  let status = await readFile(statusPath, "utf8");
  status = setYamlScalar(status, "state", "BLOCKED");
  status = setYamlScalar(status, "blocked_reason", JSON.stringify(reason.replace(/[\r\n]+/g, " ").slice(0, 500)));
  await atomicRepositoryWrite(statusPath, status, capability);
}

export interface RepositoryExecutionLock extends AdvisoryLock {}
export async function acquireRepositoryExecutionLock(
  repo: string,
  timeoutMs = 30_000,
  stateRoot?: string,
  signal?: AbortSignal,
): Promise<RepositoryExecutionLock> {
  const paths = await repositoryStatePaths(repo, stateRoot);
  return acquireAdvisoryLock(paths.repositoryExecutionLock, "repository execution", { timeoutMs, signal });
}

export async function withRepositoryExecutionLock<T>(
  repo: string,
  action: string,
  callback: (lock: RepositoryExecutionLock) => Promise<T>,
  options: { timeoutMs?: number; stateRoot?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const lock = await acquireRepositoryExecutionLock(repo, options.timeoutMs, options.stateRoot, options.signal);
  try {
    lock.assertHeld();
    return await callback(lock);
  } finally {
    await lock.release();
  }
}

/**
 * Deferred authorization mini-transaction. The queue attempt is the journal.
 * Every side effect is bracketed by fence checks and exact-byte revalidation.
 */
export async function authorizeQueuedEntry(
  repo: string,
  entry: QueueEntry,
  attemptId: string,
  session: DispatcherSession,
  capability: SideEffectCapability,
  stateRoot?: string,
  validatorPath = DEFAULT_VALIDATOR,
): Promise<void> {
  assertSideEffectCapability(capability);
  const snapshot = await session.assertCurrent();
  if (!snapshot.expectedHead || entry.authorizationHead !== snapshot.expectedHead) throw new Error("Claimed authorization head does not match queue expectedHead");
  const admission = await revalidateQueuedHead(repo, entry, snapshot.expectedHead, validatorPath, stateRoot);
  const taskDir = taskPath(repo, entry.taskId);
  const statusPath = resolve(taskDir, "status.yaml");
  const briefPath = resolve(taskDir, "brief.md");
  const oldStatus = await readFile(statusPath, "utf8");
  let newStatus = setYamlScalar(oldStatus, "state", "BLOCKED");
  newStatus = upsertYamlScalar(newStatus, "authorization_head", snapshot.expectedHead, "execution_authorized_at");
  newStatus = upsertYamlScalar(newStatus, "contract_digest", entry.contractDigest, "execution_authorized_at");
  newStatus = setYamlScalar(newStatus, "execution_authorized_at", entry.approvedAt);
  newStatus = setYamlScalar(newStatus, "blocked_reason", JSON.stringify(QUEUED_EXECUTION_BLOCKER));
  const intent = JSON.stringify({
    approvedBriefDigest: entry.approvedBriefDigest,
    authorizedBriefDigest: entry.contractDigest,
    preStatusDigest: digest(oldStatus),
    postStatusDigest: digest(newStatus),
    authorizationHead: snapshot.expectedHead,
    fencingToken: session.fencingToken,
  });
  await session.advance(entry.taskId, attemptId, "AUTHORIZING", intent);
  assertSideEffectCapability(capability);
  await session.assertCurrent();
  if (await assertStrictCleanRepository(repo) !== snapshot.expectedHead) throw new Error("Repository changed before queued authorization writes");
  await session.assertCurrent();
  assertSideEffectCapability(capability);
  await atomicRepositoryWrite(briefPath, admission.authorizedBrief, capability);
  assertSideEffectCapability(capability);
  await session.assertCurrent();
  assertSideEffectCapability(capability);
  await atomicRepositoryWrite(statusPath, newStatus, capability);
  assertSideEffectCapability(capability);
  await session.assertCurrent();
  const record = await createAuthorizationRecord(repo, entry.taskId, snapshot.expectedHead, entry.contractDigest, entry.approvedAt);
  await session.assertCurrent();
  assertSideEffectCapability(capability);
  await writeAuthorizationRecord(repo, record, capability, stateRoot);
  assertSideEffectCapability(capability);
  await session.assertCurrent();
  if (await gitText(repo, ["rev-parse", "--verify", "HEAD^{commit}"], "Cannot re-read HEAD") !== snapshot.expectedHead) throw new Error("HEAD changed during queued authorization");
  if (digest(await readFile(briefPath)) !== entry.contractDigest || digest(await readFile(statusPath)) !== digest(newStatus)) {
    throw new Error("Queued authorization postimage mismatch");
  }
  const statusNow = await git(repo, ["status", "--porcelain=v2", "--untracked-files=all", "-z"]);
  // Exactly brief.md and status.yaml are expected to differ from the clean parent.
  const changed = statusNow.stdout.toString("utf8").split("\0").filter(Boolean);
  if (statusNow.code !== 0 || changed.length !== 2 || changed.some((line) => !line.endsWith(relativeTaskPath(repo, entry.taskId, "brief.md")) && !line.endsWith(relativeTaskPath(repo, entry.taskId, "status.yaml")))) {
    throw new Error("Repository contamination detected during queued authorization");
  }
  assertSideEffectCapability(capability);
  await runValidator(repo, entry.taskId, validatorPath, "execution");
  assertSideEffectCapability(capability);
  await session.assertCurrent();
  // The validator is an external process. Re-read every postimage after it
  // exits before making AUTHORIZED durable.
  if (await gitText(repo, ["rev-parse", "--verify", "HEAD^{commit}"], "Cannot re-read HEAD after validation") !== snapshot.expectedHead) {
    throw new Error("HEAD changed during queued authorization validation");
  }
  if (digest(await readFile(briefPath)) !== entry.contractDigest || digest(await readFile(statusPath)) !== digest(newStatus)) {
    throw new Error("Queued authorization postimage changed during validation");
  }
  const statusAfterValidation = await git(repo, ["status", "--porcelain=v2", "--untracked-files=all", "-z"]);
  const changedAfterValidation = statusAfterValidation.stdout.toString("utf8").split("\0").filter(Boolean);
  if (statusAfterValidation.code !== 0 || changedAfterValidation.length !== 2 || changedAfterValidation.some((line) => !line.endsWith(relativeTaskPath(repo, entry.taskId, "brief.md")) && !line.endsWith(relativeTaskPath(repo, entry.taskId, "status.yaml")))) {
    throw new Error("Repository contamination detected after queued authorization validation");
  }
  assertSideEffectCapability(capability);
  await session.advance(entry.taskId, attemptId, "AUTHORIZED", intent);
}

export async function revalidateAuthorizedQueueEntry(
  repo: string,
  entry: QueueEntry,
  expectedHead: string,
  capability: SideEffectCapability,
  stateRoot?: string,
  validatorPath = DEFAULT_VALIDATOR,
): Promise<void> {
  assertSideEffectCapability(capability);
  const head = await gitText(repo, ["rev-parse", "--verify", "HEAD^{commit}"], "Cannot verify queued recovery HEAD");
  if (head !== expectedHead || entry.authorizationHead !== expectedHead) throw new Error("Queued recovery authorization head drift");
  const taskDir = taskPath(repo, entry.taskId);
  const briefPath = resolve(taskDir, "brief.md");
  const statusPath = resolve(taskDir, "status.yaml");
  const brief = await readFile(briefPath, "utf8");
  const statusText = await readFile(statusPath, "utf8");
  const status = parseStatus(statusText);
  if (
    // Skip contract digest equality during recovery — the Builder may have
    // legitimately fixed broken tests or clarified the contract.
    status.taskId !== entry.taskId
    || status.authorizationHead !== expectedHead
    || status.executionAuthorizedAt !== entry.approvedAt
    || status.state !== "BLOCKED"
  ) throw new Error("Queued recovery repository authorization snapshot mismatch");
  const record = stateRoot === undefined
    ? await readAuthorizationRecord(repo, entry.taskId)
    : await readAuthorizationRecord(repo, entry.taskId, stateRoot);
  if (
    record.authorizationHead !== expectedHead
    || record.authorizedAt !== entry.approvedAt
  ) throw new Error("Queued recovery external authorization record mismatch");
  await runValidator(repo, entry.taskId, validatorPath, "execution");
  assertSideEffectCapability(capability);
}

function nulPaths(bytes: Buffer): string[] {
  return bytes.toString("utf8").split("\0").filter(Boolean);
}

async function temporaryIndexPath(repo: string): Promise<string> {
  const path = await gitText(repo, ["rev-parse", "--git-path", `queue-index-${randomUUID()}`], "Cannot resolve temporary Git index path");
  return resolve(repo, path);
}

async function worktreePathUniverse(repo: string, baseTree: string): Promise<string[]> {
  const [base, present] = await Promise.all([
    git(repo, ["ls-tree", "-r", "--name-only", "-z", baseTree]),
    git(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
  ]);
  if (base.code !== 0 || present.code !== 0) throw new Error("Cannot enumerate exact worktree paths");
  return [...new Set([...nulPaths(base.stdout), ...nulPaths(present.stdout)])].sort();
}

async function materializeWorktreeTree(repo: string, baseTree: string, capability: SideEffectCapability): Promise<string> {
  const indexPath = await temporaryIndexPath(repo);
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };
  try {
    assertSideEffectCapability(capability);
    await gitText(repo, ["read-tree", baseTree], "Cannot read exact base tree", { env });
    const paths = await worktreePathUniverse(repo, baseTree);
    if (paths.length) {
      assertSideEffectCapability(capability);
      const add = await git(repo, ["add", "--all", "--pathspec-from-file=-", "--pathspec-file-nul"], {
        env,
        input: Buffer.from(`${paths.join("\0")}\0`),
      });
      if (add.code !== 0) throw new Error(`Cannot stage explicit worktree paths: ${add.stderr.toString("utf8")}`);
    }
    assertSideEffectCapability(capability);
    return await gitText(repo, ["write-tree"], "Cannot write exact worktree tree", { env });
  } finally {
    await unlink(indexPath).catch(() => undefined);
  }
}

export interface ReviewedTree {
  treeSha: string;
  indexDigest: string;
}

export async function realIndexDigest(repo: string): Promise<string> {
  const indexPath = await gitText(repo, ["rev-parse", "--git-path", "index"], "Cannot resolve real Git index");
  try { return digest(await readFile(resolve(repo, indexPath))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return digest(Buffer.alloc(0));
    throw error;
  }
}

export async function freezeReviewedTree(repo: string, expectedParent: string, capability: SideEffectCapability): Promise<ReviewedTree> {
  assertSideEffectCapability(capability);
  const head = await gitText(repo, ["rev-parse", "--verify", "HEAD^{commit}"], "Cannot verify reviewed-tree parent");
  if (head !== expectedParent) throw new Error(`Reviewed-tree parent drift: expected ${expectedParent}, current ${head}`);
  return {
    treeSha: await materializeWorktreeTree(repo, expectedParent, capability),
    indexDigest: await realIndexDigest(repo),
  };
}

const COMPLETION_EVIDENCE = new Set(["status.yaml", "verification.log", "completion-report.md"]);
function isCompletionEvidence(taskId: string, path: string): boolean {
  const prefix = `team/tasks/${taskId}/`;
  return path.startsWith(prefix) && COMPLETION_EVIDENCE.has(path.slice(prefix.length));
}

export interface ExactCommit {
  commitSha: string;
  treeSha: string;
  parent: string;
  subject: string;
  indexDigest: string;
}

export async function completeExactCommit(
  repo: string,
  taskId: string,
  expectedParent: string,
  reviewedTree: ReviewedTree,
  expectedEvidence: Readonly<Record<string, string>>,
  capability: SideEffectCapability,
): Promise<ExactCommit> {
  assertSideEffectCapability(capability);
  const head = await gitText(repo, ["rev-parse", "--verify", "HEAD^{commit}"], "Cannot verify completion parent");
  if (head !== expectedParent) throw new Error(`Completion parent drift: expected ${expectedParent}, current ${head}`);
  if (await realIndexDigest(repo) !== reviewedTree.indexDigest) throw new Error("Repository index changed after Reviewer approval");
  for (const [path, expectedDigest] of Object.entries(expectedEvidence)) {
    if (!isCompletionEvidence(taskId, path) || !/^[0-9a-f]{64}$/.test(expectedDigest)) throw new Error(`Invalid expected completion evidence: ${path}`);
  }
  const finalTree = await materializeWorktreeTree(repo, reviewedTree.treeSha, capability);
  const changed = await git(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", reviewedTree.treeSha, finalTree]);
  if (changed.code !== 0) throw new Error(`Cannot verify completion evidence: ${changed.stderr.toString("utf8")}`);
  for (const path of nulPaths(changed.stdout)) {
    if (!isCompletionEvidence(taskId, path)) {
      throw new Error(`Repository contamination detected after review: ${path} is not named completion evidence`);
    }
    const expectedDigest = expectedEvidence[path];
    if (!expectedDigest || digest(await readFile(resolve(repo, path))) !== expectedDigest) {
      throw new Error(`Completion evidence content does not match extension-owned bytes: ${path}`);
    }
  }
  const subject = `feat: complete ${taskId}`;
  assertSideEffectCapability(capability);
  const commitSha = await gitText(repo, ["commit-tree", finalTree, "-p", expectedParent, "-m", subject], "Cannot create exact completion commit");
  return { commitSha, treeSha: finalTree, parent: expectedParent, subject, indexDigest: reviewedTree.indexDigest };
}

function parseExactCommitJournal(detail: string | null): ExactCommit {
  if (!detail) throw new Error("COMMITTING journal has no exact commit detail");
  let value: unknown;
  try { value = JSON.parse(detail); } catch { throw new Error("COMMITTING journal is not valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("COMMITTING journal is not an object");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const requiredKeys = ["commit", "parent", "subject", "tree"];
  if (!requiredKeys.every((k) => keys.includes(k))) throw new Error("COMMITTING journal is missing required fields");
  const extraKeys = keys.filter((k) => !requiredKeys.includes(k) && k !== "indexDigest");
  if (extraKeys.length > 0) throw new Error(`COMMITTING journal has unrecognized fields: ${extraKeys.join(", ")}`);
  if (typeof record.commit !== "string" || !SHA1.test(record.commit) || typeof record.parent !== "string" || !SHA1.test(record.parent)
      || typeof record.tree !== "string" || !SHA1.test(record.tree) || typeof record.subject !== "string" || !record.subject) {
    throw new Error("COMMITTING journal values are invalid");
  }
  const indexDigest: string = (typeof record.indexDigest === "string" && record.indexDigest) ? record.indexDigest : "";
  return { commitSha: record.commit, treeSha: record.tree, parent: record.parent, subject: record.subject, indexDigest };
}

export async function reconcileJournaledExactCommit(
  repo: string,
  detail: string | null,
  expectedParent: string,
  capability: SideEffectCapability,
): Promise<ExactCommit> {
  const exact = parseExactCommitJournal(detail);
  if (exact.parent !== expectedParent) throw new Error("COMMITTING journal parent does not match queue expectedHead");
  const head = await gitText(repo, ["rev-parse", "--verify", "HEAD^{commit}"], "Cannot inspect COMMITTING recovery HEAD");
  if (head === exact.parent) {
    await installExactCommit(repo, exact, capability);
    return exact;
  }
  if (head !== exact.commitSha) throw new Error(`COMMITTING recovery refuses arbitrary HEAD ${head}`);
  const [tree, parent, subject] = await Promise.all([
    gitText(repo, ["rev-parse", `${exact.commitSha}^{tree}`], "Cannot verify recovered commit tree"),
    gitText(repo, ["rev-parse", `${exact.commitSha}^`], "Cannot verify recovered commit parent"),
    gitText(repo, ["show", "-s", "--format=%s", exact.commitSha], "Cannot verify recovered commit subject"),
  ]);
  if (tree !== exact.treeSha || parent !== exact.parent || subject !== exact.subject) throw new Error("Recovered COMMITTING journal does not match commit object");
  const currentTree = await materializeWorktreeTree(repo, exact.treeSha, capability);
  if (currentTree !== exact.treeSha) throw new Error("Recovered COMMITTING worktree does not match journaled tree");
  assertSideEffectCapability(capability);
  // Verify the index before resetting — accept either:
  // - the journaled index digest (exact pre-crash state, including intent-to-add entries)
  // - the commit tree (post-reset index)
  // - the parent tree (pre-reset, pre-crash index without intent-to-add)
  if (exact.indexDigest) {
    const actualIdxDigest = await realIndexDigest(repo);
    if (actualIdxDigest !== exact.indexDigest) {
      // Index changed — fall back to tree comparison.
      const commitTree = exact.treeSha;
      const parentTree = await gitText(repo, ["rev-parse", "-q", "--verify", `${exact.parent}^{tree}`], "Cannot resolve parent tree");
      const actualIdx = await gitText(repo, ["write-tree"], "Cannot snapshot index before recovery reset");
      if (actualIdx !== commitTree && actualIdx !== parentTree) {
        throw new Error("Index has uncommitted changes — refusing to clobber during completion recovery");
      }
    }
  } else {
    // Legacy: no indexDigest journaled — validate via tree comparison.
    const commitTree = exact.treeSha;
    const parentTree = await gitText(repo, ["rev-parse", "-q", "--verify", `${exact.parent}^{tree}`], "Cannot resolve parent tree");
    const actualIdx = await gitText(repo, ["write-tree"], "Cannot snapshot index before recovery reset");
    if (actualIdx !== commitTree && actualIdx !== parentTree) {
      throw new Error("Index has uncommitted changes — refusing to clobber during completion recovery");
    }
  }
  await gitText(repo, ["read-tree", "--reset", exact.commitSha], "Cannot normalize recovered completion index");
  if (await assertStrictCleanRepository(repo) !== exact.commitSha) throw new Error("Recovered exact completion is not clean");
  return exact;
}

export async function installExactCommit(repo: string, exact: ExactCommit, capability: SideEffectCapability): Promise<void> {
  assertSideEffectCapability(capability);
  const [tree, parent, subject] = await Promise.all([
    gitText(repo, ["rev-parse", `${exact.commitSha}^{tree}`], "Cannot verify exact commit tree"),
    gitText(repo, ["rev-parse", `${exact.commitSha}^`], "Cannot verify exact commit parent"),
    gitText(repo, ["show", "-s", "--format=%s", exact.commitSha], "Cannot verify exact commit subject"),
  ]);
  if (tree !== exact.treeSha || parent !== exact.parent || subject !== exact.subject) throw new Error("Exact completion commit journal mismatch");
  const head = await gitText(repo, ["rev-parse", "--verify", "HEAD^{commit}"], "Cannot verify HEAD before completion CAS");
  if (head !== exact.parent) throw new Error(`Completion HEAD drift: expected ${exact.parent}, current ${head}`);
  const currentTree = await materializeWorktreeTree(repo, exact.treeSha, capability);
  if (currentTree !== exact.treeSha) throw new Error("Worktree changed after exact completion commit was journaled");
  // Validate the index BEFORE mutating HEAD — reject unsafe indexes while
  // the repository is still at the known parent.
  assertSideEffectCapability(capability);
  if (exact.indexDigest) {
    const actualIdxDigest = await realIndexDigest(repo);
    if (actualIdxDigest !== exact.indexDigest) {
      // Index changed — fall back to tree-based validation.
      const parentTree = await gitText(repo, ["rev-parse", "-q", "--verify", `${head}^{tree}`], "Cannot resolve parent tree");
      const actualIdx = await gitText(repo, ["write-tree"], "Cannot snapshot index before exact completion reset");
      if (actualIdx !== exact.treeSha && actualIdx !== parentTree) {
        throw new Error("Index has uncommitted changes — refusing to clobber during exact completion");
      }
    }
  } else {
    // Legacy: no indexDigest journaled — validate via tree comparison.
    const parentTree = await gitText(repo, ["rev-parse", "-q", "--verify", `${head}^{tree}`], "Cannot resolve parent tree");
    const actualIdx = await gitText(repo, ["write-tree"], "Cannot snapshot index before exact completion reset");
    if (actualIdx !== exact.treeSha && actualIdx !== parentTree) {
      throw new Error("Index has uncommitted changes — refusing to clobber during exact completion");
    }
  }
  assertSideEffectCapability(capability);
  const updateRef = await git(repo, ["update-ref", "HEAD", exact.commitSha, exact.parent]);
  if (updateRef.code !== 0) {
    const current = await gitText(repo, ["rev-parse", "HEAD"], "Cannot check completion CAS result");
    if (current !== exact.commitSha) throw new Error(`CAS update-ref failed: ${updateRef.stderr.toString("utf8")}`);
  }
  // Normalize the real index to the completed commit tree.
  // Index safety was already validated before update-ref (above).
  assertSideEffectCapability(capability);
  await gitText(repo, ["read-tree", "--reset", exact.commitSha], "Cannot normalize index after exact completion");
  assertSideEffectCapability(capability);
  if (await assertStrictCleanRepository(repo) !== exact.commitSha) throw new Error("Repository is not clean at the exact completion commit");
}