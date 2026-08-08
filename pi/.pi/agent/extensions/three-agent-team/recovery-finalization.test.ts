/**
 * Unit tests for finalizeRecovery's branching — the recovery-finalization
 * state machine that Q4 of the session-state grilling flagged as the
 * priority: 158 lines with zero prior coverage anywhere in the suite.
 *
 * executeWorkflow is injected as `runWorkflow`, so these tests exercise
 * finalizeRecovery's own decisions (stop-reason abort, ESCALATE vs RESUME,
 * queued vs immediate resume, lock release on error) without a real
 * Builder/Reviewer role loop — no bwrap, no validator subprocess wait, no
 * fake model binary. team-go-completion.test.ts remains the one real
 * end-to-end check with an actual role loop.
 *
 * Some fixtures still touch the real, non-redirectable
 * ~/.local/state/pi-three-agent-team (authorization records, queue state) —
 * the same constraint team-go-completion.test.ts and session-state.test.ts
 * document. Each test removes exactly the repository-keyed subtree it
 * creates.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createAuthorizationRecord, writeAuthorizationRecord } from "./authorization.ts";
import { parseTeamConfig } from "./config.ts";
import { readStatus } from "./core.ts";
import { currentUid, defaultDurableStateRoot, identifyRepository } from "./durable-state.ts";
import { acquireRepositoryExecutionLock, atomicRepositoryWrite, inspectEnrollmentAdmission } from "./queue-repository.ts";
import { dispatchQueueOnce } from "./queue-dispatcher.ts";
import { openDurableQueue } from "./queue.ts";
import { createSessionState, type ActiveRun, type PendingUnblockRecovery } from "./session-state.ts";
// finalizeRecovery is not exported (index.ts's registrations are the
// production interface); import the module and reach it via the same
// technique core.test.ts already uses for index.ts internals — a direct
// named import works here because finalizeRecovery is a module-level
// function, just not part of the default export.
import { finalizeRecovery } from "./index.ts";

const configText = JSON.stringify({
  version: 1,
  providers: { "pi-llama": { name: "test", baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions", apiKey: "k", authHeader: true } },
  roles: {
    architect: { provider: "pi-llama", model: "pi/gemma", name: "Gemma", reasoning: true, input: ["text"], contextWindow: 2000, maxTokens: 1000, thinking: "high" },
    builder: { provider: "pi-llama", model: "pi/qwen", name: "Qwen", reasoning: true, input: ["text"], contextWindow: 2000, maxTokens: 1000, thinking: "high" },
    reviewer: { provider: "pi-llama", model: "pi/gemma", name: "Gemma", reasoning: true, input: ["text"], contextWindow: 2000, maxTokens: 1000, thinking: "high" },
  },
  limits: { builderAttempts: 16, reviewerAttempts: 4, roleTimeoutSeconds: 7200, idleTimeoutSeconds: 300 },
  lifecycle: { managedProviders: [], enterTeamCommand: "true", leaseTtlSeconds: 300, leaseRenewIntervalSeconds: 100, restoreStudioAfterRun: false },
});
const teamConfig = parseTeamConfig(configText, "/tmp/recovery-finalization-test-config.json");

function run(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(args[0], args.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk) => { err += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveRun(out.trim()) : reject(new Error(`${args.join(" ")} failed: ${err}`)));
  });
}

function fakeCtx() {
  const notifications: Array<{ message: string; level: string }> = [];
  return {
    cwd: "",
    notifications,
    ui: { notify(message: string, level: string) { notifications.push({ message, level }); } },
    abort() { throw new Error("unexpected abort() call"); },
  } as any;
}

function briefText(baseline: string): string {
  return `# Goal Contract: sample

## Goal
Verify recovery finalization branching.

## Current behavior
Task was blocked mid-execution.

## Agreed approach
Recover per the finalized recovery plan.

## Success tests
### ST-01: implementation exists
- Command: \`test -f implementation.txt\`
- Expected exit code: \`0\`
- Expected evidence: implementation.txt exists
- Writes hardware/system state: \`no\`
- Prerequisites: \`none\`

## Non-goals
No deployment.

## Relevant files
implementation.txt

## Architectural constraints
Fail closed on drift.

## Verification commands
1. \`test -f implementation.txt\`

## Baseline commit
${baseline}

## Execution authority
- Repository edits: allowed
- Non-destructive development commands: allowed
- Routine technical decisions inside this contract: allowed
- Hardware/system writes: prohibited
- Allowed hardware/system operations: none
- Commit on success: true
- Push on success: false
- Deploy on success: false

## Open decisions
NONE

## Execution authorization
PENDING
`;
}

async function baseRepo(): Promise<{ root: string; repo: string; baseline: string }> {
  const root = await mkdtemp(resolve(tmpdir(), "three-agent-recovery-finalization-"));
  const repo = resolve(root, "repo");
  await mkdir(repo, { recursive: true });
  await run(repo, "git", "init", "-q");
  await run(repo, "git", "config", "user.name", "Test");
  await run(repo, "git", "config", "user.email", "test@test");
  await writeFile(resolve(repo, "AGENTS.md"), "# Commands\n\n- Test: `test -f implementation.txt`\n");
  await run(repo, "git", "add", "AGENTS.md");
  await run(repo, "git", "commit", "-qm", "chore: baseline");
  const baseline = await run(repo, "git", "rev-parse", "HEAD");
  return { root, repo, baseline };
}

async function authorizationCleanup(repo: string) {
  const identity = await identifyRepository(repo);
  await rm(resolve(defaultDurableStateRoot(), "authorizations", identity.repositoryKey), { recursive: true, force: true });
}

async function queueCleanup(repo: string) {
  const identity = await identifyRepository(repo);
  await rm(resolve(defaultDurableStateRoot(), "locks", identity.repositoryKey), { recursive: true, force: true });
  await rm(resolve(defaultDurableStateRoot(), "queues", `${identity.repositoryKey}.json`), { force: true });
}

/** A task already authorized and BLOCKED, outside the queue (the /team-go + /team-cancel-ish shape). */
async function authorizedBlockedTask(repo: string, taskId: string, baseline: string): Promise<void> {
  const taskDir = resolve(repo, "team/tasks", taskId);
  await mkdir(taskDir, { recursive: true });
  const brief = briefText(baseline);
  const stamp = new Date().toISOString();
  const marker = "## Execution authorization\nPENDING";
  const authorizedBrief = brief.replace(marker, `## Execution authorization\nAUTHORIZED at ${stamp} by owner message \`go\``);
  const contractDigest = createHash("sha256").update(authorizedBrief).digest("hex");
  await writeFile(resolve(taskDir, "brief.md"), authorizedBrief);
  await writeFile(resolve(taskDir, "status.yaml"), `task_id: ${taskId}
state: BLOCKED
baseline_commit: ${baseline}
authorization_head: ${baseline}
contract_digest: ${contractDigest}
execution_authorized_at: ${stamp}
continue_until_complete: true
review_cycle: 1
max_review_cycles: 5
latest_build_report: null
latest_review: null
blocked_reason: "simulated block for recovery finalization test"
verified_at: null
completed_at: null
completion_policy:
  commit_on_success: true
  push_on_success: false
  deploy_on_success: false
commit_sha: null
pushed_at: null
deployed_at: null
`);
  await run(repo, "git", "add", "team/tasks");
  await run(repo, "git", "commit", "-qm", "chore: commit contract");
  const lock = await acquireRepositoryExecutionLock(repo, 5_000);
  try {
    const record = await createAuthorizationRecord(repo, taskId, baseline, contractDigest, stamp);
    await writeAuthorizationRecord(repo, record, lock);
  } finally {
    await lock.release();
  }
}

async function writeRecoveryPlan(repo: string, taskId: string, disposition: "RESUME" | "ESCALATE"): Promise<void> {
  await writeFile(
    resolve(repo, "team/tasks", taskId, "recovery-plan.md"),
    `# Recovery Plan\n\n## Disposition\n${disposition}\n`,
  );
}

test("aborts finalization when the Architect turn did not end cleanly", async () => {
  const { repo, baseline, root } = await baseRepo();
  try {
    const taskId = "sample";
    await authorizedBlockedTask(repo, taskId, baseline);
    const session = createSessionState(teamConfig, async () => undefined);
    const ctx = fakeCtx();
    const recovery = await session.beginRecovery(repo, taskId, ctx);
    session.recordArchitectStopReason("length");

    let runWorkflowCalled = false;
    await finalizeRecovery(recovery, session, ctx, teamConfig, async () => { runWorkflowCalled = true; }, () => {});

    assert.equal(runWorkflowCalled, false);
    assert.equal(session.pendingRecovery(), undefined);
    assert.equal(session.currentRun(), undefined, "the reserved run must be released");
    assert.match(ctx.notifications.at(-1).message, /Architect recovery ended with length/);
    const discussion = await readFile(resolve(repo, "team/tasks", taskId, "recovery-discussion.md"), "utf8");
    assert.match(discussion, /FINALIZATION_FAILED/);
    assert.match(discussion, /Architect ended with stop reason: length/);
  } finally {
    await authorizationCleanup(repo);
    await rm(root, { recursive: true, force: true });
  }
});

test("notifies and does not call runWorkflow when the workflow slot cannot be reserved", async () => {
  const { repo, baseline, root } = await baseRepo();
  try {
    const taskId = "sample";
    await authorizedBlockedTask(repo, taskId, baseline);
    const session = createSessionState(teamConfig, async () => undefined);
    const ctx = fakeCtx();
    const recovery = await session.beginRecovery(repo, taskId, ctx);
    session.reserveRun("other-task"); // occupy the single run slot

    let runWorkflowCalled = false;
    await finalizeRecovery(recovery, session, ctx, teamConfig, async () => { runWorkflowCalled = true; }, () => {});

    assert.equal(runWorkflowCalled, false);
    assert.match(ctx.notifications.at(-1).message, /could not reserve the workflow slot/);
    assert.equal(ctx.notifications.at(-1).level, "error");
    assert.equal(session.currentRun()?.taskId, "other-task", "the unrelated active run must be untouched");
  } finally {
    await authorizationCleanup(repo);
    await rm(root, { recursive: true, force: true });
  }
});

test("ESCALATE promotes the recovery to a discussion and never calls runWorkflow", async () => {
  const { repo, baseline, root } = await baseRepo();
  const session = createSessionState(teamConfig, async () => undefined);
  let recovery: PendingUnblockRecovery | undefined;
  try {
    const taskId = "sample";
    await authorizedBlockedTask(repo, taskId, baseline);
    await writeRecoveryPlan(repo, taskId, "ESCALATE");
    const ctx = fakeCtx();
    recovery = await session.beginRecovery(repo, taskId, ctx);

    let runWorkflowCalled = false;
    await finalizeRecovery(recovery, session, ctx, teamConfig, async () => { runWorkflowCalled = true; }, () => {});

    assert.equal(runWorkflowCalled, false);
    assert.equal(session.pendingRecovery(), undefined);
    assert.equal(session.activeDiscussion(), recovery, "ESCALATE must promote the recovery into a discussion");
    assert.match(ctx.notifications.at(-1).message, /Architect needs an owner decision/);
    const discussion = await readFile(resolve(repo, "team/tasks", taskId, "recovery-discussion.md"), "utf8");
    assert.match(discussion, /ESCALATED/);
  } finally {
    // ESCALATE deliberately keeps the lock held on the promoted discussion —
    // in production it's released later when the owner finalizes or the
    // session shuts down (session.shutdown). Test cleanup must do the same.
    if (recovery) await session.releaseRecoveryExecutionLock(recovery);
    await authorizationCleanup(repo);
    await rm(root, { recursive: true, force: true });
  }
});

test("RESUME on an unqueued task attaches the lock and calls runWorkflow directly", async () => {
  const { repo, baseline, root } = await baseRepo();
  try {
    const taskId = "sample";
    await authorizedBlockedTask(repo, taskId, baseline);
    await writeRecoveryPlan(repo, taskId, "RESUME");
    const session = createSessionState(teamConfig, async () => undefined);
    const ctx = fakeCtx();
    const recovery = await session.beginRecovery(repo, taskId, ctx);

    // The immediate-resume branch fires runWorkflow with `void ... .catch()`
    // (not awaited) and hands it ownership of the run's repository lock —
    // exactly like production executeWorkflow, whose own finally block
    // releases it. The fake must do the same or the lock's broker
    // subprocess outlives the test.
    const calls: Array<{ repo: string; taskId: string; run: ActiveRun }> = [];
    await finalizeRecovery(recovery, session, ctx, teamConfig, async (r, t, _ctx, _config, run) => {
      calls.push({ repo: r, taskId: t, run });
      await run.repositoryExecutionLock?.release();
    }, () => {});
    // Give the un-awaited runWorkflow call a tick to run before asserting.
    await new Promise((resolveTick) => setImmediate(resolveTick));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].repo, repo);
    assert.equal(calls[0].taskId, taskId);
    assert.ok(calls[0].run.repositoryExecutionLock, "runWorkflow must receive a run with the repository lock attached");
    assert.match(ctx.notifications.at(-1).message, /in-contract resume/);
    assert.equal(session.currentInteractiveAuthorization(), taskId);

    const { status, text } = await readStatus(resolve(repo, "team/tasks", taskId));
    assert.equal(status.state, "EXECUTING");
    assert.match(text, /blocked_reason: null/);
  } finally {
    await authorizationCleanup(repo);
    await rm(root, { recursive: true, force: true });
  }
});

test("resume fails closed and blocks the task when status is not resumable", async () => {
  const { repo, baseline, root } = await baseRepo();
  try {
    const taskId = "sample";
    await authorizedBlockedTask(repo, taskId, baseline);
    // Simulate a task that already completed out from under the recovery.
    const taskDir = resolve(repo, "team/tasks", taskId);
    let statusText = await readFile(resolve(taskDir, "status.yaml"), "utf8");
    statusText = statusText.replace("state: BLOCKED", "state: COMPLETED");
    const lock = await acquireRepositoryExecutionLock(repo, 5_000);
    try {
      await atomicRepositoryWrite(resolve(taskDir, "status.yaml"), statusText, lock);
    } finally {
      await lock.release();
    }
    await writeRecoveryPlan(repo, taskId, "RESUME");
    const session = createSessionState(teamConfig, async () => undefined);
    const ctx = fakeCtx();
    const recovery = await session.beginRecovery(repo, taskId, ctx);

    let runWorkflowCalled = false;
    await finalizeRecovery(recovery, session, ctx, teamConfig, async () => { runWorkflowCalled = true; }, () => {});

    assert.equal(runWorkflowCalled, false);
    assert.match(ctx.notifications.at(-1).message, /recovery plan did not resume the task/);
    const discussion = await readFile(resolve(taskDir, "recovery-discussion.md"), "utf8");
    assert.match(discussion, /FINALIZATION_FAILED/);
    assert.equal(session.currentRun(), undefined, "the run reservation must be released on failure");
  } finally {
    await authorizationCleanup(repo);
    await rm(root, { recursive: true, force: true });
  }
});

test("RESUME on a queued task dispatches through the queue instead of calling runWorkflow directly", async () => {
  const { repo, root } = await baseRepo();
  const validator = resolve(root, "queue-validator.py");
  const VALIDATOR = new URL("../../skills/init-three-agent-team/assets/validate_goal_contract.py", import.meta.url);
  try {
    const taskId = "sample";
    const taskDir = resolve(repo, "team/tasks", taskId);
    await mkdir(taskDir, { recursive: true });
    const baselineHead = await run(repo, "git", "rev-parse", "HEAD");
    await writeFile(resolve(taskDir, "brief.md"), briefText(baselineHead));
    await writeFile(resolve(taskDir, "status.yaml"), `task_id: ${taskId}
state: DISCUSSING
baseline_commit: ${baselineHead}
authorization_head: null
contract_digest: null
execution_authorized_at: null
continue_until_complete: true
review_cycle: 0
max_review_cycles: 5
latest_build_report: null
latest_review: null
blocked_reason: null
verified_at: null
completed_at: null
completion_policy:
  commit_on_success: true
  push_on_success: false
  deploy_on_success: false
commit_sha: null
pushed_at: null
deployed_at: null
`);
    await run(repo, "git", "add", "team/tasks");
    await run(repo, "git", "commit", "-qm", "chore: commit contract");
    await writeFile(validator, `#!/usr/bin/env python3
import subprocess, sys
if "--phase" in sys.argv and sys.argv[sys.argv.index("--phase") + 1] == "execution":
    raise SystemExit(0)
raise SystemExit(subprocess.run(["python3", ${JSON.stringify(VALIDATOR.pathname)}, *sys.argv[1:]]).returncode)
`);
    await run(repo, "chmod", "700", validator).catch(() => undefined);
    const admission = await inspectEnrollmentAdmission(repo, taskId, "2026-01-01T00:00:00.000Z", validator);
    const queue = await openDurableQueue(repo, { leaseTtlMs: 5_000 });
    // finalizeRecovery's queued path approves recovery as `uid:${currentUid()}` (the
    // real process UID), and the queue requires that to match the original enrollment
    // owner — so this fixture must enroll under the real UID too, unlike
    // queue.integration.test.ts's internal-seam tests which call queue.command()
    // directly and can use an arbitrary owner string.
    await queue.command({ type: "enqueue", ...admission.enqueue, dependsOn: [], ownerPrincipal: `uid:${currentUid()}` });
    // No executor: the dispatcher authorizes the head, then blocks before any role runs.
    const blocked = await dispatchQueueOnce(repo, { queue, validatorPath: validator, timing: {
      leaseTtlSeconds: 5, heartbeatIntervalSeconds: 1, executionLockTimeoutSeconds: 2, localExpiryMarginSeconds: 1,
    } });
    assert.equal(blocked.kind, "blocked");
    assert.equal((await queue.snapshot()).entries[0].state, "BLOCKED");

    await writeRecoveryPlan(repo, taskId, "RESUME");
    const session = createSessionState(teamConfig, async () => undefined);
    const ctx = fakeCtx();
    const recovery = await session.beginRecovery(repo, taskId, ctx);

    const calls: Array<{ taskId: string }> = [];
    await finalizeRecovery(recovery, session, ctx, teamConfig, async (_repo, t) => {
      calls.push({ taskId: t });
    }, () => {});

    assert.equal(calls.length, 1, "the queued path must reach runWorkflow through dispatchQueueOnce, not the immediate branch");
    assert.equal(calls[0].taskId, taskId);
    assert.match(ctx.notifications.at(-1).message, /owner-approved queued recovery settled/);
  } finally {
    await queueCleanup(repo);
    await rm(root, { recursive: true, force: true });
  }
});
