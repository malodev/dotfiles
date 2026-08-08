import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  archiveAuthorizationRecord,
  createAuthorizationRecord,
  defaultAuthorizationStateRoot,
  readAuthorizationRecord,
  writeAuthorizationRecord,
} from "./authorization.ts";
import {
  assertDraftContractShape,
  activeRunDenial,
  assertTeamGrillable,
  authorizationSnapshotKind,
  buildTeamGrillPrompt,
  completeTeamNewTaskId,
  completionParent,
  localTaskDatePrefix,
  orderSuccessTests,
  preReviewSuccessTests,
  parseReviewVerdict,
  parseStatus,
  parseSuccessTests,
  parseTeamEnqueueArgs,
  parseTeamNewArgs,
  parseTeamTaskId,
  recoveryReviewCeiling,
  releaseInteractiveGuard,
  releaseOwnedSlot,
} from "./core.ts";
import threeAgentTeamExtension, { archiveTask, completionReportMessage, currentCompletionParent, runPreReviewVerification, SuccessTestCommandFailure, taskArgumentCompletions } from "./index.ts";
import { acquireAdvisoryLock } from "./durable-state.ts";
import {
  loadOrCreateTaskConfig,
  parseTeamConfig,
  roleModel,
} from "./config.ts";
import {
  MISSING_FINISH_REASON_ERROR,
  STALE_STREAM_ERROR,
  hasTerminalEnvelopeDespiteMissingFinishReason,
  isContinuableLengthRoleResult,
  isRetryableStaleRoleResult,
  runRole,
  type RoleResult,
} from "./runner.ts";

const configText = JSON.stringify({
  version: 1,
  providers: {
    "pi-llama": {
      name: "test router",
      baseUrl: "http://127.0.0.1:46757/v1",
      api: "openai-completions",
      apiKey: "test-key",
      authHeader: true,
    },
  },
  roles: {
    architect: {
      provider: "pi-llama", model: "pi/gemma", name: "Gemma", reasoning: true,
      input: ["text"], contextWindow: 110000, maxTokens: 32768, thinking: "high",
    },
    builder: {
      provider: "pi-llama", model: "pi/qwen", name: "Qwen", reasoning: true,
      input: ["text"], contextWindow: 120000, maxTokens: 32768, thinking: "high",
    },
    reviewer: {
      provider: "pi-llama", model: "pi/gemma", name: "Gemma", reasoning: true,
      input: ["text"], contextWindow: 110000, maxTokens: 32768, thinking: "high",
    },
  },
  limits: { builderAttempts: 16, reviewerAttempts: 4, roleTimeoutSeconds: 7200, idleTimeoutSeconds: 300 },
  lifecycle: {
    managedProviders: ["pi-llama"],
    enterTeamCommand: "true",
    leaseTtlSeconds: 300,
    leaseRenewIntervalSeconds: 100,
    restoreStudioAfterRun: false,
  },
});
const teamConfig = parseTeamConfig(configText, "/tmp/team-config.json");

const status = `task_id: sample
state: DISCUSSING
baseline_commit: 0123456789012345678901234567890123456789
authorization_head: null
contract_digest: null
execution_authorized_at: null
review_cycle: 0
max_review_cycles: 5
completion_policy:
  commit_on_success: false
  push_on_success: false
  deploy_on_success: false
`;

const brief = `# Goal Contract: sample

## Success tests
### ST-02: write only after offline
- Command: \`hardware-test\`
- Expected exit code: \`0\`
- Expected evidence: upload succeeds
- Writes hardware/system state: \`yes\`
- Prerequisites: \`ST-01\`

### ST-01: offline
- Command: \`pytest -q\`
- Expected exit code: \`0\`
- Expected evidence: tests pass
- Writes hardware/system state: \`no\`
- Prerequisites: \`none\`

## Non-goals
none
`;

test("parses strict status", () => {
  const parsed = parseStatus(status);
  assert.equal(parsed.taskId, "sample");
  assert.equal(parsed.state, "DISCUSSING");
  assert.equal(parsed.authorizationHead, null);
  assert.equal(parsed.contractDigest, null);
  assert.equal(parsed.completionPolicy.commitOnSuccess, false);
});

test("preserves the strict draft schema before final pre-go validation", () => {
  const fullBrief = `# Goal Contract: sample

## Goal
x
## Current behavior
x
## Agreed approach
x
## Success tests
### ST-01: offline
- Command: \`pytest -q\`
- Expected exit code: \`0\`
- Expected evidence: tests pass
- Writes hardware/system state: \`no\`
- Prerequisites: \`none\`
## Non-goals
x
## Relevant files
x
## Architectural constraints
x
## Verification commands
\`pytest -q\`
## Baseline commit
0123456789012345678901234567890123456789
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
still being discussed
## Execution authorization
PENDING
`;
  assert.doesNotThrow(() => assertDraftContractShape(fullBrief, status, "sample", "0123456789012345678901234567890123456789"));
  assert.throws(
    () => assertDraftContractShape("## Goal\nfree-form replacement", "status: pending\n", "sample", "0123456789012345678901234567890123456789"),
    /Goal Contract heading/,
  );
  assert.throws(
    () => assertDraftContractShape(fullBrief, status.replace("state: DISCUSSING", "state: EXECUTING"), "sample", "0123456789012345678901234567890123456789"),
    /remain DISCUSSING/,
  );
  assert.throws(
    () => assertDraftContractShape(fullBrief.replace("`pytest -q`", "`pytest -q` (manual step)"), status, "sample", "0123456789012345678901234567890123456789"),
    /success tests must remain parser-valid.*ST-01 is not structurally complete/,
  );
  assert.throws(
    () => assertDraftContractShape(fullBrief.replace("Writes hardware/system state: `no`", "Writes hardware/system state: `yes`"), status, "sample", "0123456789012345678901234567890123456789"),
    /ST-01 writes hardware\/system state and must directly depend on a non-writing success test/,
  );
});

test("parses strict team-enqueue arguments", () => {
  assert.deepEqual(parseTeamEnqueueArgs("task-a"), { taskId: "task-a", dependsOn: [] });
  assert.deepEqual(
    parseTeamEnqueueArgs("task-c --after task-a,task-b"),
    { taskId: "task-c", dependsOn: ["task-a", "task-b"] },
  );
  assert.throws(() => parseTeamEnqueueArgs(""), /Missing task ID.*Usage:/);
  assert.throws(() => parseTeamEnqueueArgs("task-a --after"), /Malformed queue arguments.*Usage:/);
  assert.throws(() => parseTeamEnqueueArgs("task-a --before task-b"), /Malformed queue arguments.*Usage:/);
  assert.throws(() => parseTeamEnqueueArgs("task-a --after task-b, task-c"), /Malformed queue arguments.*Usage:/);
  assert.throws(() => parseTeamEnqueueArgs("task-a --after task-b,"), /comma-separated list/);
  assert.throws(() => parseTeamEnqueueArgs("task-a --after Task-B"), /uppercase letters are not allowed.*task-b/);
  assert.throws(() => parseTeamEnqueueArgs("task-a --after task-a"), /cannot depend on itself/);
  assert.throws(() => parseTeamEnqueueArgs("task-a --after task-b,task-b"), /must be unique/);
});

test("parses team-new arguments and explains each malformed form", () => {
  assert.deepEqual(
    parseTeamNewArgs("2026-07-20-rt100-gui-refine-ux -- Explain the daemon"),
    { taskId: "2026-07-20-rt100-gui-refine-ux", request: "Explain the daemon" },
  );
  assert.throws(
    () => parseTeamNewArgs("2026-07-20-rt100-gui-refine-UX -- Explain the daemon"),
    /uppercase letters are not allowed.*2026-07-20-rt100-gui-refine-ux/,
  );
  assert.throws(() => parseTeamNewArgs(""), /Missing task ID and task request/);
  assert.throws(() => parseTeamNewArgs("-- Explain the daemon"), /Missing task ID before/);
  assert.throws(() => parseTeamNewArgs("task Explain the daemon"), /Missing ` -- ` separator/);
  assert.throws(() => parseTeamNewArgs("task --"), /Missing task request after/);
  assert.throws(() => parseTeamNewArgs("task@bad -- Explain the daemon"), /Invalid task ID/);
});

test("completes team-new with the current local date prefix", () => {
  const date = new Date(2026, 6, 22, 23, 59, 59);
  assert.equal(localTaskDatePrefix(date), "2026-07-22-");
  assert.equal(completeTeamNewTaskId("", date), "2026-07-22-");
  assert.equal(completeTeamNewTaskId("2026-07", date), "2026-07-22-");
  assert.equal(completeTeamNewTaskId("rt100-lighting", date), "2026-07-22-rt100-lighting");
  assert.equal(completeTeamNewTaskId("2026-07-22-rt100", date), null);
  assert.equal(completeTeamNewTaskId("2026-07-22-task -- request", date), null);
});

test("archives a task instead of deleting its artifacts", async () => {
  const repo = await mkdtemp(join(tmpdir(), "three-agent-archive-test-"));
  const taskDir = join(repo, "team", "tasks", "sample");
  await mkdir(taskDir, { recursive: true });
  await writeFile(join(taskDir, "brief.md"), "preserved artifact\n");
  const archived = await archiveTask(repo, "sample", new Date("2026-07-24T12:34:56.789Z"));
  assert.match(archived, /team\/tasks\/\.discarded\/sample-2026-07-24T12-34-56-789Z$/);
  assert.equal(await readFile(join(archived, "brief.md"), "utf8"), "preserved artifact\n");
  await assert.rejects(readFile(join(taskDir, "brief.md"), "utf8"));
});

test("completes existing task IDs with persisted states", async () => {
  const repo = await mkdtemp(join(tmpdir(), "three-agent-completion-test-"));
  const tasksDir = join(repo, "team", "tasks");
  await mkdir(join(tasksDir, "2026-07-22-new-task"), { recursive: true });
  await mkdir(join(tasksDir, "2026-07-20-completed-task"), { recursive: true });
  await mkdir(join(tasksDir, ".template"), { recursive: true });
  await writeFile(join(tasksDir, "2026-07-22-new-task", "status.yaml"), status.replace("task_id: sample", "task_id: 2026-07-22-new-task"));
  await writeFile(
    join(tasksDir, "2026-07-20-completed-task", "status.yaml"),
    status.replace("task_id: sample", "task_id: 2026-07-20-completed-task").replace("state: DISCUSSING", "state: COMPLETED"),
  );

  assert.deepEqual(taskArgumentCompletions(repo, "2026-07-22"), [{
    value: "2026-07-22-new-task",
    label: "2026-07-22-new-task",
    description: "DISCUSSING",
  }]);
  assert.deepEqual(
    taskArgumentCompletions(repo, "")?.map((item) => item.value),
    ["2026-07-22-new-task", "2026-07-20-completed-task"],
  );
  assert.equal(taskArgumentCompletions(repo, "missing"), null);
  assert.equal(taskArgumentCompletions(repo, "one two"), null);
});

test("builds a guarded team-grill-me skill prompt", () => {
  const taskId = parseTeamTaskId("2026-07-20-rt100-gui-refine-ux", "team-grill-me");
  const prompt = buildTeamGrillPrompt(taskId);
  assert.match(prompt, /^\/skill:grill-me /);
  assert.match(prompt, /acting only as Architect/);
  assert.match(prompt, /update only those task files/);
  assert.match(prompt, /do not edit implementation, CONTEXT\.md, ADRs, or other project documentation now/);
  assert.match(prompt, /Do not authorize execution, invoke roles, or run \/team-go/);
  assert.throws(() => parseTeamTaskId("", "team-grill-me"), /Missing task ID/);
  assert.throws(() => parseTeamTaskId("one two", "team-grill-me"), /exactly one task ID/);
});

test("approved recovery guarantees one available review cycle only when capacity is exhausted", async () => {
  assert.equal(recoveryReviewCeiling(5, 5), 6);
  assert.equal(recoveryReviewCeiling(3, 5), 5);
  assert.throws(() => recoveryReviewCeiling(-1, 5), /Invalid review-cycle values/);

  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /enteringStatus\.state === "BLOCKED"[\s\S]*recoveryReviewCeiling\(enteringStatus\.reviewCycle, enteringStatus\.maxReviewCycles\)/);
});

test("classifies complete, legacy, and partial authorization snapshots", () => {
  assert.equal(authorizationSnapshotKind(null, null), "legacy");
  assert.equal(authorizationSnapshotKind("1".repeat(40), "2".repeat(64)), "complete");
  assert.throws(() => authorizationSnapshotKind("1".repeat(40), null), /Partial authorization snapshot/);
  assert.throws(() => authorizationSnapshotKind(null, "2".repeat(64)), /Partial authorization snapshot/);
});

test("releases only the matching task's interactive guard and run ownership", () => {
  assert.equal(releaseInteractiveGuard("task-a", "task-a"), undefined);
  assert.equal(releaseInteractiveGuard("task-a", "task-b"), "task-a");
  assert.equal(releaseInteractiveGuard(undefined, "task-a"), undefined);
  const first = { taskId: "first" };
  const second = { taskId: "second" };
  assert.equal(releaseOwnedSlot(first, first), undefined);
  assert.equal(releaseOwnedSlot(second, first), second);
});

test("does not let Builder-controlled environment redirect the authorization root", () => {
  const expected = defaultAuthorizationStateRoot();
  const previous = { HOME: process.env.HOME, XDG_STATE_HOME: process.env.XDG_STATE_HOME, PI_THREE_AGENT_STATE_DIR: process.env.PI_THREE_AGENT_STATE_DIR };
  process.env.HOME = "/tmp/attacker-home";
  process.env.XDG_STATE_HOME = "/tmp/attacker-state";
  process.env.PI_THREE_AGENT_STATE_DIR = "/tmp/attacker-override";
  try {
    assert.equal(defaultAuthorizationStateRoot(), expected);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("persists authorization outside the repository and archives it without deletion", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "three-agent-state-test-"));
  const repo = await mkdtemp(join(tmpdir(), "three-agent-auth-repo-"));
  const record = await createAuthorizationRecord(
    repo,
    "sample",
    "1".repeat(40),
    "2".repeat(64),
    "2026-07-26T00:00:00.000Z",
  );
  const capability = await acquireAdvisoryLock(join(stateDir, "test.lock"), "authorization test");
  try {
    await writeAuthorizationRecord(repo, record, capability, stateDir);
    assert.deepEqual(await readAuthorizationRecord(repo, "sample", stateDir), record);
    await assert.doesNotReject(writeAuthorizationRecord(repo, record, capability, stateDir));
    await assert.rejects(
      writeAuthorizationRecord(repo, { ...record, contractDigest: "3".repeat(64) }, capability, stateDir),
      /conflict/i,
    );
    await assert.rejects(createAuthorizationRecord(repo, "../escape", "1".repeat(40), "2".repeat(64), record.authorizedAt), /Invalid task ID/);
    assert.ok(await archiveAuthorizationRecord(repo, "sample", "2026-07-26T00-00-00-000Z", capability, stateDir));
    await assert.rejects(readAuthorizationRecord(repo, "sample", stateDir), /ENOENT/);
  } finally {
    await capability.release();
  }
});

test("centralizes active-run admission for Architect session commands", async () => {
  assert.equal(activeRunDenial(undefined, "team-new"), undefined);
  assert.match(activeRunDenial("running-task", "team-new") ?? "", /running-task.*team-new/);
  assert.match(activeRunDenial("running-task", "team-repair") ?? "", /running-task.*team-repair/);

  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /python \$\{JSON\.stringify\(CANONICAL_VALIDATOR\)\}/, "runtime validation must use the trusted bundled validator");
  assert.match(source, /readFile\(CANONICAL_ARCHITECT_PROMPT/, "Architect must use the trusted bundled policy");
  assert.match(source, /promptPath: CANONICAL_BUILDER_PROMPT/, "Builder must use the trusted bundled prompt");
  assert.match(source, /promptPath: CANONICAL_REVIEWER_PROMPT/, "Reviewer must use the trusted bundled prompt");
  assert.doesNotMatch(source, /promptPath: resolve\(repo, "team\/agents\/team-(?:builder|reviewer)\.md"\)/, "runtime must not load stale repository role prompts");
  assert.doesNotMatch(source, /python team\/validate_goal_contract\.py/, "runtime instructions must not invoke a stale repository validator");
  assert.ok(source.indexOf("await runPreReviewVerification") < source.indexOf('role: "reviewer"'), "exact offline commands must run before Reviewer");
  assert.match(source, /result\.code === 126 \|\| result\.code === 127/);
  assert.match(source, /machineReviewForTestFailure/);
  assert.match(source, /verification-failure-\$\{String\(cycle\)/);
  assert.match(source, /postReviewVerificationFinding/);
  assert.match(source, /owner does not need to dictate exact command strings or field-by-field edits/);
  assert.match(source, /Recovery plans cannot authorize edits to brief\.md\/status\.yaml, direct role invocation, commit, reset, checkout, history rewriting/);
  assert.match(source, /REBOUND_AFTER_RELOAD/);
  assert.match(source, /has no persisted recovery discussion; use \/team-unblock/);
  const idleCommands = ["team-new", "team-grill-me", "team-unblock", "team-repair", "team-go", "team-resume"];
  // The idle-admission and recovery-reservation logic itself lives in
  // session-state.ts; index.ts only calls through session.*.
  const sessionStateSource = await readFile(new URL("./session-state.ts", import.meta.url), "utf8");
  assert.match(sessionStateSource, /const recoveryTask = pendingUnblockRecovery\?\.taskId \?\? activeUnblockDiscussion\?\.taskId/);
  const finalizeRecoverySource = source.slice(source.indexOf("async function finalizeRecovery"));
  assert.ok(finalizeRecoverySource.indexOf("session.reserveRun(recovery.taskId)") < finalizeRecoverySource.indexOf("await "), "recovery must reserve its run before awaiting");
  for (const command of idleCommands) {
    const start = source.indexOf(`pi.registerCommand("${command}"`);
    const end = source.indexOf("pi.registerCommand(\"", start + 1);
    const handler = source.slice(start, end < 0 ? undefined : end);
    assert.match(handler, new RegExp(`session\\.requireIdle\\(ctx, ["']${command}["']\\)`), `${command} must enforce idle admission`);
    if (["team-go", "team-resume"].includes(command)) {
      assert.ok(handler.indexOf("session.reserveRun(taskId)") < handler.indexOf("await "), `${command} must reserve its run before awaiting`);
    }
    if (["team-resume", "team-discard"].includes(command)) {
      assert.match(handler, /session\.activeDiscussion\(\)/);
      assert.match(handler, /session\.pendingRecovery\(\)/);
    }
  }
});

test("bundled role policy cannot reintroduce repository-local validation blockers", async () => {
  const architect = await readFile(new URL("../../skills/init-three-agent-team/assets/team-workflow.md", import.meta.url), "utf8");
  const builder = await readFile(new URL("../../skills/init-three-agent-team/assets/team-builder.md", import.meta.url), "utf8");
  const reviewer = await readFile(new URL("../../skills/init-three-agent-team/assets/team-reviewer.md", import.meta.url), "utf8");
  assert.doesNotMatch(architect, /python team\/validate_goal_contract\.py/);
  assert.doesNotMatch(builder, /python team\/validate_goal_contract\.py/);
  assert.doesNotMatch(reviewer, /python team\/validate_goal_contract\.py/);
  assert.match(architect, /extension automatically runs its trusted bundled pre-go validator/);
  assert.match(builder, /authorization_head.*ancestor/);
  assert.match(builder, /Do not modify `brief\.md`, `status\.yaml`/);
  assert.match(reviewer, /authorization_head.*ancestor/);
  assert.match(reviewer, /expected extension-owned audit evidence/);
  assert.match(reviewer, /untracked files outside that task directory as unexpected/);
});

test("wraps workflows and interactive turns in renewable inference leases", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const sessionStateSource = await readFile(new URL("./session-state.ts", import.meta.url), "utf8");
  assert.match(source, /await acquireInferenceLease\(run, repo, config\)/);
  assert.match(source, /leaseRenewIntervalSeconds \* 1000/);
  assert.match(source, /run\.leaseFailure = new Error/);
  assert.match(source, /await releaseInferenceLease\(run, repo, config\)/);
  assert.match(source, /await acquireInferenceLease\(lease, ctx\.cwd, configuredTeam\)/);
  assert.match(source, /await releaseInteractiveInferenceLease\(session, configuredTeam, ctx\)/);
  assert.match(source, /abortAgent: \(\) => ctx\.abort\(\)/);
  assert.match(source, /before_provider_request[\s\S]*?no healthy global inference lease/);
  // session_shutdown delegates to session.shutdown(); the lease-release
  // sequence itself lives in session-state.ts alongside the other slots.
  assert.match(source, /session_shutdown[\s\S]*?await session\.shutdown\(completionCwd\)/);
  assert.match(sessionStateSource, /await releaseInferenceLease\(workflow/);
});

test("aborts a failed interactive lease without installing a permanent provider gate", async () => {
  const raw = JSON.parse(configText);
  raw.lifecycle.acquireTeamCommand = "false";
  raw.lifecycle.renewTeamCommand = "true";
  raw.lifecycle.releaseTeamCommand = "true";
  const directory = await mkdtemp(join(tmpdir(), "three-agent-lease-gate-"));
  const configPath = join(directory, "config.json");
  await writeFile(configPath, JSON.stringify(raw));
  const handlers = new Map<string, Function[]>();
  const fakePi = {
    on(name: string, handler: Function) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand() {},
  };
  const previous = process.env.PI_THREE_AGENT_CONFIG;
  process.env.PI_THREE_AGENT_CONFIG = configPath;
  try {
    await threeAgentTeamExtension(fakePi as any);
  } finally {
    if (previous === undefined) delete process.env.PI_THREE_AGENT_CONFIG;
    else process.env.PI_THREE_AGENT_CONFIG = previous;
  }
  let aborts = 0;
  const ctx = {
    cwd: directory,
    model: { provider: "pi-llama", id: "pi/gemma" },
    abort() { aborts += 1; },
    ui: { notify() {} },
  };
  await assert.rejects(
    handlers.get("before_agent_start")![0]({ prompt: "hello", systemPrompt: "base" }, ctx),
    /Could not acquire the global inference lease/,
  );
  assert.equal(aborts, 1);
  assert.doesNotThrow(
    () => handlers.get("before_provider_request")![0]({ payload: {} }, ctx),
  );
  assert.equal(aborts, 1);
});

test("documents every registered team command", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const readme = await readFile(new URL("./README.md", import.meta.url), "utf8");
  const commands = [...source.matchAll(/pi\.registerCommand\("(team-[^"]+)"/g)].map((match) => match[1]);
  assert.ok(commands.length > 0);
  for (const command of commands) assert.ok(readme.includes(`/${command}`), `README must document /${command}`);
});

test("builds a persistent completion message with canonical report content", () => {
  const message = completionReportMessage("sample", "team/tasks/sample/completion-report.md", "# Completion Report\n\nAll passed.");
  assert.equal(message.customType, "three-agent-team-completion");
  assert.equal(message.display, true);
  assert.match(message.content, /sample.*completed/s);
  assert.match(message.content, /team\/tasks\/sample\/completion-report\.md/);
  assert.match(message.content, /All passed\./);
});

test("allows grilling only for the matching unauthorized DISCUSSING task", () => {
  const parsed = parseStatus(status);
  assert.doesNotThrow(() => assertTeamGrillable(parsed, "sample"));
  assert.throws(() => assertTeamGrillable({ ...parsed, state: "EXECUTING" }, "sample"), /cannot be grilled/);
  assert.throws(
    () => assertTeamGrillable({ ...parsed, executionAuthorizedAt: "2026-07-20T00:00:00Z" }, "sample"),
    /recorded execution authorization/,
  );
  assert.throws(() => assertTeamGrillable(parsed, "another-task"), /metadata mismatch/);
});

test("orders success tests by prerequisites", () => {
  const tests = parseSuccessTests(brief);
  const ordered = orderSuccessTests(tests);
  assert.deepEqual(ordered.map((item) => item.id), ["ST-01", "ST-02"]);
  assert.deepEqual(preReviewSuccessTests(tests).map((item) => item.id), ["ST-01"]);
});

test("pre-review gate runs only prerequisite-safe non-writing commands and classifies exit 127", async () => {
  const repo = await mkdtemp(join(tmpdir(), "three-agent-pre-review-"));
  const taskDir = join(repo, "team", "tasks", "sample");
  await mkdir(taskDir, { recursive: true });
  const renderBrief = (offlineCommand: string) => `# Goal Contract: sample

## Success tests
### ST-01: offline
- Command: \`${offlineCommand}\`
- Expected exit code: \`0\`
- Expected evidence: offline command passes
- Writes hardware/system state: \`no\`
- Prerequisites: \`none\`

### ST-02: hardware
- Command: \`exit 99\`
- Expected exit code: \`0\`
- Expected evidence: hardware command passes
- Writes hardware/system state: \`yes\`
- Prerequisites: \`ST-01\`

## Non-goals
none
`;
  await writeFile(join(taskDir, "brief.md"), renderBrief("printf offline-ok"));
  await runPreReviewVerification(repo, taskDir, new AbortController().signal, () => {});
  const log = await readFile(join(taskDir, "pre-review-verification.log"), "utf8");
  assert.match(log, /offline-ok/);
  assert.doesNotMatch(log, /exit 99/);

  await writeFile(join(taskDir, "brief.md"), renderBrief("definitely-missing-command argument"));
  await assert.rejects(
    runPreReviewVerification(repo, taskDir, new AbortController().signal, () => {}),
    (error: unknown) => error instanceof SuccessTestCommandFailure && error.commandUnavailable && error.actualExitCode === 127,
  );
});

test("completion preserves forward commits but rejects a rewind before authorization", async () => {
  const authorizationHead = "b".repeat(40);
  assert.equal(completionParent({ authorizationHead }), authorizationHead);
  assert.equal(completionParent({ authorizationHead }, "c".repeat(40)), "c".repeat(40));
  assert.throws(() => completionParent({ authorizationHead: null }), /authorization head/);

  const repo = await mkdtemp(join(tmpdir(), "three-agent-forward-head-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  await writeFile(join(repo, "file.txt"), "baseline\n");
  git("add", "file.txt");
  git("commit", "-qm", "baseline");
  const baseline = git("rev-parse", "HEAD");
  await writeFile(join(repo, "file.txt"), "authorized\n");
  git("commit", "-qam", "authorization");
  const authorization = git("rev-parse", "HEAD");
  await writeFile(join(repo, "file.txt"), "builder commit\n");
  git("commit", "-qam", "builder commit");
  const forward = git("rev-parse", "HEAD");

  assert.equal(await currentCompletionParent(repo, authorization), forward);
  git("update-ref", "--no-deref", "HEAD", baseline);
  await assert.rejects(currentCompletionParent(repo, authorization), /non-descendant HEAD/);
});

test("requires exact review verdict heading", () => {
  assert.equal(parseReviewVerdict("# Review\n\n## Verdict\nAPPROVED\n"), "APPROVED");
  assert.throws(() => parseReviewVerdict("looks good"));
});

test("requires a complete renewable inference lease lifecycle", () => {
  const raw = JSON.parse(configText);
  raw.lifecycle.acquireTeamCommand = "pi-inference acquire";
  assert.throws(() => parseTeamConfig(JSON.stringify(raw)), /must be configured together/);
  raw.lifecycle.renewTeamCommand = "pi-inference renew";
  raw.lifecycle.releaseTeamCommand = "pi-inference release";
  raw.lifecycle.leaseRenewIntervalSeconds = raw.lifecycle.leaseTtlSeconds;
  assert.throws(() => parseTeamConfig(JSON.stringify(raw)), /leave at least 90 seconds/);
  raw.lifecycle.leaseRenewIntervalSeconds = 100;
  const parsed = parseTeamConfig(JSON.stringify(raw));
  assert.equal(parsed.lifecycle.acquireTeamCommand, "pi-inference acquire");
});

test("defaults and validates queue timing independently of inference lifecycle", () => {
  assert.deepEqual(teamConfig.queue, {
    leaseTtlSeconds: 120,
    heartbeatIntervalSeconds: 30,
    executionLockTimeoutSeconds: 30,
    localExpiryMarginSeconds: 15,
  });

  const raw = JSON.parse(configText);
  raw.queue = {
    leaseTtlSeconds: 180,
    heartbeatIntervalSeconds: 40,
    executionLockTimeoutSeconds: 20,
    localExpiryMarginSeconds: 30,
  };
  const parsed = parseTeamConfig(JSON.stringify(raw));
  assert.deepEqual(parsed.queue, raw.queue);
  assert.deepEqual(parsed.lifecycle, teamConfig.lifecycle);

  raw.queue.heartbeatIntervalSeconds = 150;
  assert.throws(() => parseTeamConfig(JSON.stringify(raw)), /heartbeat and local expiry margin/);
  raw.queue.heartbeatIntervalSeconds = 40;
  raw.queue.executionLockTimeoutSeconds = 0;
  assert.throws(() => parseTeamConfig(JSON.stringify(raw)), /executionLockTimeoutSeconds must be a positive integer/);
});

test("loads configurable roles and snapshots task runtime choices", async () => {
  assert.equal(roleModel(teamConfig, "architect"), "pi-llama/pi/gemma");
  assert.equal(roleModel(teamConfig, "builder"), "pi-llama/pi/qwen");
  assert.equal(teamConfig.roles.builder.maxTokens, 32768);
  assert.deepEqual(teamConfig.lifecycle.managedProviders, ["pi-llama"]);
  const taskDir = await mkdtemp(join(tmpdir(), "three-agent-config-test-"));
  const taskConfig = await loadOrCreateTaskConfig(taskDir, teamConfig);
  assert.equal(taskConfig.roles.reviewer.model, "pi/gemma");
  const snapshot = JSON.parse(await readFile(join(taskDir, "runtime-config.json"), "utf8"));
  assert.equal(snapshot.roles.builder.model, "pi/qwen");
  assert.equal(snapshot.limits.builderAttempts, 16);
  assert.equal("queue" in snapshot, false, "queue host timing must not enter task runtime snapshots");
  assert.deepEqual(taskConfig.queue, teamConfig.queue);
});

test("retries only exact-model tool-productive stale streams", () => {
  const result: RoleResult = {
    role: "builder",
    requestedModel: "pi-llama/pi/qwen",
    responseProvider: "pi-llama",
    responseModel: "pi/qwen",
    output: "",
    stderr: "",
    exitCode: 1,
    toolCount: 3,
    error: STALE_STREAM_ERROR,
  };
  assert.equal(isRetryableStaleRoleResult(result), true);
  assert.equal(isRetryableStaleRoleResult({ ...result, toolCount: 0 }), false);
  assert.equal(isRetryableStaleRoleResult({ ...result, responseProvider: undefined }), false);
  assert.equal(isRetryableStaleRoleResult({ ...result, responseModel: "wrong/model" }), false);
  assert.equal(isRetryableStaleRoleResult({ ...result, error: "different failure" }), false);
});

test("accepts a missing finish signal only with an otherwise exact terminal role envelope", () => {
  const result: RoleResult = {
    role: "builder",
    requestedModel: "pi-llama/pi/qwen",
    responseProvider: "pi-llama",
    responseModel: "pi/qwen",
    stopReason: "stop",
    output: "Build complete; build-report.md written.",
    stderr: "",
    exitCode: 0,
    toolCount: 3,
    error: MISSING_FINISH_REASON_ERROR,
  };
  assert.equal(hasTerminalEnvelopeDespiteMissingFinishReason(result), true);
  assert.equal(hasTerminalEnvelopeDespiteMissingFinishReason({ ...result, stopReason: undefined }), false);
  assert.equal(hasTerminalEnvelopeDespiteMissingFinishReason({ ...result, exitCode: 1 }), false);
  assert.equal(hasTerminalEnvelopeDespiteMissingFinishReason({ ...result, toolCount: 0 }), false);
  assert.equal(hasTerminalEnvelopeDespiteMissingFinishReason({ ...result, output: "" }), false);
  assert.equal(hasTerminalEnvelopeDespiteMissingFinishReason({ ...result, responseModel: "wrong/model" }), false);
});

test("continues exact-model length stops only after measurable progress", () => {
  const result: RoleResult = {
    role: "builder",
    requestedModel: "pi-llama/pi/qwen",
    responseProvider: "pi-llama",
    responseModel: "pi/qwen",
    stopReason: "length",
    output: "continue",
    stderr: "",
    exitCode: 0,
    toolCount: 44,
  };
  assert.equal(isContinuableLengthRoleResult(result), true);
  assert.equal(isContinuableLengthRoleResult({ ...result, output: "", toolCount: 0 }), false);
  assert.equal(isContinuableLengthRoleResult({ ...result, responseModel: "wrong" }), false);
  assert.equal(isContinuableLengthRoleResult({ ...result, error: "transport error" }), false);
});

test("role runner treats a productive length stop as a clean continuation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "three-agent-length-test-"));
  const fakePi = join(dir, "pi-fake");
  const prompt = join(dir, "agent.md");
  await writeFile(prompt, "Role body\n");
  await writeFile(fakePi, `#!/bin/sh
printf '%s\\n' '{"type":"tool_execution_start","toolName":"read"}'
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","provider":"pi-llama","model":"pi/qwen","stopReason":"length","content":[{"type":"text","text":"measurable progress"}]}}'
`);
  await chmod(fakePi, 0o700);
  const previous = process.env.PI_THREE_AGENT_PI_BIN;
  process.env.PI_THREE_AGENT_PI_BIN = fakePi;
  try {
    const result = await runRole({ role: "builder", config: teamConfig, cwd: dir, task: "test", promptPath: prompt, timeoutMs: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.stopReason, "length");
    assert.equal(isContinuableLengthRoleResult(result), true);
  } finally {
    if (previous === undefined) delete process.env.PI_THREE_AGENT_PI_BIN;
    else process.env.PI_THREE_AGENT_PI_BIN = previous;
  }
});

test("role runner uses configured model, isolated agent config, persistent session, and sandbox", async () => {
  const dir = await mkdtemp(join(tmpdir(), "three-agent-runner-test-"));
  const fakePi = join(dir, "pi-fake");
  const prompt = join(dir, "agent.md");
  const argsLog = join(dir, "args.log");
  const startedMarker = join(dir, "started.marker");
  const sessionDir = join(dir, "sessions");
  const sessionId = "01234567-89ab-4cde-af01-23456789abcd";
  await writeFile(prompt, "---\nname: fake\ndescription: fake\n---\nRole body\n");
  await writeFile(fakePi, `#!/bin/sh
test ! -e /dev/hidraw5 || exit 91
test ! -S "/run/user/$(id -u)/bus" || exit 92
test ! -S /run/dbus/system_bus_socket || exit 93
test "$npm_config_cache" = /tmp/pi-three-agent-npm-cache || exit 94
test "$UV_CACHE_DIR" = /tmp/pi-three-agent-uv-cache || exit 95
test "$XDG_CACHE_HOME" = /tmp/pi-three-agent-xdg-cache || exit 96
test -f "$PI_CODING_AGENT_DIR/models.json" || exit 97
grep -q '"maxTokens": 32768' "$PI_CODING_AGENT_DIR/models.json" || exit 98
printf '%s\\n' started > "${startedMarker}"
printf '%s\\n' "$@" > "${argsLog}"
printf '%s\\n' '{"type":"tool_execution_start","toolName":"read"}'
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","provider":"pi-llama","model":"pi/qwen","stopReason":"stop","content":[{"type":"text","text":"READY"}]}}'
`);
  await chmod(fakePi, 0o700);
  const previous = process.env.PI_THREE_AGENT_PI_BIN;
  process.env.PI_THREE_AGENT_PI_BIN = fakePi;
  try {
    let recordedPid = 0;
    const result = await runRole({
      role: "builder",
      config: teamConfig,
      cwd: dir,
      task: "test",
      promptPath: prompt,
      timeoutMs: 5000,
      sessionId,
      sessionDir,
      onSpawn: async (identity) => {
        recordedPid = identity.pid;
        assert.equal(identity.role, "builder");
        assert.equal(identity.pgid, identity.pid);
        assert.match(identity.processStart, /^(proc|ps|conservative-pid):/);
        await assert.rejects(access(startedMarker), /ENOENT/);
      },
    });
    assert.equal(result.error, undefined);
    assert.ok(recordedPid > 1);
    assert.equal(await readFile(startedMarker, "utf8"), "started\n");
    assert.equal(result.output, "READY");
    assert.equal(result.responseProvider, "pi-llama");
    assert.equal(result.toolCount, 1);
    const args = (await readFile(argsLog, "utf8")).split("\n");
    assert.ok(args.includes("--model"));
    assert.ok(args.includes("pi-llama/pi/qwen"));
    assert.ok(args.includes("--session-id"));
    assert.ok(args.includes(sessionId));
    assert.ok(args.includes("--session-dir"));
    assert.ok(args.includes(sessionDir));
    assert.ok(!args.includes("--no-session"));
  } finally {
    if (previous === undefined) delete process.env.PI_THREE_AGENT_PI_BIN;
    else process.env.PI_THREE_AGENT_PI_BIN = previous;
  }
});
