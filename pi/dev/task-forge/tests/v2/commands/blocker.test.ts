import { describe, it } from "node:test";
import assert from "node:assert";
import { listBlockers, resolveBlocker, retryTask, patchValidation, forceUnblock } from "../../../v2/commands/blocker.ts";
import type { RunSnapshot } from "../../../v2/types.ts";

function makeSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    schemaVersion: 4,
    orchestrationId: "orch-test",
    status: "planning",
    currentPhase: 0,
    phaseLabel: "Test",
    resolvedModels: {},
    cost: {},
    tasks: [],
    taskState: {},
    blockers: [],
    supervisors: {},
    timestamps: { started: "2026-04-24T00:00:00.000Z", lastUpdated: "2026-04-24T00:00:00.000Z" },
    ...overrides,
  } as RunSnapshot;
}

describe("blocker command service", () => {
  it("listBlockers returns error for null snapshot", () => {
    const result = listBlockers(null);
    assert.strictEqual(result.ok, false);
  });

  it("listBlockers returns blockers and unresolved count", () => {
    const snapshot = makeSnapshot({
      blockers: [
        { taskId: "T1", category: "runtime", reason: "r", suggestion: "s", blockedTasks: ["T1"] },
        { taskId: "T2", category: "dependency", reason: "r2", suggestion: "s2", blockedTasks: ["T2"], resolvedAt: "2026-04-24T00:00:00.000Z" },
      ],
      pendingHumanIntervention: { taskId: "T1", reason: "help", suggestion: "fix", requestedAt: "2026-04-24T00:00:00.000Z" },
    });
    const result = listBlockers(snapshot);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data?.blockers.length, 2);
    assert.strictEqual(result.data?.unresolvedCount, 1);
    assert.strictEqual(result.data?.pendingHumanIntervention?.taskId, "T1");
  });

  it("resolveBlocker appends human_intervention_resolved event", () => {
    const snapshot = makeSnapshot({
      status: "needs_human_intervention",
      pendingHumanIntervention: { taskId: "T1", reason: "help", suggestion: "fix", requestedAt: "2026-04-24T00:00:00.000Z" },
      taskState: { T1: { taskId: "T1", status: "blocked", retries: 0, runAttempt: 1 } },
    });
    const result = resolveBlocker(snapshot, { taskId: "T1", resolution: "fixed" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.events[0].type, "human_intervention_resolved");
    assert.strictEqual((result.events[0] as any).taskId, "T1");
    assert.strictEqual((result.events[0] as any).resolution, "fixed");
  });

  it("retryTask appends task_requeued for failed task", () => {
    const snapshot = makeSnapshot({
      taskState: { T1: { taskId: "T1", status: "failed", retries: 1, runAttempt: 1, error: "oops" } },
    });
    const result = retryTask(snapshot, { taskId: "T1" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.events[0].type, "task_requeued");
  });

  it("patchValidation appends task_contract_patched and task_requeued", () => {
    const snapshot = makeSnapshot({
      taskState: { T1: { taskId: "T1", status: "failed", retries: 1, runAttempt: 1, error: "oops" } },
    });
    const result = patchValidation(snapshot, { taskId: "T1", command: "npm test" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.events.length, 2);
    assert.strictEqual(result.events[0].type, "task_contract_patched");
    assert.strictEqual(result.events[1].type, "task_requeued");
    assert.strictEqual((result.events[0] as any).patch.validation.command, "npm test");
  });

  it("retryTask returns empty for completed task", () => {
    const snapshot = makeSnapshot({
      taskState: { T1: { taskId: "T1", status: "completed", retries: 0, runAttempt: 1 } },
    });
    const result = retryTask(snapshot, { taskId: "T1" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.events.length, 0);
  });

  it("forceUnblock appends task_requeued for blocked task", () => {
    const snapshot = makeSnapshot({
      taskState: { T1: { taskId: "T1", status: "blocked", retries: 0, runAttempt: 1, error: "blocked" } },
    });
    const result = forceUnblock(snapshot, { taskId: "T1" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.events[0].type, "task_requeued");
    assert.strictEqual((result.events[0] as any).reason, "Force unblock requested for task T1");
  });

  it("forceUnblock returns error for non-blocked task", () => {
    const snapshot = makeSnapshot({
      taskState: { T1: { taskId: "T1", status: "failed", retries: 1, runAttempt: 1, error: "oops" } },
    });
    const result = forceUnblock(snapshot, { taskId: "T1" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.events.length, 0);
  });

  it("listBlockers reflects V2 snapshot with JSON parity", () => {
    const snapshot = makeSnapshot({
      blockers: [
        { taskId: "T1", category: "runtime", reason: "r", suggestion: "s", blockedTasks: ["T1"] },
      ],
    });
    const result = listBlockers(snapshot);
    assert.strictEqual(result.ok, true);
    // JSON serialization round-trip should preserve blocker state
    const json = JSON.stringify(result.data);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.blockers.length, 1);
    assert.strictEqual(parsed.unresolvedCount, 1);
  });
});
