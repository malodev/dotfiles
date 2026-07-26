import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { constants, readdirSync, readFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isToolCallEventType, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  archiveAuthorizationRecord,
  createAuthorizationRecord,
  readAuthorizationRecord,
  writeAuthorizationRecord,
} from "./authorization.ts";
import {
  activeRunDenial,
  assertDraftContractShape,
  authorizationSnapshotKind,
  assertTeamGrillable,
  buildTeamGrillPrompt,
  completeTeamNewTaskId,
  orderSuccessTests,
  parseReviewVerdict,
  parseStatus,
  parseSuccessTests,
  parseTeamNewArgs,
  parseTeamTaskId,
  readStatus,
  recoveryReviewCeiling,
  releaseInteractiveGuard,
  releaseOwnedSlot,
  setYamlScalar,
  taskPath,
  updateStatus,
  upsertYamlScalar,
} from "./core.ts";
import {
  isContinuableLengthRoleResult,
  isRetryableStaleRoleResult,
  runRole,
  type RoleResult,
} from "./runner.ts";
import {
  loadOrCreateTaskConfig,
  loadTeamConfig,
  roleModel,
  type TeamConfig,
} from "./config.ts";

const STATUS_KEY = "three-agent-team";
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const CANONICAL_VALIDATOR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../skills/init-three-agent-team/assets/validate_goal_contract.py",
);

interface ActiveRun {
  taskId: string;
  abortController: AbortController;
  leaseOwner?: string;
  leaseAcquired?: boolean;
  leaseHeartbeat?: ReturnType<typeof setInterval>;
  leaseExpiryTimer?: ReturnType<typeof setTimeout>;
  leaseRenewing?: boolean;
  leaseFailure?: Error;
  abortAgent?: () => void;
  leaseRepo?: string;
  leaseConfig?: TeamConfig;
  legacyInferenceReady?: boolean;
}

interface PendingArchitectValidation {
  repo: string;
  taskId: string;
  repairAttempts: number;
}

interface PendingUnblockRecovery {
  repo: string;
  taskId: string;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function shell(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = 30 * 60 * 1000,
  environment?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      env: environment ? { ...process.env, ...environment } : process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < MAX_LOG_BYTES) stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { if (stderr.length < MAX_LOG_BYTES) stderr += chunk.toString(); });
    child.on("error", (error) => { stderr += `\nspawn error: ${error.message}`; });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) stderr += "\ncommand timed out";
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
    const abort = () => child.kill("SIGTERM");
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

async function exists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function currentHead(repo: string): Promise<string> {
  const result = await shell("git rev-parse HEAD", repo, undefined, 60_000);
  const head = result.stdout.trim();
  if (result.code !== 0 || !/^[0-9a-f]{40}$/.test(head)) throw new Error("Repository has no valid HEAD commit");
  return head;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function stableSessionId(repo: string, taskId: string, role: string, cycle: number): string {
  const hex = createHash("sha256").update(`${repo}\0${taskId}\0${role}\0${cycle}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function roleSession(repo: string, taskId: string, role: string, cycle: number): { sessionId: string; sessionDir: string } {
  const repoKey = createHash("sha256").update(repo).digest("hex").slice(0, 16);
  return {
    sessionId: stableSessionId(repo, taskId, role, cycle),
    sessionDir: resolve(tmpdir(), "pi-three-agent-sessions", repoKey, taskId),
  };
}

async function countRoleRuns(taskDir: string, role: string, cycle: number): Promise<number> {
  const directory = resolve(taskDir, "role-runs");
  if (!(await exists(directory))) return 0;
  const prefix = `${role}-${String(cycle).padStart(2, "0")}-attempt-`;
  return (await readdir(directory)).filter((name) => name.startsWith(prefix) && name.endsWith(".md")).length;
}

function yamlSafe(value: string): string {
  return JSON.stringify(value.replace(/[\r\n]+/g, " ").slice(0, 500));
}

async function setState(taskDir: string, state: string, extra: Record<string, string> = {}): Promise<void> {
  const path = resolve(taskDir, "status.yaml");
  let text = await readFile(path, "utf8");
  text = setYamlScalar(text, "state", state);
  for (const [key, value] of Object.entries(extra)) text = setYamlScalar(text, key, value);
  await writeFile(path, text, "utf8");
}

async function validate(repo: string, taskDir: string, phase: "pre-go" | "execution", signal?: AbortSignal): Promise<void> {
  const result = await shell(`python ${JSON.stringify(CANONICAL_VALIDATOR)} ${JSON.stringify(taskDir)} --phase ${phase}`, repo, signal, 60_000);
  if (result.code !== 0) throw new Error(`Goal Contract validation failed (${phase}):\n${result.stderr || result.stdout}`);
}

function draftContractFile(repo: string, inputPath: string): { taskId: string; file: "brief.md" | "status.yaml" } | undefined {
  const tasksRoot = resolve(repo, "team/tasks");
  const absolutePath = resolve(repo, inputPath);
  const prefix = `${tasksRoot}/`;
  if (!absolutePath.startsWith(prefix)) return undefined;
  const segments = absolutePath.slice(prefix.length).split("/");
  if (segments.length !== 2 || (segments[1] !== "brief.md" && segments[1] !== "status.yaml")) return undefined;
  return { taskId: segments[0], file: segments[1] };
}

async function assertDraftMutation(repo: string, target: { taskId: string; file: "brief.md" | "status.yaml" }, candidate: string): Promise<void> {
  const directory = taskPath(repo, target.taskId);
  const originalStatus = await readFile(resolve(directory, "status.yaml"), "utf8");
  const baseline = parseStatus(originalStatus).baselineCommit;
  const brief = target.file === "brief.md" ? candidate : await readFile(resolve(directory, "brief.md"), "utf8");
  const status = target.file === "status.yaml" ? candidate : originalStatus;
  assertDraftContractShape(brief, status, target.taskId, baseline);
}

function applyEdits(text: string, edits: Array<{ oldText: string; newText: string }>): string {
  let candidate = text;
  for (const edit of edits) {
    const index = candidate.indexOf(edit.oldText);
    if (index < 0 || candidate.indexOf(edit.oldText, index + edit.oldText.length) >= 0) {
      throw new Error("edit must match one unique region before the draft contract guard can validate it");
    }
    candidate = candidate.slice(0, index) + edit.newText + candidate.slice(index + edit.oldText.length);
  }
  return candidate;
}

function recoveryDisposition(plan: string): "RESUME" | "ESCALATE" | undefined {
  return /^## Disposition\s*\n\s*(RESUME|ESCALATE)\s*$/m.exec(plan)?.[1] as "RESUME" | "ESCALATE" | undefined;
}

function roleFailure(result: RoleResult): string | undefined {
  if (result.error) return result.error;
  if (result.exitCode !== 0) return `exit code ${result.exitCode}`;
  return undefined;
}

async function enterTeamMode(repo: string, config: TeamConfig, signal?: AbortSignal): Promise<void> {
  const result = await shell(config.lifecycle.enterTeamCommand, repo, signal, 210_000);
  if (result.code !== 0) {
    throw new Error(`Could not enter team inference mode: ${result.stderr || result.stdout}`);
  }
}

const LEASE_EXPIRY_MARGIN_SECONDS = 15;

function failInferenceLease(run: ActiveRun, message: string): void {
  if (run.leaseFailure) return;
  run.leaseFailure = new Error(message);
  run.leaseAcquired = false;
  if (run.leaseHeartbeat) clearInterval(run.leaseHeartbeat);
  run.leaseHeartbeat = undefined;
  run.abortController.abort();
  run.abortAgent?.();
}

function armInferenceLeaseDeadline(run: ActiveRun, config: TeamConfig): void {
  if (run.leaseExpiryTimer) clearTimeout(run.leaseExpiryTimer);
  const lifetimeSeconds = config.lifecycle.leaseTtlSeconds - LEASE_EXPIRY_MARGIN_SECONDS;
  run.leaseExpiryTimer = setTimeout(() => {
    failInferenceLease(run, "Global inference lease reached its local safety deadline before a confirmed renewal");
  }, lifetimeSeconds * 1000);
  run.leaseExpiryTimer.unref();
}

function leaseEnvironment(owner: string, config: TeamConfig): NodeJS.ProcessEnv {
  return {
    PI_INFERENCE_OWNER: owner,
    PI_INFERENCE_TTL: String(config.lifecycle.leaseTtlSeconds),
  };
}

async function acquireInferenceLease(run: ActiveRun, repo: string, config: TeamConfig): Promise<void> {
  const { acquireTeamCommand, renewTeamCommand, releaseTeamCommand } = config.lifecycle;
  if (!acquireTeamCommand || !renewTeamCommand || !releaseTeamCommand) {
    await enterTeamMode(repo, config, run.abortController.signal);
    run.legacyInferenceReady = true;
    return;
  }
  const owner = `${hostname()}:${process.pid}:${run.taskId}:${randomUUID()}`;
  run.leaseOwner = owner;
  run.leaseRepo = repo;
  run.leaseConfig = config;
  const result = await shell(
    acquireTeamCommand,
    repo,
    run.abortController.signal,
    210_000,
    leaseEnvironment(owner, config),
  );
  if (result.code !== 0) throw new Error(`Could not acquire the global inference lease: ${result.stderr || result.stdout}`);
  run.leaseAcquired = true;
  armInferenceLeaseDeadline(run, config);
  run.leaseHeartbeat = setInterval(() => {
    if (!run.leaseOwner || run.leaseRenewing) return;
    run.leaseRenewing = true;
    void shell(
      renewTeamCommand,
      repo,
      undefined,
      60_000,
      leaseEnvironment(owner, config),
    ).then((renewal) => {
      if (run.leaseOwner !== owner || run.leaseFailure) return;
      if (renewal.code !== 0) {
        failInferenceLease(run, `Global inference lease renewal failed: ${renewal.stderr || renewal.stdout}`);
      } else {
        armInferenceLeaseDeadline(run, config);
      }
    }).finally(() => { run.leaseRenewing = false; });
  }, config.lifecycle.leaseRenewIntervalSeconds * 1000);
  run.leaseHeartbeat.unref();
}

async function releaseInferenceLease(run: ActiveRun, repo: string, config: TeamConfig): Promise<string | undefined> {
  if (run.leaseHeartbeat) clearInterval(run.leaseHeartbeat);
  if (run.leaseExpiryTimer) clearTimeout(run.leaseExpiryTimer);
  run.leaseHeartbeat = undefined;
  run.leaseExpiryTimer = undefined;
  const owner = run.leaseOwner;
  run.leaseOwner = undefined;
  run.leaseAcquired = false;
  if (!owner || !config.lifecycle.releaseTeamCommand) return undefined;
  const result = await shell(
    config.lifecycle.releaseTeamCommand,
    repo,
    undefined,
    60_000,
    leaseEnvironment(owner, config),
  );
  return result.code === 0 ? undefined : result.stderr || result.stdout || "unknown release failure";
}

async function blockTask(taskDir: string, reason: string): Promise<void> {
  await setState(taskDir, "BLOCKED", { blocked_reason: yamlSafe(reason) }).catch(() => undefined);
}

interface TaskCompletionItem {
  value: string;
  label: string;
  description: string;
}

export async function archiveTask(repo: string, taskId: string, date = new Date()): Promise<string> {
  const source = taskPath(repo, taskId);
  if (!(await exists(source))) throw new Error(`Task \`${taskId}\` does not exist`);
  const archiveDirectory = resolve(repo, "team/tasks/.discarded");
  await mkdir(archiveDirectory, { recursive: true });
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  let destination = resolve(archiveDirectory, `${taskId}-${stamp}`);
  let suffix = 1;
  while (await exists(destination)) destination = resolve(archiveDirectory, `${taskId}-${stamp}-${suffix++}`);
  await rename(source, destination);
  return destination;
}

export function taskArgumentCompletions(cwd: string, prefix: string): TaskCompletionItem[] | null {
  const input = prefix.trim();
  if (/\s/.test(input)) return null;

  try {
    const tasksDir = resolve(cwd, "team/tasks");
    const items = readdirSync(tasksDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name.startsWith(input))
      .map((entry): TaskCompletionItem => {
        let description = "task";
        try {
          description = parseStatus(readFileSync(resolve(tasksDir, entry.name, "status.yaml"), "utf8")).state;
        } catch {
          description = "invalid or missing status";
        }
        return { value: entry.name, label: entry.name, description };
      })
      .sort((left, right) => right.value.localeCompare(left.value));
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

function architectKickoff(taskId: string, request: string): string {
  return `<!-- three-agent-team-architect-task: ${taskId} -->
Act only as Architect. Discuss and complete the existing strict templates for task ${taskId}. Preserve every required heading and structured ST-NN field in team/tasks/${taskId}/brief.md; update the full status template to match. Resolve all angle-bracket placeholders and AGENTS.md project-command placeholders. Run the pre-go validator. Do not implement, invoke roles, create replacement files, or claim readiness unless validation passes. The owner authorizes only with /team-go ${taskId}. Request: ${request}`;
}

function architectRepairKickoff(taskId: string): string {
  return `<!-- three-agent-team-architect-task: ${taskId} -->
Act only as Architect performing a mechanical Goal Contract repair for task ${taskId}. Read its existing brief.md and status.yaml, then run \`python team/validate_goal_contract.py team/tasks/${taskId} --phase pre-go\`. Correct every reported error by editing only those two existing files. Do not discuss, implement production code, invoke roles, or declare readiness until you have rerun that exact command and it exits 0. Preserve the strict schema and owner authorization PENDING.`;
}

function architectUnblockKickoff(taskId: string, ownerNotes: string): string {
  const notes = ownerNotes ? `\n\nOwner's initial recovery notes for this turn:\n${ownerNotes}` : "";
  return `<!-- three-agent-team-unblock-discussion-task: ${taskId} -->
Act only as Architect in an owner-led recovery discussion for blocked task ${taskId}. Read brief.md, status.yaml, build-report.md, every review-*.md, verification.log, role-runs/, relevant implementation, and team/tasks/${taskId}/recovery-discussion.md. The latter is extension-owned owner context: read it but do not edit it. Diagnose the original blocker rather than trusting a later retry error. Discuss evidence, alternatives, and bounded next steps with the owner; ask focused questions where needed.

This is the discussion phase. Do not implement production code, edit brief.md/status.yaml, write recovery-plan.md, invoke roles, or resume work yet. When the owner says exactly \`finalize recovery\`, produce the formal recovery plan described in that request.${notes}`;
}

function architectUnblockFinalizeKickoff(taskId: string): string {
  return `<!-- three-agent-team-unblock-task: ${taskId} -->
The owner has said exactly \`finalize recovery\`. End the discussion and write team/tasks/${taskId}/recovery-plan.md. Do not implement production code or edit brief.md/status.yaml.

If recovery stays inside the existing authorized Goal Contract and needs no new owner decision, use exactly:
# Recovery Plan
## Disposition
RESUME
## Diagnosis
<evidence-backed cause>
## Builder instructions
<bounded instructions for the next Builder cycle>
## Verification strategy
<how the existing ST-NN tests will be made to pass>

If recovery needs expanded scope, additional hardware/system authority, changed success criteria, or an owner choice, use \`ESCALATE\` as the disposition and add \`## Owner question\`. Do not resume roles yourself.`;
}

function parseTeamUnblockArgs(args: string): { taskId: string; ownerNotes: string } {
  const match = args.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) throw new Error("Usage: /team-unblock <task-id> [initial recovery notes]");
  return { taskId: parseTeamTaskId(match[1], "team-unblock"), ownerNotes: match[2]?.trim() ?? "" };
}

function recoveryDiscussionPath(taskDir: string): string {
  return resolve(taskDir, "recovery-discussion.md");
}

async function appendRecoveryDiscussion(taskDir: string, taskId: string, phase: string, detail: string): Promise<void> {
  const path = recoveryDiscussionPath(taskDir);
  const timestamp = new Date().toISOString();
  if (!(await exists(path))) {
    await writeFile(path, `# Recovery Discussion\n\nExtension-owned, append-only audit context for task \`${taskId}\`. Architect may read this file but must not edit it. The formal technical decision belongs in \`recovery-plan.md\`.\n\n## Lifecycle events\n`, "utf8");
  }
  await appendFile(path, `\n### ${timestamp} — ${phase}\n${detail.trim() || "- No additional detail."}\n`, "utf8");
}

function contractTemplate(taskId: string, request: string, baseline: string): string {
  return `# Goal Contract: ${taskId}

## Goal
${request}

## Current behavior
<Describe observed baseline behavior.>

## Agreed approach
<Describe the bounded implementation approach and safety ordering.>

## Success tests
### ST-01: <specific offline outcome>
- Command: \`<exact executable command>\`
- Expected exit code: \`0\`
- Expected evidence: <specific output, artifact, or state>
- Writes hardware/system state: \`no\`
- Prerequisites: \`none\`

### ST-02: <specific writing outcome; remove this block when no write is needed>
- Command: \`<exact executable command>\`
- Expected exit code: \`0\`
- Expected evidence: <specific output, restored state, and named manual observation if applicable>
- Writes hardware/system state: \`yes\`
- Prerequisites: \`ST-01\`

## Non-goals
<Explicit exclusions.>

## Relevant files
<Paths or discovery boundaries.>

## Architectural constraints
<Invariants and prohibited behavior.>

## Verification commands
1. \`<repeat every ST-NN command exactly in prerequisite order>\`

## Baseline commit
${baseline}

## Execution authority
- Repository edits: allowed
- Non-destructive development commands: allowed
- Routine technical decisions inside this contract: allowed
- Hardware/system writes: prohibited
- Allowed hardware/system operations: none
- Commit on success: false
- Push on success: false
- Deploy on success: false

## Open decisions
NONE

## Execution authorization
PENDING
`;
}

async function createTaskDraft(repo: string, taskId: string, request: string): Promise<string> {
  const taskDir = taskPath(repo, taskId);
  if (await exists(taskDir)) throw new Error(`Task already exists: ${taskId}`);
  const baselineResult = await shell("git rev-parse HEAD", repo, undefined, 60_000);
  if (baselineResult.code !== 0 || !/^[0-9a-f]{40}$/.test(baselineResult.stdout.trim())) {
    throw new Error("Repository has no valid baseline commit");
  }
  const baseline = baselineResult.stdout.trim();
  const statusTemplatePath = resolve(repo, "team/tasks/.template/status.yaml");
  let status = await readFile(statusTemplatePath, "utf8");
  status = setYamlScalar(status, "task_id", taskId);
  status = setYamlScalar(status, "state", "DISCUSSING");
  status = setYamlScalar(status, "baseline_commit", baseline);
  status = setYamlScalar(status, "execution_authorized_at", "null");
  await mkdir(taskDir);
  await writeFile(resolve(taskDir, "status.yaml"), status, { encoding: "utf8", flag: "wx" });
  await writeFile(resolve(taskDir, "brief.md"), contractTemplate(taskId, request, baseline), { encoding: "utf8", flag: "wx" });
  const intent = await shell("git add -N .", repo, undefined, 60_000);
  if (intent.code !== 0) throw new Error(`git add -N failed: ${intent.stderr}`);
  return taskDir;
}

async function ensureAuthorizationSnapshot(
  repo: string,
  taskDir: string,
  allowLegacyMigration: boolean,
): Promise<{ migrated: boolean; authorizationHead: string; contractDigest: string }> {
  const statusPath = resolve(taskDir, "status.yaml");
  let statusText = await readFile(statusPath, "utf8");
  const status = parseStatus(statusText);
  if (status.taskId !== basename(taskDir)) throw new Error("Task status ID does not match its directory");
  if (!status.executionAuthorizedAt) throw new Error("Cannot snapshot an unauthorized task");
  const snapshotKind = authorizationSnapshotKind(status.authorizationHead, status.contractDigest);
  if (snapshotKind === "complete" && status.authorizationHead && status.contractDigest) {
    await readAuthorizationRecord(repo, status.taskId);
    return { migrated: false, authorizationHead: status.authorizationHead, contractDigest: status.contractDigest };
  }
  if (!allowLegacyMigration) throw new Error("Legacy task requires explicit owner-approved authorization migration");
  const brief = await readFile(resolve(taskDir, "brief.md"), "utf8");
  const head = await currentHead(repo);
  const digest = sha256(brief);
  const record = await createAuthorizationRecord(repo, status.taskId, head, digest, status.executionAuthorizedAt);
  await writeAuthorizationRecord(repo, record);
  statusText = upsertYamlScalar(statusText, "authorization_head", head, "execution_authorized_at");
  statusText = upsertYamlScalar(statusText, "contract_digest", digest, "execution_authorized_at");
  await writeFile(statusPath, statusText, "utf8");
  return { migrated: true, authorizationHead: head, contractDigest: digest };
}

async function authorize(repo: string, taskDir: string): Promise<string> {
  const stamp = new Date().toISOString();
  const authorizationHead = await currentHead(repo);
  const briefPath = resolve(taskDir, "brief.md");
  const brief = await readFile(briefPath, "utf8");
  const marker = "## Execution authorization\nPENDING";
  if (!brief.includes(marker)) throw new Error("brief.md is not awaiting authorization");
  const authorizedBrief = brief.replace(marker, `## Execution authorization\nAUTHORIZED at ${stamp} by owner message \`go\``);
  await writeFile(briefPath, authorizedBrief, "utf8");
  const statusPath = resolve(taskDir, "status.yaml");
  let statusText = await readFile(statusPath, "utf8");
  statusText = setYamlScalar(statusText, "state", "EXECUTING");
  statusText = upsertYamlScalar(statusText, "authorization_head", authorizationHead, "execution_authorized_at");
  statusText = upsertYamlScalar(statusText, "contract_digest", sha256(authorizedBrief), "execution_authorized_at");
  statusText = setYamlScalar(statusText, "execution_authorized_at", stamp);
  await writeFile(statusPath, statusText, "utf8");
  const record = await createAuthorizationRecord(repo, parseStatus(statusText).taskId, authorizationHead, sha256(authorizedBrief), stamp);
  await writeAuthorizationRecord(repo, record);
  return stamp;
}

async function persistRoleResult(taskDir: string, role: "builder" | "reviewer", cycle: number, attempt: number, result: RoleResult): Promise<string> {
  const directory = resolve(taskDir, "role-runs");
  await mkdir(directory, { recursive: true });
  let actualAttempt = attempt;
  let path = resolve(directory, `${role}-${String(cycle).padStart(2, "0")}-attempt-${actualAttempt}.md`);
  while (await exists(path)) {
    actualAttempt += 1;
    path = resolve(directory, `${role}-${String(cycle).padStart(2, "0")}-attempt-${actualAttempt}.md`);
  }
  const metadata = [
    `# ${role} run`,
    "",
    `- Requested model: \`${result.requestedModel}\``,
    `- Response provider: \`${result.responseProvider ?? "none"}\``,
    `- Response model: \`${result.responseModel ?? "none"}\``,
    `- Stop reason: \`${result.stopReason ?? "none"}\``,
    `- Exit code: \`${result.exitCode}\``,
    `- Tool count: \`${result.toolCount}\``,
    `- Error: ${result.error ?? "none"}`,
    "",
    "## Standard error",
    "```text",
    result.stderr.trim(),
    "```",
    "",
    "## Final output",
    result.output.trim(),
    "",
  ].join("\n");
  await writeFile(path, metadata, { encoding: "utf8", flag: "wx" });
  return path;
}

async function saveReview(taskDir: string, cycle: number, output: string): Promise<string> {
  const reviewPath = resolve(taskDir, `review-${String(cycle).padStart(2, "0")}.md`);
  await writeFile(reviewPath, output.trimEnd() + "\n", { encoding: "utf8", flag: "wx" });
  return reviewPath;
}

async function runVerification(repo: string, taskDir: string, signal: AbortSignal, setProgress: (text: string) => void): Promise<void> {
  const brief = await readFile(resolve(taskDir, "brief.md"), "utf8");
  const tests = orderSuccessTests(parseSuccessTests(brief));
  const completed = new Set<string>();
  const logPath = resolve(taskDir, "verification.log");
  await writeFile(logPath, `Verification started ${new Date().toISOString()}\n`, "utf8");
  for (const test of tests) {
    if (signal.aborted) throw new Error("workflow cancelled");
    for (const prerequisite of test.prerequisites) {
      if (!completed.has(prerequisite)) throw new Error(`${test.id} prerequisite did not complete: ${prerequisite}`);
    }
    setProgress(`VERIFYING ${test.id}`);
    const result = await shell(test.command, repo, signal);
    await appendFile(logPath, `\n## ${test.id}\n$ ${test.command}\nexit=${result.code}\n${result.stdout}${result.stderr}\n`, "utf8");
    if (result.code !== test.expectedExitCode) {
      throw new Error(`${test.id} expected exit ${test.expectedExitCode}, got ${result.code}. See ${logPath}`);
    }
    completed.add(test.id);
  }
}

function briefSection(brief: string, heading: string): string {
  const match = new RegExp(`^## ${heading}\\s*$`, "m").exec(brief);
  if (!match || match.index === undefined) return "Not recorded.";
  const remainder = brief.slice(match.index + match[0].length);
  const nextHeading = /^##\s/m.exec(remainder);
  return (nextHeading ? remainder.slice(0, nextHeading.index) : remainder).trim() || "Not recorded.";
}

export function completionReportMessage(taskId: string, reportPath: string, report: string) {
  return {
    customType: "three-agent-team-completion",
    content: `✅ Three-agent task \`${taskId}\` completed.\n\nCanonical report: \`${reportPath}\`\n\n${report}`,
    display: true,
    details: { taskId, reportPath },
  } as const;
}

async function writeCompletionReport(repo: string, taskId: string, completedAt: string): Promise<string> {
  const taskDir = taskPath(repo, taskId);
  const reportPath = resolve(taskDir, "completion-report.md");
  if (await exists(reportPath)) return reportPath;
  const brief = await readFile(resolve(taskDir, "brief.md"), "utf8");
  const { status } = await readStatus(taskDir);
  const tests = orderSuccessTests(parseSuccessTests(brief));
  const implementationBase = status.authorizationHead ?? status.baselineCommit;
  const changed = await shell(`git diff --name-status ${implementationBase} -- . ':(exclude)team/tasks'`, repo, undefined, 60_000);
  if (changed.code !== 0) throw new Error(`Could not collect completed-task changed files: ${changed.stderr}`);
  const testLines = tests.map((test) => [
    `### ${test.id}`,
    `- Command: \`${test.command}\``,
    `- Expected exit: \`${test.expectedExitCode}\`; actual exit: \`${test.expectedExitCode}\` (PASS)`,
    `- Evidence: ${test.expectedEvidence}`,
    `- Writes hardware/system state: ${test.writesState ? "yes" : "no"}`,
    `- Prerequisites: ${test.prerequisites.length ? test.prerequisites.join(", ") : "none"}`,
  ].join("\n")).join("\n\n");
  const report = [
    `# Completion Report: ${taskId}`,
    "",
    "## Outcome",
    "COMPLETED",
    `- Completed and verified at: ${completedAt}`,
    "",
    "## Goal",
    briefSection(brief, "Goal"),
    "",
    "## Scope delivered",
    `- Discussion baseline: \`${status.baselineCommit}\``,
    `- Authorization head: \`${implementationBase}\``,
    "- Changed implementation/documentation files relative to the authorization head:",
    "```text",
    changed.stdout.trim() || "No non-task files changed.",
    "```",
    "",
    "## Verification",
    "All success tests below completed in prerequisite order with their expected exit code. Full captured output: `verification.log`.",
    "",
    testLines,
    "",
    "## Builder and review evidence",
    `- Builder report: \`team/tasks/${taskId}/build-report.md\``,
    `- Final review: \`team/tasks/${taskId}/review-${String(status.reviewCycle).padStart(2, "0")}.md\` (APPROVED)`, 
    `- Review cycles: ${status.reviewCycle}`,
    "",
    "## Completion policy",
    `- Commit on success: ${status.completionPolicy.commitOnSuccess}`,
    `- Push on success: ${status.completionPolicy.pushOnSuccess}`,
    `- Deploy on success: ${status.completionPolicy.deployOnSuccess}`,
    "",
    "## Task artifacts",
    "- `brief.md` — authorized Goal Contract",
    "- `build-report.md` — Builder implementation detail",
    "- `review-*.md` — independent review evidence",
    "- `verification.log` — command output",
    "- `role-runs/` — model-run evidence",
    "",
  ].join("\n");
  await writeFile(reportPath, report, { encoding: "utf8", flag: "wx" });
  return reportPath;
}

export default async function threeAgentTeamExtension(pi: ExtensionAPI) {
  const configuredTeam = await loadTeamConfig();
  let completionCwd = process.cwd();
  const completeTaskArgument = (prefix: string) => taskArgumentCompletions(completionCwd, prefix);

  pi.on("session_start", (_event, ctx) => {
    completionCwd = ctx.cwd;
  });
  let activeRun: ActiveRun | undefined;
  let interactiveInferenceLease: ActiveRun | undefined;
  let authorizedInteractiveTaskId: string | undefined;
  let pendingArchitectValidation: PendingArchitectValidation | undefined;
  let pendingUnblockRecovery: PendingUnblockRecovery | undefined;
  let activeUnblockDiscussion: PendingUnblockRecovery | undefined;
  let pendingArchitectStopReason: "stop" | "length" | "error" | "aborted" | "toolUse" | undefined;

  const setUi = (ctx: ExtensionCommandContext, text?: string) => {
    ctx.ui.setStatus(STATUS_KEY, text);
    ctx.ui.setWidget(STATUS_KEY, text ? [text] : undefined, { placement: "belowEditor" });
  };

  const requireIdle = (ctx: ExtensionCommandContext, commandName: string): boolean => {
    const recoveryTask = pendingUnblockRecovery?.taskId ?? activeUnblockDiscussion?.taskId;
    if (recoveryTask) {
      ctx.ui.notify(`Task ${recoveryTask} has an active recovery discussion or finalization; /${commandName} must wait.`, "warning");
      return false;
    }
    const denial = activeRunDenial(activeRun?.taskId, commandName);
    if (!denial) return true;
    ctx.ui.notify(denial, "warning");
    return false;
  };

  const reserveRun = (taskId: string): ActiveRun => {
    const denial = activeRunDenial(activeRun?.taskId, "team workflow launch");
    if (denial) throw new Error(denial);
    const run = { taskId, abortController: new AbortController() };
    activeRun = run;
    return run;
  };

  const releaseRun = (run: ActiveRun): void => {
    activeRun = releaseOwnedSlot(activeRun, run);
  };

  const releaseInteractiveInferenceLease = async (ctx: ExtensionCommandContext): Promise<void> => {
    const lease = interactiveInferenceLease;
    interactiveInferenceLease = undefined;
    if (!lease) return;
    const releaseFailure = await releaseInferenceLease(lease, ctx.cwd, configuredTeam).catch((error) => String(error));
    if (releaseFailure) ctx.ui.notify(`Interactive inference lease release failed; it will expire automatically: ${releaseFailure}`, "warning");
  };

  async function selectArchitect(repo: string, ctx: ExtensionCommandContext): Promise<void> {
    await enterTeamMode(repo, configuredTeam);
    const profile = configuredTeam.roles.architect;
    const model = ctx.modelRegistry.find(profile.provider, profile.model);
    if (!model) throw new Error(`Configured Architect model is unavailable: ${roleModel(configuredTeam, "architect")}`);
    if (!(await pi.setModel(model))) throw new Error(`Configured Architect model has no usable authentication: ${roleModel(configuredTeam, "architect")}`);
    pi.setThinkingLevel(profile.thinking);
  }

  async function executeWorkflow(repo: string, taskId: string, ctx: ExtensionCommandContext, config: TeamConfig, run: ActiveRun): Promise<void> {
    const taskDir = taskPath(repo, taskId);
    const ownerCorrectionPath = resolve(taskDir, "owner-correction.md");
    const recoveryPlanPath = resolve(taskDir, "recovery-plan.md");
    const ownerCorrectionDirective = [
      await exists(ownerCorrectionPath)
        ? `Mandatory post-block owner correction: before any other action, read ${ownerCorrectionPath} and follow it as a scope-narrowing safety clarification.`
        : "",
      await exists(recoveryPlanPath)
        ? `Mandatory Architect recovery plan: before any other action, read ${recoveryPlanPath} and follow its bounded Builder instructions and verification strategy.`
        : "",
    ].filter(Boolean).join(" ");
    const controller = run.abortController;
    const progress = (text: string) => setUi(ctx, `team ${taskId}: ${text}`);
    try {
      progress("ACQUIRING global inference lease");
      await acquireInferenceLease(run, repo, config);
      let { status } = await readStatus(taskDir);
      let latestReview = status.reviewCycle > 0
        ? resolve(taskDir, `review-${String(status.reviewCycle).padStart(2, "0")}.md`)
        : undefined;
      if (latestReview && !(await exists(latestReview))) latestReview = undefined;
      while (status.reviewCycle < status.maxReviewCycles) {
        progress(`BUILDER cycle ${status.reviewCycle + 1} · ${roleModel(config, "builder")}`);
        await validate(repo, taskDir, "execution", controller.signal);
        const builderCycle = status.reviewCycle + 1;
        const buildReport = resolve(taskDir, "build-report.md");
        const reportBeforeCycle = await exists(buildReport) ? await readFile(buildReport, "utf8") : undefined;
        const reviewerAlreadyStarted = await countRoleRuns(taskDir, "reviewer", builderCycle) > 0;
        let reportReady = reportBeforeCycle !== undefined && (status.reviewCycle === 0 || reviewerAlreadyStarted);
        let builderAttempt = await countRoleRuns(taskDir, "builder", builderCycle);
        let builderRunPath = "";
        const builderSession = roleSession(repo, taskId, "builder", builderCycle);
        await mkdir(builderSession.sessionDir, { recursive: true });

        while (!reportReady && builderAttempt < config.limits.builderAttempts) {
          builderAttempt += 1;
          progress(`BUILDER cycle ${builderCycle} attempt ${builderAttempt}/${config.limits.builderAttempts}`);
          const continuation = builderAttempt > 1;
          const builder = await runRole({
            role: "builder",
            config,
            cwd: repo,
            promptPath: resolve(repo, "team/agents/team-builder.md"),
            task: continuation
              ? `Repository: ${repo}\nTask ID: ${taskId}\n${ownerCorrectionDirective}Continuation attempt ${builderAttempt}/${config.limits.builderAttempts} in the same Builder session. Your prior response ended before the required build-report.md existed. Continue the authorized implementation now using tools; do not restart broad discovery and do not return a narrative promising future actions. Inspect the current worktree and prior role evidence only as needed, make measurable progress, test it, and finish the complete Goal Contract. Write team/tasks/${taskId}/build-report.md only when all implementation and required Builder verification are complete.${latestReview ? ` Address the latest review at ${latestReview}.` : ""}`
              : `Repository: ${repo}\nTask ID: ${taskId}\n${ownerCorrectionDirective}${latestReview ? `Latest review: ${latestReview}\n` : ""}Follow the Builder role contract exactly. Do not end with a promise to use another tool: keep using tools until the complete implementation and build-report.md are finished.`, 
            signal: controller.signal,
            onProgress: progress,
            ...builderSession,
          });
          builderRunPath = await persistRoleResult(taskDir, "builder", builderCycle, builderAttempt, builder);
          const builderError = roleFailure(builder);
          if (builderError) {
            if (isRetryableStaleRoleResult(builder)) {
              progress(`BUILDER transient stale stream persisted; retrying same session`);
              continue;
            }
            throw new Error(`Builder failed closed: ${builderError}. See ${builderRunPath}`);
          }
          if (isContinuableLengthRoleResult(builder)) {
            progress(`BUILDER reached configured output limit after measurable progress; continuing same session`);
          }
          if (await exists(buildReport)) {
            const reportAfterAttempt = await readFile(buildReport, "utf8");
            reportReady = reportBeforeCycle === undefined || reportAfterAttempt !== reportBeforeCycle;
          }
        }
        if (!reportReady) {
          throw new Error(`Builder did not complete build-report.md within ${config.limits.builderAttempts} cumulative attempts. Last evidence: ${builderRunPath}`);
        }
        await shell("git add -N .", repo, controller.signal, 60_000);
        await setState(taskDir, "REVIEWING", { latest_build_report: `team/tasks/${taskId}/build-report.md` });
        await validate(repo, taskDir, "execution", controller.signal);

        const cycle = status.reviewCycle + 1;
        const reviewerSession = roleSession(repo, taskId, "reviewer", cycle);
        await mkdir(reviewerSession.sessionDir, { recursive: true });
        let reviewerAttempt = await countRoleRuns(taskDir, "reviewer", cycle);
        let reviewerOutput = "";
        let verdict: ReturnType<typeof parseReviewVerdict> | undefined;
        let reviewerRunPath = "";

        while (!verdict && reviewerAttempt < config.limits.reviewerAttempts) {
          reviewerAttempt += 1;
          progress(`REVIEWER cycle ${cycle} attempt ${reviewerAttempt}/${config.limits.reviewerAttempts} · ${roleModel(config, "reviewer")}`);
          const reviewer = await runRole({
            role: "reviewer",
            config,
            cwd: repo,
            promptPath: resolve(repo, "team/agents/team-reviewer.md"),
            task: reviewerAttempt > 1
              ? `Repository: ${repo}\nTask ID: ${taskId}\nReview cycle: ${cycle}\n${ownerCorrectionDirective}Continuation attempt ${reviewerAttempt}/${config.limits.reviewerAttempts} in the same read-only Reviewer session. Your previous response did not contain the exact complete review verdict. Continue inspecting the complete authorization-head diff as needed, then return the full required review report with an exact ## Verdict heading. Do not promise future tool calls.`
              : `Repository: ${repo}\nTask ID: ${taskId}\nReview cycle: ${cycle}\n${ownerCorrectionDirective}Follow the Reviewer role contract exactly, inspect the complete authorization-head diff independently, and return the complete review report with an exact ## Verdict heading.`,
            signal: controller.signal,
            onProgress: progress,
            ...reviewerSession,
          });
          reviewerRunPath = await persistRoleResult(taskDir, "reviewer", cycle, reviewerAttempt, reviewer);
          const reviewerError = roleFailure(reviewer);
          if (reviewerError) {
            if (isRetryableStaleRoleResult(reviewer)) {
              progress(`REVIEWER transient stale stream persisted; retrying same session`);
              continue;
            }
            throw new Error(`Reviewer failed closed: ${reviewerError}. See ${reviewerRunPath}`);
          }
          if (isContinuableLengthRoleResult(reviewer)) {
            progress(`REVIEWER reached configured output limit after measurable progress; continuing same session`);
          }
          reviewerOutput = reviewer.output;
          try { verdict = parseReviewVerdict(reviewerOutput); } catch { /* Continue the same review session. */ }
        }
        if (!verdict) {
          throw new Error(`Reviewer did not return a valid verdict within ${config.limits.reviewerAttempts} cumulative attempts. Last evidence: ${reviewerRunPath}`);
        }
        const reviewPath = await saveReview(taskDir, cycle, reviewerOutput);
        await updateStatus(taskDir, {
          review_cycle: String(cycle),
          latest_review: `team/tasks/${taskId}/${basename(reviewPath)}`,
        });
        await shell("git add -N .", repo, controller.signal, 60_000);
        status = (await readStatus(taskDir)).status;
        if (verdict === "APPROVED") {
          await setState(taskDir, "VERIFYING");
          await validate(repo, taskDir, "execution", controller.signal);
          await runVerification(repo, taskDir, controller.signal, progress);
          const completedAt = new Date().toISOString();
          progress("WRITING completion report");
          const completionReport = await writeCompletionReport(repo, taskId, completedAt);
          if (status.completionPolicy.pushOnSuccess || status.completionPolicy.deployOnSuccess) {
            throw new Error("V1 extension refuses push/deploy; set both policies false or extend the implementation explicitly");
          }
          await setState(taskDir, "COMPLETED", {
            completed_at: completedAt,
            verified_at: completedAt,
            commit_sha: status.completionPolicy.commitOnSuccess ? "SELF" : "null",
            blocked_reason: "null",
          });
          if (status.completionPolicy.commitOnSuccess) {
            progress("COMMITTING verified result");
            const add = await shell("git add -A", repo, controller.signal, 60_000);
            if (add.code !== 0) throw new Error(`git add failed: ${add.stderr}`);
            const commit = await shell(`git commit -m ${JSON.stringify(`feat: complete ${taskId}`)}`, repo, controller.signal);
            if (commit.code !== 0) throw new Error(`commit failed: ${commit.stderr || commit.stdout}`);
          }
          progress("COMPLETED");
          try {
            const report = await readFile(completionReport, "utf8");
            pi.sendMessage(completionReportMessage(taskId, `team/tasks/${taskId}/completion-report.md`, report), { triggerTurn: false });
          } catch (error) {
            ctx.ui.notify(`Task completed, but its persistent report message could not be published: ${error instanceof Error ? error.message : String(error)}`, "warning");
          }
          ctx.ui.notify(`Three-agent task ${taskId} completed. Report: ${completionReport}`, "info");
          authorizedInteractiveTaskId = releaseInteractiveGuard(authorizedInteractiveTaskId, taskId);
          return;
        }
        if (verdict === "ESCALATE") throw new Error(`Reviewer escalated. See ${reviewPath}`);
        latestReview = reviewPath;
        await setState(taskDir, "EXECUTING");
        status = (await readStatus(taskDir)).status;
      }
      throw new Error(`Review ceiling reached (${status.maxReviewCycles})`);
    } catch (error) {
      const reason = run.leaseFailure?.message ?? (error instanceof Error ? error.message : String(error));
      await blockTask(taskDir, reason);
      progress("BLOCKED");
      ctx.ui.notify(`Three-agent task blocked: ${reason}`, "error");
      throw error;
    } finally {
      const releaseFailure = await releaseInferenceLease(run, repo, config).catch((error) => String(error));
      if (releaseFailure) ctx.ui.notify(`Task ${taskId} ended, but its inference lease could not be released; it will expire automatically: ${releaseFailure}`, "warning");
      if (config.lifecycle.restoreStudioAfterRun && config.lifecycle.restoreStudioCommand) {
        await shell(config.lifecycle.restoreStudioCommand, repo, undefined, 3 * 60 * 1000).catch(() => undefined);
      }
      releaseRun(run);
    }
  }

  pi.registerCommand("team-config", {
    description: "Show the resolved Architect, Builder, Reviewer, and runtime limits",
    handler: async (_args, ctx) => {
      const lines = [
        `Config: ${configuredTeam.sourcePath}`,
        `Architect: ${roleModel(configuredTeam, "architect")} · max ${configuredTeam.roles.architect.maxTokens}`,
        `Builder: ${roleModel(configuredTeam, "builder")} · max ${configuredTeam.roles.builder.maxTokens}`,
        `Reviewer: ${roleModel(configuredTeam, "reviewer")} · max ${configuredTeam.roles.reviewer.maxTokens}`,
        `Attempts: builder ${configuredTeam.limits.builderAttempts}, reviewer ${configuredTeam.limits.reviewerAttempts}`,
        `Timeouts: role ${configuredTeam.limits.roleTimeoutSeconds}s, idle ${configuredTeam.limits.idleTimeoutSeconds}s`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("team-new", {
    description: "Create strict task templates and start Architect discussion",
    getArgumentCompletions: (prefix) => {
      const value = completeTeamNewTaskId(prefix);
      return value ? [{ value, label: value, description: "current local date task prefix" }] : null;
    },
    handler: async (args, ctx) => {
      let taskId: string;
      let request: string;
      try {
        ({ taskId, request } = parseTeamNewArgs(args));
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
        return;
      }
      if (!requireIdle(ctx, "team-new")) return;
      if (!(await exists(resolve(ctx.cwd, "team/validate_goal_contract.py")))) {
        ctx.ui.notify("Repository is not initialized for the extension.", "error"); return;
      }
      try {
        const repo = ctx.cwd;
        if (process.env.PI_THREE_AGENT_NO_ARCHITECT !== "1") await selectArchitect(repo, ctx);
        await ctx.newSession({
          parentSession: ctx.sessionManager.getSessionFile(),
          withSession: async (freshCtx) => {
            const taskDir = await createTaskDraft(repo, taskId, request);
            freshCtx.ui.notify(`Created strict draft at ${taskDir} in a fresh Architect session`, "info");
            if (process.env.PI_THREE_AGENT_NO_ARCHITECT === "1") return;
            await freshCtx.sendUserMessage(architectKickoff(taskId, request));
          },
        });
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("team-grill-me", {
    description: "Stress-test one unauthorized Goal Contract with the grill-me skill",
    getArgumentCompletions: completeTaskArgument,
    handler: async (args, ctx) => {
      let taskId: string;
      try {
        taskId = parseTeamTaskId(args, "team-grill-me");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
        return;
      }
      if (!requireIdle(ctx, "team-grill-me")) return;
      if (!(await exists(resolve(ctx.cwd, "team/validate_goal_contract.py")))) {
        ctx.ui.notify("Repository is not initialized for the extension.", "error");
        return;
      }
      const grillSkillAvailable = pi.getCommands().some(
        (command) => command.source === "skill" && command.name === "skill:grill-me",
      );
      if (!grillSkillAvailable) {
        ctx.ui.notify(
          "Required skill command /skill:grill-me is unavailable. Enable skill commands in /settings and restart Pi.",
          "error",
        );
        return;
      }
      try {
        const repo = ctx.cwd;
        const taskDir = taskPath(repo, taskId);
        const { status } = await readStatus(taskDir);
        assertTeamGrillable(status, taskId);
        if (!(await exists(resolve(taskDir, "brief.md")))) throw new Error(`Task \`${taskId}\` has no brief.md`);
        await selectArchitect(repo, ctx);
        await ctx.newSession({
          parentSession: ctx.sessionManager.getSessionFile(),
          withSession: async (freshCtx) => {
            freshCtx.ui.notify(`Starting clean Architect repair session for ${taskId}`, "info");
            await freshCtx.sendUserMessage(buildTeamGrillPrompt(taskId));
          },
        });
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("team-unblock", {
    description: "Open an owner-led Architect discussion for a BLOCKED task; type 'finalize recovery' when ready",
    getArgumentCompletions: completeTaskArgument,
    handler: async (args, ctx) => {
      if (!requireIdle(ctx, "team-unblock")) return;
      let taskId: string;
      try {
        const parsed = parseTeamUnblockArgs(args);
        taskId = parsed.taskId;
        if (activeUnblockDiscussion) throw new Error(`Architect recovery discussion is already open for ${activeUnblockDiscussion.taskId}; continue it or finalize recovery before starting another.`);
        const repo = ctx.cwd;
        const taskDir = taskPath(repo, taskId);
        const { status } = await readStatus(taskDir);
        if (status.state !== "BLOCKED") throw new Error(`Task ${taskId} is not BLOCKED (current state: ${status.state}).`);
        if (!(await exists(resolve(taskDir, "brief.md")))) throw new Error(`Task \`${taskId}\` has no brief.md`);
        await appendRecoveryDiscussion(
          taskDir,
          taskId,
          "DISCUSSING",
          `- Recovery discussion opened by owner.\n- Owner initial notes: ${parsed.ownerNotes || "(none supplied)"}`,
        );
        await selectArchitect(repo, ctx);
        activeUnblockDiscussion = { repo, taskId };
        await ctx.newSession({
          parentSession: ctx.sessionManager.getSessionFile(),
          withSession: async (freshCtx) => {
            freshCtx.ui.notify(`Starting owner-led Architect recovery discussion for ${taskId}`, "info");
            await freshCtx.sendUserMessage(architectUnblockKickoff(taskId, parsed.ownerNotes));
          },
        });
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("team-repair", {
    description: "Start a clean Architect session to repair an invalid unauthorized Goal Contract",
    getArgumentCompletions: completeTaskArgument,
    handler: async (args, ctx) => {
      if (!requireIdle(ctx, "team-repair")) return;
      let taskId: string;
      try {
        taskId = parseTeamTaskId(args, "team-repair");
        const repo = ctx.cwd;
        const taskDir = taskPath(repo, taskId);
        const { status } = await readStatus(taskDir);
        assertTeamGrillable(status, taskId);
        if (!(await exists(resolve(taskDir, "brief.md")))) throw new Error(`Task \`${taskId}\` has no brief.md`);
        await selectArchitect(repo, ctx);
        await ctx.newSession({
          parentSession: ctx.sessionManager.getSessionFile(),
          withSession: async (freshCtx) => {
            freshCtx.ui.notify(`Starting clean Architect repair for ${taskId}`, "info");
            await freshCtx.sendUserMessage(architectRepairKickoff(taskId));
          },
        });
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("team-validate", {
    description: "Run deterministic pre-go validation for one task",
    getArgumentCompletions: completeTaskArgument,
    handler: async (args, ctx) => {
      const taskId = args.trim();
      if (!taskId) { ctx.ui.notify("Usage: /team-validate <task-id>", "warning"); return; }
      try {
        await validate(ctx.cwd, taskPath(ctx.cwd, taskId), "pre-go");
        ctx.ui.notify(`${taskId}: structurally valid and eligible for /team-go`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("team-go", {
    description: "Validate, authorize, and start one observable background team task",
    getArgumentCompletions: completeTaskArgument,
    handler: async (args, ctx) => {
      const taskId = args.trim();
      if (!taskId) { ctx.ui.notify("Usage: /team-go <task-id>", "warning"); return; }
      if (!requireIdle(ctx, "team-go")) return;
      const taskDir = taskPath(ctx.cwd, taskId);
      const run = reserveRun(taskId);
      let authorized = false;
      try {
        const { status } = await readStatus(taskDir);
        if (status.state !== "DISCUSSING" || status.executionAuthorizedAt) {
          throw new Error("Task is not in unauthorized DISCUSSING state");
        }
        await validate(ctx.cwd, taskDir, "pre-go");
        const taskConfig = await loadOrCreateTaskConfig(taskDir, configuredTeam);
        await enterTeamMode(ctx.cwd, taskConfig);
        authorized = true;
        authorizedInteractiveTaskId = taskId;
        await authorize(ctx.cwd, taskDir);
        await shell("git add -N .", ctx.cwd, undefined, 60_000);
        await validate(ctx.cwd, taskDir, "execution");
        void executeWorkflow(ctx.cwd, taskId, ctx, taskConfig, run).catch(() => undefined);
        ctx.ui.notify(`Started deterministic team run for ${taskId}. Use /team-status or /team-cancel.`, "info");
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (authorized) await blockTask(taskDir, reason);
        releaseRun(run);
        ctx.ui.notify(reason, "error");
      }
    },
  });

  pi.registerCommand("team-resume", {
    description: "Resume a validated BLOCKED or EXECUTING team task after resolving its blocker",
    getArgumentCompletions: completeTaskArgument,
    handler: async (args, ctx) => {
      const taskId = args.trim();
      if (!taskId) { ctx.ui.notify("Usage: /team-resume <task-id>", "warning"); return; }
      if (!requireIdle(ctx, "team-resume")) return;
      if (activeUnblockDiscussion?.taskId === taskId || pendingUnblockRecovery?.taskId === taskId) {
        ctx.ui.notify(`Task ${taskId} already has an active recovery discussion or finalization.`, "warning");
        return;
      }
      const taskDir = taskPath(ctx.cwd, taskId);
      const run = reserveRun(taskId);
      let resumeEligible = false;
      try {
        const { status } = await readStatus(taskDir);
        if (!status.executionAuthorizedAt) throw new Error("Task has no recorded owner authorization");
        if (!new Set(["BLOCKED", "EXECUTING"]).has(status.state)) {
          throw new Error(`Task ${taskId} cannot resume from ${status.state}; expected BLOCKED or EXECUTING.`);
        }
        resumeEligible = true;
        const taskConfig = await loadOrCreateTaskConfig(taskDir, configuredTeam);
        await enterTeamMode(ctx.cwd, taskConfig);
        const snapshot = await ensureAuthorizationSnapshot(ctx.cwd, taskDir, true);
        if (snapshot.migrated) {
          ctx.ui.notify(`Legacy authorization migrated by explicit /team-resume: HEAD ${snapshot.authorizationHead}, contract SHA-256 ${snapshot.contractDigest}.`, "warning");
        }
        await setState(taskDir, "EXECUTING", { blocked_reason: "null" });
        authorizedInteractiveTaskId = taskId;
        await shell("git add -N .", ctx.cwd, undefined, 60_000);
        await validate(ctx.cwd, taskDir, "execution");
        void executeWorkflow(ctx.cwd, taskId, ctx, taskConfig, run).catch(() => undefined);
        ctx.ui.notify(`Resumed deterministic team run for ${taskId}. Use /team-status or /team-cancel.`, "info");
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (resumeEligible) await blockTask(taskDir, reason);
        releaseRun(run);
        ctx.ui.notify(reason, "error");
      }
    },
  });

  pi.registerCommand("team-discard", {
    description: "Archive an inactive task without deleting its artifacts",
    getArgumentCompletions: completeTaskArgument,
    handler: async (args, ctx) => {
      let taskId: string;
      try {
        taskId = parseTeamTaskId(args, "team-discard");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
        return;
      }
      if (activeRun?.taskId === taskId) {
        ctx.ui.notify(`Cannot discard active task ${taskId}; use /team-cancel first.`, "warning");
        return;
      }
      if (pendingArchitectValidation?.taskId === taskId) {
        ctx.ui.notify(`Cannot discard ${taskId} while Architect is still settling. Wait for automatic validation to finish.`, "warning");
        return;
      }
      if (activeUnblockDiscussion?.taskId === taskId || pendingUnblockRecovery?.taskId === taskId) {
        ctx.ui.notify(`Cannot discard ${taskId} while its recovery discussion or finalization is active.`, "warning");
        return;
      }
      try {
        const archiveDate = new Date();
        const archived = await archiveTask(ctx.cwd, taskId, archiveDate);
        const stamp = archiveDate.toISOString().replace(/[:.]/g, "-");
        try {
          await archiveAuthorizationRecord(ctx.cwd, taskId, stamp);
        } catch (error) {
          ctx.ui.notify(`Task artifacts were archived, but the external authorization record could not be archived: ${error instanceof Error ? error.message : String(error)}`, "warning");
        }
        authorizedInteractiveTaskId = releaseInteractiveGuard(authorizedInteractiveTaskId, taskId);
        ctx.ui.notify(`Archived ${taskId} at ${archived}`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("team-status", {
    description: "Show one team task status",
    getArgumentCompletions: completeTaskArgument,
    handler: async (args, ctx) => {
      const taskId = args.trim();
      if (!taskId) { ctx.ui.notify("Usage: /team-status <task-id>", "warning"); return; }
      try {
        const { status } = await readStatus(taskPath(ctx.cwd, taskId));
        ctx.ui.notify(`${status.taskId}: ${status.state}, review ${status.reviewCycle}/${status.maxReviewCycles}`, "info");
      } catch (error) { ctx.ui.notify(String(error), "error"); }
    },
  });

  pi.registerCommand("team-report", {
    description: "Publish a completed task's durable report into the current session",
    getArgumentCompletions: completeTaskArgument,
    handler: async (args, ctx) => {
      try {
        const taskId = parseTeamTaskId(args, "team-report");
        const reportPath = resolve(taskPath(ctx.cwd, taskId), "completion-report.md");
        const report = await readFile(reportPath, "utf8");
        pi.sendMessage(completionReportMessage(taskId, `team/tasks/${taskId}/completion-report.md`, report), { triggerTurn: false });
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("team-cancel", {
    description: "Cancel the currently running team role and block the task",
    handler: async (_args, ctx) => {
      if (!activeRun) { ctx.ui.notify("No team task is active.", "info"); return; }
      activeRun.abortController.abort();
      ctx.ui.notify(`Cancelling ${activeRun.taskId}…`, "warning");
    },
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "interactive" && authorizedInteractiveTaskId && !activeUnblockDiscussion) {
      const taskId = authorizedInteractiveTaskId;
      let state = "authorized";
      try { state = (await readStatus(taskPath(ctx.cwd, taskId))).status.state; } catch { /* Keep the safe lock if task metadata cannot be read. */ }
      ctx.ui.notify(
        `Task ${taskId} is ${state}. Direct interactive Architect chat is disabled after /team-go. Use /team-status, /team-unblock for strategy, /team-resume after an owner-approved correction, or /team-discard.`,
        "warning",
      );
      return { action: "handled" };
    }
    if (activeRun && event.source === "interactive") {
      ctx.ui.notify(`Team task ${activeRun.taskId} is active. Use /team-status or /team-cancel; other input is blocked to preserve single-GPU sequencing.`, "warning");
      return { action: "handled" };
    }
    if (event.source === "interactive" && activeUnblockDiscussion && event.text.trim().toLowerCase() === "finalize recovery") {
      const recovery = activeUnblockDiscussion;
      const taskDir = taskPath(recovery.repo, recovery.taskId);
      await appendRecoveryDiscussion(taskDir, recovery.taskId, "FINALIZING", "- Owner requested formal recovery-plan.md finalization.");
      pendingUnblockRecovery = recovery;
      ctx.ui.notify(`${recovery.taskId}: Architect is formalizing the recovery plan; roles remain stopped.`, "info");
      return { action: "transform", text: architectUnblockFinalizeKickoff(recovery.taskId) };
    }
    if (event.source === "interactive" && event.text.trim().toLowerCase() === "go" && await exists(resolve(ctx.cwd, "team/validate_goal_contract.py"))) {
      ctx.ui.notify("Plain 'go' cannot authorize team execution. Use /team-go <task-id>.", "warning");
      return { action: "handled" };
    }
  });

  pi.on("agent_end", async (event) => {
    if (!pendingArchitectValidation && !pendingUnblockRecovery && !activeUnblockDiscussion) return;
    const assistant = [...event.messages].reverse().find((message) => message.role === "assistant");
    pendingArchitectStopReason = assistant?.role === "assistant" ? assistant.stopReason : undefined;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const recovery = pendingUnblockRecovery;
    if (recovery) {
      let recoveryRun: ActiveRun;
      try {
        recoveryRun = reserveRun(recovery.taskId);
      } catch (error) {
        await releaseInteractiveInferenceLease(ctx);
        ctx.ui.notify(`${recovery.taskId}: recovery finalization could not reserve the workflow slot: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }
      await releaseInteractiveInferenceLease(ctx);
      let workflowOwnsRun = false;
      const stopReason = pendingArchitectStopReason;
      pendingArchitectStopReason = undefined;
      if (stopReason && stopReason !== "stop") {
        releaseRun(recoveryRun);
        if (pendingUnblockRecovery === recovery) pendingUnblockRecovery = undefined;
        await appendRecoveryDiscussion(taskPath(recovery.repo, recovery.taskId), recovery.taskId, "FINALIZATION_FAILED", `- Architect ended with stop reason: ${stopReason}.`);
        ctx.ui.notify(`${recovery.taskId}: Architect recovery ended with ${stopReason}; task remains BLOCKED.`, "warning");
        return;
      }
      let recoveryEligible = false;
      const recoveryTaskDir = taskPath(recovery.repo, recovery.taskId);
      try {
        const taskDir = recoveryTaskDir;
        const plan = await readFile(resolve(taskDir, "recovery-plan.md"), "utf8");
        const disposition = recoveryDisposition(plan);
        if (!disposition) throw new Error("recovery-plan.md must contain an exact ## Disposition of RESUME or ESCALATE");
        if (disposition === "ESCALATE") {
          activeUnblockDiscussion = recovery;
          await appendRecoveryDiscussion(taskDir, recovery.taskId, "ESCALATED", "- Architect finalized recovery-plan.md with disposition ESCALATE; owner decision required.");
          ctx.ui.notify(`${recovery.taskId}: Architect needs an owner decision; read ${resolve(taskDir, "recovery-plan.md")} and reply in this recovery session.`, "warning");
          return;
        }
        activeUnblockDiscussion = undefined;
        const { status } = await readStatus(taskDir);
        if (status.state !== "BLOCKED" || !status.executionAuthorizedAt) {
          throw new Error(`cannot resume: expected an authorized BLOCKED task, found ${status.state}`);
        }
        recoveryEligible = true;
        const taskConfig = await loadOrCreateTaskConfig(taskDir, configuredTeam);
        await enterTeamMode(recovery.repo, taskConfig);
        const snapshot = await ensureAuthorizationSnapshot(recovery.repo, taskDir, true);
        if (snapshot.migrated) {
          ctx.ui.notify(`Legacy authorization migrated after owner-finalized recovery: HEAD ${snapshot.authorizationHead}, contract SHA-256 ${snapshot.contractDigest}.`, "warning");
        }
        const recoveryCeiling = recoveryReviewCeiling(status.reviewCycle, status.maxReviewCycles);
        await setState(taskDir, "EXECUTING", {
          blocked_reason: "null",
          max_review_cycles: String(recoveryCeiling),
        });
        await shell("git add -N .", recovery.repo, undefined, 60_000);
        await validate(recovery.repo, taskDir, "execution");
        await appendRecoveryDiscussion(
          taskDir,
          recovery.taskId,
          "RESUMED",
          `- Architect finalized recovery-plan.md with disposition RESUME.\n- Review capacity: ${status.reviewCycle}/${status.maxReviewCycles} → ${status.reviewCycle}/${recoveryCeiling}.\n- Builder → Reviewer restart authorized within the existing Goal Contract.`,
        );
        authorizedInteractiveTaskId = recovery.taskId;
        void executeWorkflow(recovery.repo, recovery.taskId, ctx as ExtensionCommandContext, taskConfig, recoveryRun).catch(() => undefined);
        workflowOwnsRun = true;
        ctx.ui.notify(`${recovery.taskId}: Architect recovery approved an in-contract resume. Builder → Reviewer restarted.`, "info");
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (recoveryEligible) {
          const current = await readStatus(recoveryTaskDir).catch(() => undefined);
          if (current?.status.state !== "COMPLETED") await blockTask(recoveryTaskDir, detail);
        }
        await appendRecoveryDiscussion(recoveryTaskDir, recovery.taskId, "FINALIZATION_FAILED", `- Recovery plan could not be applied: ${detail}`);
        ctx.ui.notify(`${recovery.taskId}: recovery plan did not resume the task: ${detail}`, "error");
      } finally {
        if (!workflowOwnsRun) releaseRun(recoveryRun);
        if (pendingUnblockRecovery === recovery) pendingUnblockRecovery = undefined;
      }
      return;
    }

    await releaseInteractiveInferenceLease(ctx);
    const pending = pendingArchitectValidation;
    if (!pending) return;
    const stopReason = pendingArchitectStopReason;
    pendingArchitectStopReason = undefined;
    if (stopReason && stopReason !== "stop") {
      pendingArchitectValidation = undefined;
      ctx.ui.notify(`${pending.taskId}: Architect ended with ${stopReason}; automatic validation may be run with /team-validate, but no corrective run will be started.`, "warning");
      return;
    }
    const taskDir = taskPath(pending.repo, pending.taskId);
    try {
      await validate(pending.repo, taskDir, "pre-go");
      pendingArchitectValidation = undefined;
      ctx.ui.notify(`${pending.taskId}: Architect contract passed automatic pre-go validation. Use /team-go ${pending.taskId} to authorize execution.`, "info");
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      if (pending.repairAttempts >= 2) {
        pendingArchitectValidation = undefined;
        ctx.ui.notify(`${pending.taskId}: automatic validation still fails after 3 Architect passes.\n${failure}`, "error");
        return;
      }
      pending.repairAttempts += 1;
      ctx.ui.notify(`${pending.taskId}: automatic validation failed; requesting Architect correction (${pending.repairAttempts}/3).`, "warning");
      pi.sendUserMessage(
        `Extension-owned pre-go validation failed for task ${pending.taskId}. Correct only its existing brief.md and status.yaml without removing their strict schema, then finish. The extension will validate again automatically.\n\n${failure}`,
      );
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    const isRecoveryDiscussion = (path: string) => /^team\/tasks\/[a-z0-9][a-z0-9._-]*\/recovery-discussion\.md$/i.test(path.replace(/^\.\//, ""));
    if (event.toolName === "subagent" && await exists(resolve(ctx.cwd, "team/validate_goal_contract.py"))) {
      return { block: true, reason: "Direct subagent calls are disabled in initialized team repositories. Use /team-go so the extension enforces models, errors, and transitions." };
    }
    if (isToolCallEventType("write", event)) {
      if (isRecoveryDiscussion(event.input.path)) return { block: true, reason: "recovery-discussion.md is extension-owned owner context and must not be edited by an agent." };
      const target = draftContractFile(ctx.cwd, event.input.path);
      if (!target) return;
      try {
        await assertDraftMutation(ctx.cwd, target, event.input.content);
      } catch (error) {
        return { block: true, reason: `Draft contract schema guard: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    if (isToolCallEventType("edit", event)) {
      if (isRecoveryDiscussion(event.input.path)) return { block: true, reason: "recovery-discussion.md is extension-owned owner context and must not be edited by an agent." };
      const target = draftContractFile(ctx.cwd, event.input.path);
      if (!target) return;
      try {
        const original = await readFile(resolve(ctx.cwd, event.input.path), "utf8");
        await assertDraftMutation(ctx.cwd, target, applyEdits(original, event.input.edits));
      } catch (error) {
        return { block: true, reason: `Draft contract schema guard: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
  });

  pi.on("before_provider_request", (_event, ctx) => {
    if (!ctx.model || !configuredTeam.lifecycle.managedProviders.includes(ctx.model.provider)) return;
    const workflowOwnsLease = Boolean((activeRun?.leaseAcquired || activeRun?.legacyInferenceReady) && !activeRun?.leaseFailure);
    const interactiveOwnsLease = Boolean((interactiveInferenceLease?.leaseAcquired || interactiveInferenceLease?.legacyInferenceReady) && !interactiveInferenceLease?.leaseFailure);
    if (workflowOwnsLease || interactiveOwnsLease) return;
    ctx.abort();
    throw new Error("Managed provider request blocked because no healthy global inference lease is active");
  });

  pi.on("model_select", async (event, ctx) => {
    if (!configuredTeam.lifecycle.managedProviders.includes(event.model.provider)) return;
    try {
      await enterTeamMode(ctx.cwd, configuredTeam);
      ctx.ui.notify(`Team inference ready for ${event.model.provider}/${event.model.id}`, "info");
    } catch (error) {
      ctx.ui.notify(`Could not start managed inference for ${event.model.provider}: ${String(error)}`, "error");
      throw error;
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (ctx.model && configuredTeam.lifecycle.managedProviders.includes(ctx.model.provider) && !activeRun) {
      if (interactiveInferenceLease) throw new Error("An interactive inference lease is already active");
      const lease: ActiveRun = {
        taskId: "interactive",
        abortController: new AbortController(),
        abortAgent: () => ctx.abort(),
      };
      try {
        await acquireInferenceLease(lease, ctx.cwd, configuredTeam);
        interactiveInferenceLease = lease;
      } catch (error) {
        ctx.abort();
        await releaseInferenceLease(lease, ctx.cwd, configuredTeam).catch(() => undefined);
        ctx.ui.notify(`Managed inference request stopped because the global lease could not be acquired: ${error instanceof Error ? error.message : String(error)}`, "error");
        throw error;
      }
    }
    const unblockTask = /^<!-- three-agent-team-unblock-task: ([a-z0-9][a-z0-9._-]*) -->/m.exec(event.prompt)?.[1];
    const unblockDiscussionTask = /^<!-- three-agent-team-unblock-discussion-task: ([a-z0-9][a-z0-9._-]*) -->/m.exec(event.prompt)?.[1];
    const architectTask = /^<!-- three-agent-team-architect-task: ([a-z0-9][a-z0-9._-]*) -->/m.exec(event.prompt)?.[1]
      ?? /\/skill:grill-me[\s\S]*?task ([a-z0-9][a-z0-9._-]*) while acting only as Architect/.exec(event.prompt)?.[1];
    if (unblockTask && await exists(resolve(ctx.cwd, "team/validate_goal_contract.py"))) {
      pendingUnblockRecovery = { repo: ctx.cwd, taskId: unblockTask };
      activeUnblockDiscussion = undefined;
      authorizedInteractiveTaskId = unblockTask;
      pendingArchitectStopReason = undefined;
    } else if (unblockDiscussionTask && await exists(resolve(ctx.cwd, "team/validate_goal_contract.py"))) {
      activeUnblockDiscussion = { repo: ctx.cwd, taskId: unblockDiscussionTask };
      authorizedInteractiveTaskId = unblockDiscussionTask;
      pendingArchitectStopReason = undefined;
    } else if (architectTask && await exists(resolve(ctx.cwd, "team/validate_goal_contract.py"))) {
      pendingArchitectValidation = { repo: ctx.cwd, taskId: architectTask, repairAttempts: 0 };
      pendingArchitectStopReason = undefined;
    }
    if (!(await exists(resolve(ctx.cwd, "team/validate_goal_contract.py")))) return;
    const lifecycleConstraint = authorizedInteractiveTaskId
      ? `Task ${authorizedInteractiveTaskId} is already authorized. Direct interactive role work is prohibited; use only the extension lifecycle commands.`
      : "Architect may discuss and write a structurally valid contract, but must never invoke subagent directly or treat plain `go` as authorization. Owner execution uses `/team-go <task-id>`.";
    return {
      systemPrompt: event.systemPrompt + `\n\nThree-agent runtime is extension-controlled. ${lifecycleConstraint}`
    };
  });

  pi.on("session_shutdown", async () => {
    const workflow = activeRun;
    workflow?.abortController.abort();
    if (workflow?.leaseOwner && workflow.leaseRepo && workflow.leaseConfig) {
      await releaseInferenceLease(workflow, workflow.leaseRepo, workflow.leaseConfig).catch(() => undefined);
    }
    const lease = interactiveInferenceLease;
    interactiveInferenceLease = undefined;
    if (lease) await releaseInferenceLease(lease, completionCwd, configuredTeam).catch(() => undefined);
  });
}
