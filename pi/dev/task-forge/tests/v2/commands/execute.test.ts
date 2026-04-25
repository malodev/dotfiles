// @ts-nocheck
import { describe, it } from "node:test";
import assert from "node:assert";
import { execute } from "../../../src/commands/execute.ts";
import type { RunSnapshot } from "../../../src/types.ts";

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

describe("execute command service", () => {
  it("returns error for null snapshot", () => {
    const result = execute(null);
    assert.strictEqual(result.ok, false);
    assert.ok(result.message?.includes("No run snapshot"));
  });

  it("returns decision for awaiting approval without grantApproval", () => {
    const snapshot = makeSnapshot({
      status: "awaiting_approval",
      nextAction: "executePlan",
      tasks: [{ id: "T1", title: "Task 1", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: [], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } }],
      taskState: { T1: { taskId: "T1", status: "pending", retries: 0, runAttempt: 0 } },
    });
    const result = execute(snapshot);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data?.decision.allowed, true);
    assert.strictEqual(result.events.length, 0);
  });

  it("emits approval_granted when grantApproval is true and awaiting approval", () => {
    const snapshot = makeSnapshot({
      status: "awaiting_approval",
      nextAction: "executePlan",
      tasks: [{ id: "T1", title: "Task 1", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: [], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } }],
      taskState: { T1: { taskId: "T1", status: "pending", retries: 0, runAttempt: 0 } },
    });
    const result = execute(snapshot, { grantApproval: true });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.events[0].type, "approval_granted");
  });

  it("lists ready tasks to launch", () => {
    const snapshot = makeSnapshot({
      status: "executing",
      currentPhase: 5,
      tasks: [{ id: "T1", title: "Task 1", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: [], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } }],
      taskState: { T1: { taskId: "T1", status: "ready", retries: 0, runAttempt: 1 } },
    });
    const result = execute(snapshot);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.data?.tasksToLaunch, ["T1"]);
  });

  it("recovers executing run with no running tasks but ready tasks", () => {
    const snapshot = makeSnapshot({
      status: "executing",
      currentPhase: 5,
      tasks: [
        { id: "T1", title: "Task 1", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: [], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } },
        { id: "T2", title: "Task 2", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: [], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } },
      ],
      taskState: {
        T1: { taskId: "T1", status: "completed", retries: 0, runAttempt: 1 },
        T2: { taskId: "T2", status: "ready", retries: 0, runAttempt: 1 },
      },
    });
    const result = execute(snapshot);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data?.decision.reason, "has_runnable_tasks");
    assert.deepStrictEqual(result.data?.tasksToLaunch, ["T2"]);
  });

  it("denies execute for needs_human_intervention", () => {
    const snapshot = makeSnapshot({
      status: "needs_human_intervention",
      pendingHumanIntervention: { taskId: "T1", reason: "r", suggestion: "s", requestedAt: "2026-04-24T00:00:00.000Z" },
      taskState: { T1: { taskId: "T1", status: "blocked", retries: 0, runAttempt: 1 } },
    });
    const result = execute(snapshot);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.data?.decision.allowed, false);
    assert.strictEqual(result.data?.decision.reason, "run_needs_human_intervention");
  });
});
