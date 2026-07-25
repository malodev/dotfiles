import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertDraftContractShape,
  assertTeamGrillable,
  buildTeamGrillPrompt,
  completeTeamNewTaskId,
  localTaskDatePrefix,
  orderSuccessTests,
  parseReviewVerdict,
  parseStatus,
  parseSuccessTests,
  parseTeamNewArgs,
  parseTeamTaskId,
  recoveryReviewCeiling,
} from "./core.ts";
import { archiveTask, completionReportMessage, taskArgumentCompletions } from "./index.ts";
import {
  loadOrCreateTaskConfig,
  parseTeamConfig,
  roleModel,
} from "./config.ts";
import {
  STALE_STREAM_ERROR,
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
  lifecycle: { managedProviders: ["pi-llama"], enterTeamCommand: "true", restoreStudioAfterRun: false },
});
const teamConfig = parseTeamConfig(configText, "/tmp/team-config.json");

const status = `task_id: sample
state: DISCUSSING
baseline_commit: 0123456789012345678901234567890123456789
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

test("approved recovery guarantees exactly one available review cycle at the ceiling", () => {
  assert.equal(recoveryReviewCeiling(5, 5), 6);
  assert.equal(recoveryReviewCeiling(3, 5), 5);
  assert.throws(() => recoveryReviewCeiling(-1, 5), /Invalid review-cycle values/);
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
  const ordered = orderSuccessTests(parseSuccessTests(brief));
  assert.deepEqual(ordered.map((item) => item.id), ["ST-01", "ST-02"]);
});

test("requires exact review verdict heading", () => {
  assert.equal(parseReviewVerdict("# Review\n\n## Verdict\nAPPROVED\n"), "APPROVED");
  assert.throws(() => parseReviewVerdict("looks good"));
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
printf '%s\\n' "$@" > "${argsLog}"
printf '%s\\n' '{"type":"tool_execution_start","toolName":"read"}'
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","provider":"pi-llama","model":"pi/qwen","stopReason":"stop","content":[{"type":"text","text":"READY"}]}}'
`);
  await chmod(fakePi, 0o700);
  const previous = process.env.PI_THREE_AGENT_PI_BIN;
  process.env.PI_THREE_AGENT_PI_BIN = fakePi;
  try {
    const result = await runRole({
      role: "builder",
      config: teamConfig,
      cwd: dir,
      task: "test",
      promptPath: prompt,
      timeoutMs: 5000,
      sessionId,
      sessionDir,
    });
    assert.equal(result.error, undefined);
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
