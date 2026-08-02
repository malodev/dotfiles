import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  durableReplaceJson,
  ensureSecureDirectory,
  readSecureJson,
  repositoryStatePaths,
  type SideEffectCapability,
} from "./durable-state.ts";
import {
  assertStrictCleanRepository,
  atomicRepositoryWrite,
  createExactWorktreeCommit,
  inspectEnrollmentAdmission,
  installExactCommit,
  runValidator,
  type ExactCommit,
} from "./queue-repository.ts";
import { openDurableQueue, type AmendQueuedContractsCommand } from "./queue.ts";

const execFileAsync = promisify(execFile);
const ID = /^[a-z0-9][a-z0-9._-]*$/;

export interface QueuedContractTextEdit {
  path: string;
  oldText: string;
  newText: string;
}

export interface QueuedContractAmendmentSpec {
  amendmentId: string;
  taskIds: string[];
  edits: QueuedContractTextEdit[];
  subject: string;
}

interface AmendmentJournal {
  version: 1;
  amendmentId: string;
  phase: "PREPARED" | "GIT_INSTALLED" | "COMPLETED";
  exact: ExactCommit;
  command: AmendQueuedContractsCommand;
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function head(repo: string): Promise<string> {
  const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" });
  return result.stdout.trim();
}

function authorizedBrief(brief: string, approvedAt: string): string {
  const marker = /## Execution authorization\s*\nPENDING\s*$/m;
  if ((brief.match(new RegExp(marker.source, "gm")) ?? []).length !== 1) {
    throw new Error("Queued contract must contain exactly one PENDING authorization marker");
  }
  return brief.replace(marker, `## Execution authorization\nAUTHORIZED at ${approvedAt} by owner command \`/team-enqueue\``);
}

function parseJournal(value: unknown, amendmentId: string): AmendmentJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Queued amendment journal is invalid");
  const journal = value as AmendmentJournal;
  if (journal.version !== 1 || journal.amendmentId !== amendmentId || !["PREPARED", "GIT_INSTALLED", "COMPLETED"].includes(journal.phase)) {
    throw new Error("Queued amendment journal identity or phase is invalid");
  }
  return journal;
}

async function settleJournal(
  repo: string,
  journalPath: string,
  journal: AmendmentJournal,
  capability: SideEffectCapability,
  stateRoot?: string,
): Promise<{ commit: string; changed: boolean }> {
  capability.assertHeld();
  const currentHead = await head(repo);
  if (currentHead === journal.exact.parent) {
    await installExactCommit(repo, journal.exact, capability);
  } else if (currentHead !== journal.exact.commitSha) {
    throw new Error(`Queued amendment refuses unrelated HEAD ${currentHead}`);
  }
  if (journal.phase === "PREPARED") {
    journal = { ...journal, phase: "GIT_INSTALLED" };
    await durableReplaceJson(journalPath, journal, capability);
  }

  for (const amendment of journal.command.amendments) {
    const entry = (await openDurableQueue(repo, { stateRoot })).snapshot().then((snapshot) => snapshot.entries.find((candidate) => candidate.taskId === amendment.taskId));
    const queued = await entry;
    if (!queued) throw new Error(`Queued amendment lost task ${amendment.taskId}`);
    const admission = await inspectEnrollmentAdmission(repo, amendment.taskId, queued.approvedAt, undefined, stateRoot);
    if (admission.approvedBriefDigest !== amendment.approvedBriefDigest || admission.contractDigest !== amendment.contractDigest) {
      throw new Error(`Committed queued contract digest mismatch for ${amendment.taskId}`);
    }
  }

  const queue = await openDurableQueue(repo, { stateRoot });
  const result = await queue.command(journal.command);
  journal = { ...journal, phase: "COMPLETED" };
  await durableReplaceJson(journalPath, journal, capability);
  return { commit: journal.exact.commitSha, changed: result.changed };
}

export async function applyQueuedContractAmendment(
  repo: string,
  spec: QueuedContractAmendmentSpec,
  capability: SideEffectCapability,
  stateRoot?: string,
): Promise<{ commit: string; changed: boolean }> {
  capability.assertHeld();
  if (!ID.test(spec.amendmentId) || !spec.taskIds.length || new Set(spec.taskIds).size !== spec.taskIds.length) {
    throw new Error("Queued amendment identity or task list is invalid");
  }
  if (!spec.edits.length) throw new Error("Queued amendment requires text edits");
  const paths = await repositoryStatePaths(repo, stateRoot);
  const journalDir = resolve(paths.stateRoot, "queued-contract-amendments", paths.repositoryKey);
  await ensureSecureDirectory(journalDir);
  const journalPath = resolve(journalDir, `${spec.amendmentId}.json`);
  try {
    await access(journalPath);
    return await settleJournal(repo, journalPath, parseJournal(await readSecureJson(journalPath), spec.amendmentId), capability, stateRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const queue = await openDurableQueue(repo, { stateRoot });
  const snapshot = await queue.snapshot();
  const expectedHead = snapshot.expectedHead;
  if (!expectedHead || await head(repo) !== expectedHead) throw new Error("Queued amendment requires repository HEAD to equal queue expectedHead");
  if (await assertStrictCleanRepository(repo) !== expectedHead) throw new Error("Queued amendment requires an exact clean queue head");
  if (snapshot.dispatcherLease) throw new Error("Queued amendment requires an idle dispatcher");

  const taskSet = new Set(spec.taskIds);
  const entries = spec.taskIds.map((taskId) => {
    const entry = snapshot.entries.find((candidate) => candidate.taskId === taskId);
    if (!entry || entry.state !== "QUEUED" || entry.attempts.length || entry.authorizationHead) {
      throw new Error(`Queued amendment requires an unclaimed unauthorized task: ${taskId}`);
    }
    return entry;
  });

  const byPath = new Map<string, string>();
  for (const edit of spec.edits) {
    if (edit.path.startsWith("/") || edit.path.split("/").includes("..")) throw new Error(`Unsafe queued amendment path: ${edit.path}`);
    let text = byPath.get(edit.path) ?? await readFile(resolve(repo, edit.path), "utf8");
    const count = text.split(edit.oldText).length - 1;
    if (count === 1) text = text.replace(edit.oldText, edit.newText);
    else if (count === 0 && text.includes(edit.newText)) { /* idempotent worktree replay */ }
    else throw new Error(`Queued amendment edit must match exactly once: ${edit.path}`);
    byPath.set(edit.path, text);
  }
  for (const [path, text] of byPath) await atomicRepositoryWrite(resolve(repo, path), text, capability);

  for (const taskId of spec.taskIds) await runValidator(repo, taskId, undefined, "pre-go");
  for (const entry of snapshot.entries) {
    if (entry.state === "QUEUED" && !taskSet.has(entry.taskId)) await runValidator(repo, entry.taskId, undefined, "pre-go");
  }

  const exact = await createExactWorktreeCommit(repo, expectedHead, spec.subject, capability);
  const amendments = entries.map((entry) => {
    const brief = byPath.get(`team/tasks/${entry.taskId}/brief.md`);
    if (brief === undefined) throw new Error(`Queued amendment did not edit brief.md for ${entry.taskId}`);
    return {
      taskId: entry.taskId,
      expectedApprovedBriefDigest: entry.approvedBriefDigest,
      expectedContractDigest: entry.contractDigest,
      approvedBriefDigest: digest(brief),
      contractDigest: digest(authorizedBrief(brief, entry.approvedAt)),
    };
  });
  const command: AmendQueuedContractsCommand = {
    type: "amendQueuedContracts",
    expectedHead,
    newExpectedHead: exact.commitSha,
    amendments,
    expectedRevision: snapshot.revision,
  };
  const journal: AmendmentJournal = { version: 1, amendmentId: spec.amendmentId, phase: "PREPARED", exact, command };
  await durableReplaceJson(journalPath, journal, capability);
  return await settleJournal(repo, journalPath, journal, capability, stateRoot);
}
