// @ts-nocheck
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  canExecute,
  canResume,
  canPause,
  canAbort,
  canResolveBlocker,
  planRetryEvents,
  planPatchValidationEvents,
} from "../../src/transition-policy.ts";
import type { RunSnapshot, TaskRuntimeState, ForgeTask } from "../../src/types.ts";

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

function makeTaskState(
  status: TaskRuntimeState["status"],
  overrides: Partial<TaskRuntimeState> = {}
): TaskRuntimeState {
  return {
    taskId: "TF-01",
    status,
    retries: 0,
    runAttempt: 0,
    ...overrides,
  };
}

function makeTask(id: string): ForgeTask {
  return {
    id,
    title: `Task ${id}`,
    description: "Fixture task",
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: [],
    dependencies: [],
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: { mode: "manual", notes: "fixture" },
  };
}

describe("canExecute", () => {
  it("allows execute when awaiting approval with executePlan nextAction", () => {
    const snapshot = makeBaseSnapshot({
      status: "awaiting_approval",
      nextAction: "executePlan",
      tasks: [makeTask("TF-01")],
      taskState: { TF_01: makeTaskState("pending") },
    });
    const result = canExecute(snapshot);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, "run_is_awaiting_approval");
  });

  it("allows execute when executing with runnable tasks", () => {
    const snapshot = makeBaseSnapshot({
      status: "executing",
      currentPhase: 5,
      tasks: [makeTask("TF-01")],
      taskState: { TF_01: makeTaskState("ready") },
    });
    const result = canExecute(snapshot);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, "has_runnable_tasks");
  });

  it("denies execute when executing with no running or ready tasks", () => {
    const snapshot = makeBaseSnapshot({
      status: "executing",
      currentPhase: 5,
      tasks: [makeTask("TF-01")],
      taskState: { TF_01: makeTaskState("pending") },
    });
    const result = canExecute(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "no_runnable_tasks");
  });

  it("denies execute when needs human intervention", () => {
    const snapshot = makeBaseSnapshot({
      status: "needs_human_intervention",
      pendingHumanIntervention: {
        taskId: "TF-01",
        reason: "help",
        suggestion: "fix",
        requestedAt: "2026-04-24T00:00:00.000Z",
      },
      tasks: [makeTask("TF-01")],
      taskState: {
        TF_01: makeTaskState("blocked", {
          blocker: {
            taskId: "TF-01",
            category: "runtime",
            reason: "r",
            suggestion: "s",
            blockedTasks: ["TF-01"],
          },
        }),
      },
    });
    const result = canExecute(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_needs_human_intervention");
  });

  it("denies execute when failed", () => {
    const snapshot = makeBaseSnapshot({
      status: "failed",
      taskState: { TF_01: makeTaskState("failed") },
    });
    const result = canExecute(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_is_failed");
  });

  it("denies execute when paused", () => {
    const snapshot = makeBaseSnapshot({ status: "paused" });
    const result = canExecute(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_is_paused");
  });

  it("denies execute when completed", () => {
    const snapshot = makeBaseSnapshot({ status: "completed" });
    const result = canExecute(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_is_completed");
  });

  it("denies execute when aborted", () => {
    const snapshot = makeBaseSnapshot({ status: "aborted" });
    const result = canExecute(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_is_aborted");
  });

  it("denies execute when no tasks registered", () => {
    const snapshot = makeBaseSnapshot({ status: "planning" });
    const result = canExecute(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "no_tasks_registered");
  });
});

describe("canResume", () => {
  it("allows resume when paused", () => {
    const snapshot = makeBaseSnapshot({ status: "paused" });
    const result = canResume(snapshot);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, "run_is_paused");
  });

  it("allows resume when execution was interrupted (running tasks remain)", () => {
    const snapshot = makeBaseSnapshot({
      status: "executing",
      currentPhase: 5,
      taskState: {
        TF_01: makeTaskState("running", {
          startedAt: "2026-04-24T00:00:00.000Z",
          lastHeartbeatAt: "2026-04-24T00:00:00.000Z",
        }),
      },
    });
    const result = canResume(snapshot);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, "has_interrupted_tasks");
  });

  it("denies resume when aborted", () => {
    const snapshot = makeBaseSnapshot({ status: "aborted" });
    const result = canResume(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_is_aborted");
  });

  it("denies resume when completed", () => {
    const snapshot = makeBaseSnapshot({ status: "completed" });
    const result = canResume(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_is_completed");
  });

  it("denies resume when failed", () => {
    const snapshot = makeBaseSnapshot({ status: "failed" });
    const result = canResume(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_is_failed");
  });

  it("denies resume when no interrupted execution exists", () => {
    const snapshot = makeBaseSnapshot({ status: "planning" });
    const result = canResume(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "no_interrupted_execution");
  });
});

describe("canPause", () => {
  it("allows pause when executing", () => {
    const snapshot = makeBaseSnapshot({ status: "executing" });
    const result = canPause(snapshot);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, "run_is_active");
  });

  it("allows pause when reviewing", () => {
    const snapshot = makeBaseSnapshot({ status: "reviewing", currentPhase: 6 });
    const result = canPause(snapshot);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, "run_is_active");
  });

  it("allows pause when tasks are running even if status is stale", () => {
    const snapshot = makeBaseSnapshot({
      status: "planning",
      taskState: { TF_01: makeTaskState("running") },
    });
    const result = canPause(snapshot);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, "has_running_tasks");
  });

  it("denies pause when planning", () => {
    const snapshot = makeBaseSnapshot({ status: "planning" });
    const result = canPause(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_not_active");
  });

  it("denies pause when paused", () => {
    const snapshot = makeBaseSnapshot({ status: "paused" });
    const result = canPause(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_not_active");
  });

  it("denies pause when completed", () => {
    const snapshot = makeBaseSnapshot({ status: "completed" });
    const result = canPause(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_not_active");
  });
});

describe("canAbort", () => {
  it("allows abort when planning", () => {
    const snapshot = makeBaseSnapshot({ status: "planning" });
    const result = canAbort(snapshot);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, "run_is_abortable");
  });

  it("allows abort when executing", () => {
    const snapshot = makeBaseSnapshot({ status: "executing" });
    const result = canAbort(snapshot);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, "run_is_abortable");
  });

  it("allows abort when paused", () => {
    const snapshot = makeBaseSnapshot({ status: "paused" });
    const result = canAbort(snapshot);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, "run_is_abortable");
  });

  it("denies abort when already aborted", () => {
    const snapshot = makeBaseSnapshot({ status: "aborted" });
    const result = canAbort(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_is_aborted");
  });

  it("denies abort when completed", () => {
    const snapshot = makeBaseSnapshot({ status: "completed" });
    const result = canAbort(snapshot);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "run_is_completed");
  });
});

describe("canResolveBlocker", () => {
  it("allows resolving a blocked task with unresolved blocker", () => {
    const snapshot = makeBaseSnapshot({
      status: "needs_human_intervention",
      taskState: {
        TF_01: makeTaskState("blocked", {
          blocker: {
            taskId: "TF-01",
            category: "runtime",
            reason: "r",
            suggestion: "s",
            blockedTasks: ["TF-01"],
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
        },
      ],
    });
    const result = canResolveBlocker(snapshot, "TF-01");
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, "blocker_is_resolvable");
  });

  it("allows resolving when pendingHumanIntervention points to task", () => {
    const snapshot = makeBaseSnapshot({
      status: "needs_human_intervention",
      pendingHumanIntervention: {
        taskId: "TF-01",
        reason: "r",
        suggestion: "s",
        requestedAt: "2026-04-24T00:00:00.000Z",
      },
      taskState: { TF_01: makeTaskState("running") },
    });
    const result = canResolveBlocker(snapshot, "TF-01");
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, "blocker_is_resolvable");
  });

  it("denies resolving patched intervention task (blocker already resolved)", () => {
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
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "blocker_already_resolved");
  });

  it("denies resolving when task not found", () => {
    const snapshot = makeBaseSnapshot({ status: "planning" });
    const result = canResolveBlocker(snapshot, "TF-99");
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "task_not_found");
  });

  it("denies resolving when task is terminal", () => {
    const snapshot = makeBaseSnapshot({
      status: "planning",
      taskState: { TF_01: makeTaskState("completed") },
    });
    const result = canResolveBlocker(snapshot, "TF-01");
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "task_is_terminal");
  });

  it("denies resolving when task not blocked", () => {
    const snapshot = makeBaseSnapshot({
      status: "planning",
      taskState: { TF_01: makeTaskState("pending") },
    });
    const result = canResolveBlocker(snapshot, "TF-01");
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "task_not_blocked");
  });
});

describe("planRetryEvents", () => {
  it("plans retry events for a failed task", () => {
    const snapshot = makeBaseSnapshot({
      taskState: { TF_01: makeTaskState("failed", { error: "oops" }) },
    });
    const events = planRetryEvents(snapshot, "TF-01");
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, "task_requeued");
    assert.strictEqual(events[0].taskId, "TF-01");
    assert.ok(events[0].reason.includes("Retry"));
  });

  it("plans retry events for a blocked task", () => {
    const snapshot = makeBaseSnapshot({
      taskState: {
        TF_01: makeTaskState("blocked", {
          blocker: {
            taskId: "TF-01",
            category: "runtime",
            reason: "r",
            suggestion: "s",
            blockedTasks: ["TF-01"],
          },
        }),
      },
    });
    const events = planRetryEvents(snapshot, "TF-01");
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, "task_requeued");
  });

  it("returns empty for completed task", () => {
    const snapshot = makeBaseSnapshot({
      taskState: { TF_01: makeTaskState("completed") },
    });
    const events = planRetryEvents(snapshot, "TF-01");
    assert.strictEqual(events.length, 0);
  });

  it("returns empty for nonexistent task", () => {
    const snapshot = makeBaseSnapshot();
    const events = planRetryEvents(snapshot, "TF-99");
    assert.strictEqual(events.length, 0);
  });
});

describe("planPatchValidationEvents", () => {
  it("plans patch and requeue events for a blocked task", () => {
    const snapshot = makeBaseSnapshot({
      taskState: {
        TF_01: makeTaskState("blocked", {
          blocker: {
            taskId: "TF-01",
            category: "runtime",
            reason: "r",
            suggestion: "s",
            blockedTasks: ["TF-01"],
          },
        }),
      },
    });
    const events = planPatchValidationEvents(snapshot, "TF-01", "npm test");
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, "task_contract_patched");
    assert.strictEqual(events[0].taskId, "TF-01");
    assert.strictEqual(events[0].patch.validation.mode, "command");
    assert.strictEqual(events[0].patch.validation.command, "npm test");
    assert.ok(events[0].durabilityCommitRef.startsWith("TF-01:"));
    assert.strictEqual(events[1].type, "task_requeued");
    assert.strictEqual(events[1].taskId, "TF-01");
  });

  it("plans patch and requeue events for a failed task", () => {
    const snapshot = makeBaseSnapshot({
      taskState: { TF_01: makeTaskState("failed", { error: "oops" }) },
    });
    const events = planPatchValidationEvents(snapshot, "TF-01", "pnpm test");
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, "task_contract_patched");
    assert.strictEqual(events[1].type, "task_requeued");
  });

  it("returns empty for completed task", () => {
    const snapshot = makeBaseSnapshot({
      taskState: { TF_01: makeTaskState("completed") },
    });
    const events = planPatchValidationEvents(snapshot, "TF-01", "npm test");
    assert.strictEqual(events.length, 0);
  });

  it("returns empty for nonexistent task", () => {
    const snapshot = makeBaseSnapshot();
    const events = planPatchValidationEvents(snapshot, "TF-99", "npm test");
    assert.strictEqual(events.length, 0);
  });

  it("returns empty for empty command", () => {
    const snapshot = makeBaseSnapshot({
      taskState: { TF_01: makeTaskState("failed") },
    });
    const events = planPatchValidationEvents(snapshot, "TF-01", "   ");
    assert.strictEqual(events.length, 0);
  });
});
