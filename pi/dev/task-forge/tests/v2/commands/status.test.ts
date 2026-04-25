import { describe, it } from "node:test";
import assert from "node:assert";
import { status } from "../../../v2/commands/status.ts";
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
    tasks: [
      { id: "T1", title: "Task 1", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: [], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } },
      { id: "T2", title: "Task 2", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: [], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } },
    ],
    taskState: {
      T1: { taskId: "T1", status: "completed", retries: 0, runAttempt: 1 },
      T2: { taskId: "T2", status: "blocked", retries: 0, runAttempt: 1, blocker: { taskId: "T2", category: "runtime", reason: "r", suggestion: "s", blockedTasks: ["T2"] } },
    },
    blockers: [{ taskId: "T2", category: "runtime", reason: "r", suggestion: "s", blockedTasks: ["T2"] }],
    supervisors: {},
    timestamps: { started: "2026-04-24T00:00:00.000Z", lastUpdated: "2026-04-24T00:00:00.000Z" },
    ...overrides,
  } as RunSnapshot;
}

describe("status command service", () => {
  it("returns error for null snapshot", () => {
    const result = status(null);
    assert.strictEqual(result.ok, false);
    assert.ok(result.message?.includes("No run snapshot"));
  });

  it("returns correct summary for snapshot with blockers", () => {
    const result = status(makeSnapshot());
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data?.orchestrationId, "orch-test");
    assert.strictEqual(result.data?.taskCounts.total, 2);
    assert.strictEqual(result.data?.taskCounts.completed, 1);
    assert.strictEqual(result.data?.taskCounts.blocked, 1);
    assert.strictEqual(result.data?.blockers.length, 1);
    assert.strictEqual(result.data?.blockers[0].taskId, "T2");
    assert.strictEqual(result.data?.blockers[0].resolved, false);
  });

  it("returns correct summary for no-blocker state", () => {
    const snapshot = makeSnapshot({
      status: "executing",
      currentPhase: 5,
      taskState: {
        T1: { taskId: "T1", status: "completed", retries: 0, runAttempt: 1 },
        T2: { taskId: "T2", status: "completed", retries: 0, runAttempt: 1 },
      },
      blockers: [],
    });
    const result = status(snapshot);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data?.blockers.length, 0);
    assert.strictEqual(result.data?.taskCounts.completed, 2);
  });
});
