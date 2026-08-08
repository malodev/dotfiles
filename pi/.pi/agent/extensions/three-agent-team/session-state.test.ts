import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { parseTeamConfig } from "./config.ts";
import { defaultDurableStateRoot, identifyRepository, type AdvisoryLock, type SideEffectCapability } from "./durable-state.ts";
import { createSessionState, type ActiveRun, type PendingUnblockRecovery, type ReleaseInferenceLease } from "./session-state.ts";

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
const teamConfig = parseTeamConfig(configText, "/tmp/session-state-test-config.json");

function noopReleaseLease(): ReleaseInferenceLease {
  return async () => undefined;
}

function newFakeContext() {
  const notifications: Array<{ message: string; level: string }> = [];
  const state = { aborted: false };
  return {
    notifications,
    ui: { notify(message: string, level: "info" | "warning" | "error") { notifications.push({ message, level }); } },
    abort() { state.aborted = true; },
    get aborted() { return state.aborted; },
  };
}

function fakeCapability(): SideEffectCapability & { released: boolean } {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    assertHeld() { if (controller.signal.aborted) throw new Error("capability not held"); },
    released: false,
  };
}

function fakeLock(): AdvisoryLock & { released: boolean } {
  const controller = new AbortController();
  const lock = {
    signal: controller.signal,
    path: "/fake/lock",
    owner: { uid: 0, hostname: "test", pid: 1, processStart: "x", ownerId: "x", purpose: "test", acquiredAt: new Date().toISOString() },
    brokerPid: 1,
    released: false,
    assertHeld() { if (controller.signal.aborted) throw new Error("lock not held"); },
    async release() { lock.released = true; controller.abort(); },
  };
  return lock;
}

test("reserveRun denies a second concurrent run and releaseRun only clears the matching run", () => {
  const session = createSessionState(teamConfig, noopReleaseLease());
  const runA = session.reserveRun("task-a");
  assert.equal(session.currentRun(), runA);
  assert.throws(() => session.reserveRun("task-b"), /task-a is actively running.*team workflow launch/);

  const unrelated: ActiveRun = { taskId: "task-a", abortController: new AbortController() };
  session.releaseRun(unrelated);
  assert.equal(session.currentRun(), runA, "releasing a non-identical run must not clear the slot");

  session.releaseRun(runA);
  assert.equal(session.currentRun(), undefined);
  assert.doesNotThrow(() => session.reserveRun("task-b"));
});

test("workflowCapability prefers dispatcherCapability over repositoryExecutionLock", () => {
  const session = createSessionState(teamConfig, noopReleaseLease());
  const run = session.reserveRun("task-a");
  assert.throws(() => session.workflowCapability(run), /no repository side-effect capability/);

  const lock = fakeLock();
  run.repositoryExecutionLock = lock;
  assert.equal(session.workflowCapability(run), lock);

  const dispatcherCapability = fakeCapability();
  run.dispatcherCapability = dispatcherCapability;
  assert.equal(session.workflowCapability(run), dispatcherCapability);
});

test("requireIdle blocks on an active run, an active recovery, or an active discussion", () => {
  const session = createSessionState(teamConfig, noopReleaseLease());
  const ctx = newFakeContext();
  assert.equal(session.requireIdle(ctx, "team-new"), true);

  const run = session.reserveRun("task-a");
  assert.equal(session.requireIdle(ctx, "team-new"), false);
  assert.match(ctx.notifications.at(-1)!.message, /task-a is actively running/);
  session.releaseRun(run);
  assert.equal(session.requireIdle(ctx, "team-new"), true);

  const recovery: PendingUnblockRecovery = { repo: "/repo", taskId: "task-b" };
  session.promoteToRecovery(recovery);
  assert.equal(session.requireIdle(ctx, "team-new"), false);
  assert.match(ctx.notifications.at(-1)!.message, /task-b has an active recovery discussion/);
  session.clearRecovery(recovery);
  assert.equal(session.requireIdle(ctx, "team-new"), true);

  const discussion: PendingUnblockRecovery = { repo: "/repo", taskId: "task-c" };
  session.promoteToDiscussion(discussion);
  assert.equal(session.requireIdle(ctx, "team-new"), false);
  session.clearDiscussion();
  assert.equal(session.requireIdle(ctx, "team-new"), true);
});

test("takeArchitectStopReason reads and clears in one call", () => {
  const session = createSessionState(teamConfig, noopReleaseLease());
  assert.equal(session.takeArchitectStopReason(), undefined);
  session.recordArchitectStopReason("length");
  assert.equal(session.takeArchitectStopReason(), "length");
  assert.equal(session.takeArchitectStopReason(), undefined, "second read must observe the clear");
});

test("interactive authorization guard releases only the matching task", () => {
  const session = createSessionState(teamConfig, noopReleaseLease());
  assert.equal(session.currentInteractiveAuthorization(), undefined);
  session.setInteractiveAuthorization("task-a");
  assert.equal(session.currentInteractiveAuthorization(), "task-a");
  session.releaseInteractiveAuthorization("task-b");
  assert.equal(session.currentInteractiveAuthorization(), "task-a", "mismatched taskId must not release the guard");
  session.releaseInteractiveAuthorization("task-a");
  assert.equal(session.currentInteractiveAuthorization(), undefined);
});

test("interactive lease and interactive repository lock are plain storage", async () => {
  const session = createSessionState(teamConfig, noopReleaseLease());
  assert.equal(session.interactiveLease(), undefined);
  const lease: ActiveRun = { taskId: "interactive", abortController: new AbortController() };
  session.setInteractiveLease(lease);
  assert.equal(session.interactiveLease(), lease);
  session.setInteractiveLease(undefined);
  assert.equal(session.interactiveLease(), undefined);

  assert.equal(session.interactiveRepositoryLock(), undefined);
  const lock = fakeLock();
  session.setInteractiveRepositoryLock(lock);
  assert.equal(session.interactiveRepositoryLock(), lock);
  await session.releaseInteractiveRepositoryLock();
  assert.equal(lock.released, true);
  assert.equal(session.interactiveRepositoryLock(), undefined);
  await assert.doesNotReject(session.releaseInteractiveRepositoryLock(), "releasing when nothing is held must be a no-op");
});

test("beginValidation resets state and clears a stale stop reason", () => {
  const session = createSessionState(teamConfig, noopReleaseLease());
  session.recordArchitectStopReason("error");
  session.beginValidation("/repo", "task-a");
  assert.deepEqual(session.pendingValidation(), { repo: "/repo", taskId: "task-a", repairAttempts: 0 });
  assert.equal(session.takeArchitectStopReason(), undefined, "beginValidation must clear the prior turn's stop reason");
  session.clearValidation();
  assert.equal(session.pendingValidation(), undefined);
});

test("promoteToRecovery keeps the discussion slot set (dual-pointing intermediate state)", () => {
  // Mirrors the "finalize recovery" input handler: activeUnblockDiscussion stays
  // set until agent_settled's recovery branch resolves it, even though
  // pendingUnblockRecovery now points at the same object.
  const session = createSessionState(teamConfig, noopReleaseLease());
  const discussion: PendingUnblockRecovery = { repo: "/repo", taskId: "task-a" };
  session.promoteToDiscussion(discussion);
  session.promoteToRecovery(discussion);
  assert.equal(session.activeDiscussion(), discussion);
  assert.equal(session.pendingRecovery(), discussion);
});

test("shutdown releases every held resource without requiring real subprocesses", async () => {
  const released: string[] = [];
  const releaseInferenceLease: ReleaseInferenceLease = async (run) => { released.push(run.taskId); return undefined; };
  const session = createSessionState(teamConfig, releaseInferenceLease);

  const run = session.reserveRun("workflow-task");
  run.leaseOwner = "owner";
  run.leaseRepo = "/repo";
  run.leaseConfig = teamConfig;
  const workflowLock = fakeLock();
  run.repositoryExecutionLock = workflowLock;

  session.setInteractiveLease({ taskId: "interactive", abortController: new AbortController() });
  const interactiveLock = fakeLock();
  session.setInteractiveRepositoryLock(interactiveLock);

  const recovery: PendingUnblockRecovery = { repo: "/repo", taskId: "recovery-task" };
  const recoveryLock = fakeLock();
  recovery.repositoryExecutionLock = recoveryLock;
  session.promoteToRecovery(recovery);

  await session.shutdown("/fallback-cwd");

  assert.deepEqual(released.sort(), ["interactive", "workflow-task"]);
  assert.equal(workflowLock.released, true);
  assert.equal(interactiveLock.released, true);
  assert.equal(recoveryLock.released, true);
  assert.equal(session.interactiveLease(), undefined);
  assert.equal(session.interactiveRepositoryLock(), undefined);
  assert.equal(run.repositoryExecutionLock, undefined, "shutdown clears the run's own lock reference");
  assert.equal(session.currentRun(), run, "shutdown aborts the run but does not clear the active-run slot itself");
  assert.equal(run.abortController.signal.aborted, true);
});

// --- Fixture-backed tests: these call acquireRepositoryExecutionLock/openDurableQueue
// for real, which write to the real, non-redirectable ~/.local/state/pi-three-agent-team
// (README: "Environment variables cannot redirect this trust root"). Each test removes
// exactly the repository-keyed subtree it creates.

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

async function gitFixture(): Promise<{ repo: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(resolve(tmpdir(), "three-agent-session-state-"));
  const repo = resolve(root, "repo");
  await mkdir(repo, { recursive: true });
  await run(repo, "git", "init", "-q");
  await run(repo, "git", "config", "user.name", "Test");
  await run(repo, "git", "config", "user.email", "test@test");
  await run(repo, "git", "commit", "--allow-empty", "-qm", "chore: baseline");
  const identity = await identifyRepository(repo);
  const locksDir = resolve(defaultDurableStateRoot(), "locks", identity.repositoryKey);
  const queuesFile = resolve(defaultDurableStateRoot(), "queues", `${identity.repositoryKey}.json`);
  return {
    repo,
    cleanup: async () => {
      await rm(locksDir, { recursive: true, force: true });
      await rm(queuesFile, { force: true });
    },
  };
}

test("withRepositoryMutationBoundary acquires a scoped lock and releases it after the callback", async () => {
  const session = createSessionState(teamConfig, noopReleaseLease());
  const { repo, cleanup } = await gitFixture();
  try {
    assert.equal(session.currentRepositoryLock(), undefined);
    let heldDuringCallback = false;
    await session.withRepositoryMutationBoundary(repo, "test action", async (lock) => {
      lock.assertHeld();
      heldDuringCallback = true;
    });
    assert.equal(heldDuringCallback, true);
    assert.equal(session.currentRepositoryLock(), undefined, "the scoped lock must be released once the callback returns");
  } finally {
    await cleanup();
  }
});

test("beginRecovery acquires the repository execution lock and reuses an existing pending recovery for the same task", async () => {
  const session = createSessionState(teamConfig, noopReleaseLease());
  const { repo, cleanup } = await gitFixture();
  const ctx = newFakeContext();
  try {
    const first = await session.beginRecovery(repo, "sample", ctx);
    assert.ok(first.repositoryExecutionLock);
    assert.equal(session.currentInteractiveAuthorization(), "sample");

    const second = await session.beginRecovery(repo, "sample", ctx);
    assert.equal(second, first, "a second beginRecovery for the same task must reuse the same object and lock");

    await session.releaseRecoveryExecutionLock(first);
  } finally {
    await cleanup();
  }
});
