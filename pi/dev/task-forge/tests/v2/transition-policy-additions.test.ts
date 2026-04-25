// @ts-nocheck
import { describe, it } from "node:test";
import assert from "node:assert";
import { canResume, canExecute, canResolveBlocker } from "../../v2/transition-policy.ts";
import type { RunSnapshot, TaskRuntimeState } from "../../v2/types.ts";

function makeBaseSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
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
    timestamps: {
      started: "2026-04-24T00:00:00.000Z",
      lastUpdated: "2026-04-24T00:00:00.000Z",
    },
    ...overrides,
  } as RunSnapshot;
}

function makeTaskState(status: TaskRuntimeState["status"], overrides: Partial<TaskRuntimeState> = {}): TaskRuntimeState {
  return { taskId: "TF-01", status, retries: 0, runAttempt: 0, ...overrides };
}

describe("transition-policy additions", () => {
  it("denies resume when executing without running tasks", () => {
    const snapshot = makeBaseSnapshot({
      status: "executing",
      currentPhase: 5,
      taskState: { TF_01: makeTaskState("ready") },
    });
    const result = canResume(snapshot);
    assert.strictEqual(result.allowed, false, "should deny resume when no tasks are running");
    assert.strictEqual(result.reason, "no_interrupted_execution");
  });

  it("denies resume when needs_human_intervention", () => {
    const snapshot = makeBaseSnapshot({
      status: "needs_human_intervention",
      pendingHumanIntervention: {
        taskId: "TF-01",
        reason: "r",
        suggestion: "s",
        requestedAt: "2026-04-24T00:00:00.000Z",
      },
      taskState: { TF_01: makeTaskState("blocked") },
    });
    const result = canResume(snapshot);
    assert.strictEqual(result.allowed, false, "should deny resume when human intervention is needed");
    assert.strictEqual(result.reason, "run_needs_human_intervention");
  });

  it("denies resume when needs_human_intervention even with running tasks", () => {
    const snapshot = makeBaseSnapshot({
      status: "needs_human_intervention",
      pendingHumanIntervention: {
        taskId: "TF-01",
        reason: "r",
        suggestion: "s",
        requestedAt: "2026-04-24T00:00:00.000Z",
      },
      taskState: {
        TF_01: makeTaskState("running", {
          startedAt: "2026-04-24T00:00:00.000Z",
          lastHeartbeatAt: "2026-04-24T00:00:00.000Z",
        }),
      },
    });
    const result = canResume(snapshot);
    assert.strictEqual(result.allowed, false, "should deny resume when human intervention is needed even if tasks are running");
    assert.strictEqual(result.reason, "run_needs_human_intervention");
  });

  it("allows execute when executing with ready tasks but no running tasks", () => {
    const snapshot = makeBaseSnapshot({
      status: "executing",
      currentPhase: 5,
      taskState: {
        TF_01: makeTaskState("completed"),
        TF_02: makeTaskState("ready"),
      },
    });
    const result = canExecute(snapshot);
    assert.strictEqual(result.allowed, true, "should allow execute when ready tasks exist");
    assert.strictEqual(result.reason, "has_runnable_tasks");
  });

  it("allows execute after patched human-intervention task with no blockers", () => {
    const snapshot = makeBaseSnapshot({
      status: "executing",
      currentPhase: 5,
      tasks: [
        {
          id: "TF-01",
          title: "T1",
          description: "d",
          complexity: "S",
          taskMode: "single-pass",
          contextManifest: {},
          outputManifest: [],
          dependencies: [],
          acceptanceCriteria: [],
          escalationTriggers: [],
          validation: { mode: "manual" },
        },
      ],
      taskState: {
        TF_01: makeTaskState("ready"),
      },
      blockers: [],
    });
    const result = canExecute(snapshot);
    assert.strictEqual(result.allowed, true, "patched human-intervention task with no blockers should be executable");
    assert.strictEqual(result.reason, "has_runnable_tasks");
  });

  it("denies resolving already-resolved patched human-intervention task", () => {
    const snapshot = makeBaseSnapshot({
      status: "planning",
      taskState: {
        TF_01: makeTaskState("pending", {
          blocker: {
            taskId: "TF-01",
            category: "runtime",
            reason: "r",
            suggestion: "s",
            blockedTasks: ["TF-01"],
            resolvedAt: "2026-04-24T00:00:00.000Z",
          },
        }),
      },
      blockers: [
        {
          taskId: "TF-01",
          category: "runtime",
          reason: "r",
          suggestion: "s",
          blockedTasks: ["TF-01"],
          resolvedAt: "2026-04-24T00:00:00.000Z",
        },
      ],
    });
    const result = canResolveBlocker(snapshot, "TF-01");
    assert.strictEqual(result.allowed, false, "should deny resolving already-resolved blocker");
    assert.strictEqual(result.reason, "blocker_already_resolved");
  });
});
