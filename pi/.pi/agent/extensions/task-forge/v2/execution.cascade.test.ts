import { describe, it } from "node:test";
import { computeSchedulingActions, failedDependencies, dependenciesResolved, createDependencyBlocker } from "./execution.ts";
import type { Blocker, ForgeTask, RunSnapshot, TaskRuntimeState } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeTask(overrides: Partial<ForgeTask> = {}): ForgeTask {
  return {
    id: "T1",
    title: "Task 1",
    description: "A test task",
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: [],
    dependencies: [],
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: { mode: "command", command: "node --test" },
    ...overrides,
  };
}

function makeRuntime(taskId: string, status: string, blocker?: Blocker): TaskRuntimeState {
  return {
    taskId,
    status: status as TaskRuntimeState["status"],
    retries: 0,
    runAttempt: 0,
    ...(blocker ? { blocker } : {}),
  };
}

function makeSnapshot(tasks: ForgeTask[], taskState: Record<string, TaskRuntimeState>): RunSnapshot {
  return {
    schemaVersion: 4,
    orchestrationId: "test-run",
    status: "executing",
    currentPhase: 5,
    phaseLabel: "Execution",
    nextAction: "executePlan",
    resolvedModels: {},
    cost: {},
    tasks,
    taskState,
    blockers: [],
    supervisors: {},
    timestamps: { started: new Date().toISOString(), lastUpdated: new Date().toISOString() },
  };
}

describe("computeSchedulingActions – cascading dependency blocker resolution", () => {
  it("resolves single-level dependency blocker when upstream task is requeued", () => {
    // T1 is completed, T2 (blocked, dep-blocker for T1) → should be requeued and ready
    const tasks = [
      makeTask({ id: "T1" }),
      makeTask({ id: "T2", dependencies: ["T1"] }),
    ];

    const depBlocker = createDependencyBlocker(tasks[1], ["T1"]);
    const taskState: Record<string, TaskRuntimeState> = {
      T1: makeRuntime("T1", "completed"),
      T2: makeRuntime("T2", "blocked", depBlocker),
    };

    const result = computeSchedulingActions(makeSnapshot(tasks, taskState));

    assert(result.requeueTaskIds.includes("T2"), "T2 should be requeued after its dep T1 is completed");
    assert(result.readyTaskIds.includes("T2"), "T2 should be ready since T1 is completed");
  });

  it("cascades dependency blocker resolution through multiple levels", () => {
    // T1: completed
    // T2: blocked (dep-blocker on T1) — but T1 is now completed, so clear T2
    // T3: blocked (dep-blocker on T2) — T2 is being requeued, so clear T3
    // T4: pending, depends on T3 → should stay pending
    const tasks = [
      makeTask({ id: "T1" }),
      makeTask({ id: "T2", dependencies: ["T1"] }),
      makeTask({ id: "T3", dependencies: ["T2"] }),
      makeTask({ id: "T4", dependencies: ["T3"] }),
    ];

    const depBlockerT2 = createDependencyBlocker(tasks[1], ["T1"]);
    const depBlockerT3 = createDependencyBlocker(tasks[2], ["T2"]);

    const taskState: Record<string, TaskRuntimeState> = {
      T1: makeRuntime("T1", "completed"),
      T2: makeRuntime("T2", "blocked", depBlockerT2),
      T3: makeRuntime("T3", "blocked", depBlockerT3),
      T4: makeRuntime("T4", "pending"),
    };

    const result = computeSchedulingActions(makeSnapshot(tasks, taskState));

    assert(result.requeueTaskIds.includes("T2"), "T2 should be requeued (dep T1 completed)");
    assert(result.requeueTaskIds.includes("T3"), "T3 should be requeued in same pass (cascade: T2 unblocked → T3 unblocked)");
    assert(!result.requeueTaskIds.includes("T4"), "T4 should NOT be requeued — it's pending, not blocked");
  });

  it("cascades three levels deep when all blockers clear simultaneously", () => {
    // T1: completed
    // T2: blocked (dep on T1) → requeued → now "pending" in virtual state
    // T3: blocked (dep on T2) → T2 is now pending in virtual → requeued
    // T4: blocked (dep on T3) → T3 is now pending in virtual → requeued, and since T3 is "ready" and T2 is "ready" and all deps clear → ready
    const tasks = [
      makeTask({ id: "T1" }),
      makeTask({ id: "T2", dependencies: ["T1"] }),
      makeTask({ id: "T3", dependencies: ["T2"] }),
      makeTask({ id: "T4", dependencies: ["T3"] }),
    ];

    const depBlockerT2 = createDependencyBlocker(tasks[1], ["T1"]);
    const depBlockerT3 = createDependencyBlocker(tasks[2], ["T2"]);
    const depBlockerT4 = createDependencyBlocker(tasks[3], ["T3"]);

    const taskState: Record<string, TaskRuntimeState> = {
      T1: makeRuntime("T1", "completed"),
      T2: makeRuntime("T2", "blocked", depBlockerT2),
      T3: makeRuntime("T3", "blocked", depBlockerT3),
      T4: makeRuntime("T4", "blocked", depBlockerT4),
    };

    const result = computeSchedulingActions(makeSnapshot(tasks, taskState));

    assert(result.requeueTaskIds.includes("T2"), "T2 requeued");
    assert(result.requeueTaskIds.includes("T3"), "T3 requeued (cascade)");
    assert(result.requeueTaskIds.includes("T4"), "T4 requeued (cascade level 2)");
  });

  it("does not cascade when blocking dependency is still failed", () => {
    // T1: failed
    // T2: blocked (dep-blocker on T1) → T1 still failed, so T2 stays blocked
    // T3: blocked (dep-blocker on T2) → T2 stayed blocked, so T3 stays blocked
    const tasks = [
      makeTask({ id: "T1" }),
      makeTask({ id: "T2", dependencies: ["T1"] }),
      makeTask({ id: "T3", dependencies: ["T2"] }),
    ];

    const depBlockerT2 = createDependencyBlocker(tasks[1], ["T1"]);
    const depBlockerT3 = createDependencyBlocker(tasks[2], ["T2"]);

    const taskState: Record<string, TaskRuntimeState> = {
      T1: makeRuntime("T1", "failed"),
      T2: makeRuntime("T2", "blocked", depBlockerT2),
      T3: makeRuntime("T3", "blocked", depBlockerT3),
    };

    const result = computeSchedulingActions(makeSnapshot(tasks, taskState));

    assert(!result.requeueTaskIds.includes("T2"), "T2 should NOT be requeued while T1 is failed");
    assert(!result.requeueTaskIds.includes("T3"), "T3 should NOT be requeued while T2 is blocked");
  });

  it("handles partially resolved dependency chain", () => {
    // T1: completed
    // T2: failed (but T1 is completed, so T2's dep-blocker should clear)
    // T3: blocked (dep-blocker on T2 AND T1)
    // T2 is failed → T3 still has a failed dep
    const tasks = [
      makeTask({ id: "T1" }),
      makeTask({ id: "T2", dependencies: ["T1"] }),
      makeTask({ id: "T3", dependencies: ["T1", "T2"] }),
    ];

    // T2 is blocked by T1, but T1 is completed → T2 gets requeued
    const depBlockerT2 = createDependencyBlocker(tasks[1], ["T1"]);
    const depBlockerT3 = createDependencyBlocker(tasks[2], ["T1", "T2"]);

    const taskState: Record<string, TaskRuntimeState> = {
      T1: makeRuntime("T1", "completed"),
      T2: makeRuntime("T2", "blocked", depBlockerT2),
      T3: makeRuntime("T3", "blocked", depBlockerT3),
    };

    const result = computeSchedulingActions(makeSnapshot(tasks, taskState));

    assert(result.requeueTaskIds.includes("T2"), "T2 should be requeued (T1 completed)");

    // T3: T1 is completed but T2 was blocked (now requeued to pending)
    // After cascade: T2 virtual status is "pending", which is not "failed"/"blocked"
    // So T3's only remaining failed dep is... none! T1 completed, T2 pending
    assert(result.requeueTaskIds.includes("T3"), "T3 should be requeued (all failed deps cleared via cascade)");
  });

  it("requeues cascaded task as ready when all deps are completed", () => {
    // T1: completed, T2: completed
    // T3: blocked (dep on T1) → T1 completed → requeue
    // T4: blocked (dep on T2, T3) → T2 completed + T3 requeued → cascade
    const tasks = [
      makeTask({ id: "T1" }),
      makeTask({ id: "T2" }),
      makeTask({ id: "T3", dependencies: ["T1"] }),
      makeTask({ id: "T4", dependencies: ["T2", "T3"] }),
    ];

    const depBlockerT3 = createDependencyBlocker(tasks[2], ["T1"]);
    const depBlockerT4 = createDependencyBlocker(tasks[3], ["T2", "T3"]);

    const taskState: Record<string, TaskRuntimeState> = {
      T1: makeRuntime("T1", "completed"),
      T2: makeRuntime("T2", "completed"),
      T3: makeRuntime("T3", "blocked", depBlockerT3),
      T4: makeRuntime("T4", "blocked", depBlockerT4),
    };

    const result = computeSchedulingActions(makeSnapshot(tasks, taskState));

    assert(result.requeueTaskIds.includes("T3"), "T3 requeued (dep T1 completed)");
    assert(result.readyTaskIds.includes("T3"), "T3 ready (all deps completed: T1)");
    assert(result.requeueTaskIds.includes("T4"), "T4 requeued (cascade: T2 completed + T3 now ready)");
    // T4 depends on T2 (completed) and T3 (now pending in virtual state, not completed)
    // So T4 is requeued but NOT ready — T3 needs to complete first
  });

  it("handles diamond dependency resolution", () => {
    // Diamond: T1 → T2, T1 → T3, T2+T3 → T4
    // T1: completed
    // T2: blocked (dep on T1) → clear
    // T3: blocked (dep on T1) → clear
    // T4: blocked (dep on T2, T3) → cascade clear
    const tasks = [
      makeTask({ id: "T1" }),
      makeTask({ id: "T2", dependencies: ["T1"] }),
      makeTask({ id: "T3", dependencies: ["T1"] }),
      makeTask({ id: "T4", dependencies: ["T2", "T3"] }),
    ];

    const depBlockerT2 = createDependencyBlocker(tasks[1], ["T1"]);
    const depBlockerT3 = createDependencyBlocker(tasks[2], ["T1"]);
    const depBlockerT4 = createDependencyBlocker(tasks[3], ["T2", "T3"]);

    const taskState: Record<string, TaskRuntimeState> = {
      T1: makeRuntime("T1", "completed"),
      T2: makeRuntime("T2", "blocked", depBlockerT2),
      T3: makeRuntime("T3", "blocked", depBlockerT3),
      T4: makeRuntime("T4", "blocked", depBlockerT4),
    };

    const result = computeSchedulingActions(makeSnapshot(tasks, taskState));

    assert(result.requeueTaskIds.includes("T2"), "T2 requeued");
    assert(result.requeueTaskIds.includes("T3"), "T3 requeued");
    assert(result.requeueTaskIds.includes("T4"), "T4 requeued (cascade through diamond)");
  });

  it("creates dependency blockers for pending tasks with failed deps", () => {
    const tasks = [
      makeTask({ id: "T1" }),
      makeTask({ id: "T2", dependencies: ["T1"] }),
    ];

    const taskState: Record<string, TaskRuntimeState> = {
      T1: makeRuntime("T1", "failed"),
      T2: makeRuntime("T2", "pending"),
    };

    const result = computeSchedulingActions(makeSnapshot(tasks, taskState));

    assert(result.blockedTasks.length === 1, "T2 should be blocked");
    assert(result.blockedTasks[0].taskId === "T2", "T2 is the blocked task");
    assert(result.blockedTasks[0].blocker.category === "dependency", "blocker category is dependency");
  });

  it("returns empty actions for null snapshot", () => {
    const result = computeSchedulingActions(null);

    assert(result.readyTaskIds.length === 0, "no ready tasks");
    assert(result.blockedTasks.length === 0, "no blocked tasks");
    assert(result.requeueTaskIds.length === 0, "no requeue tasks");
  });
});

describe("failedDependencies", () => {
  it("returns deps with failed or blocked status", () => {
    const task = makeTask({ id: "T3", dependencies: ["T1", "T2", "T4"] });
    const taskState: Record<string, { status?: string } | undefined> = {
      T1: { status: "completed" },
      T2: { status: "failed" },
      T4: { status: "blocked" },
    };

    const result = failedDependencies(task, taskState);

    assert(result.length === 2, "should return 2 failed deps");
    assert(result.includes("T2"), "T2 is failed");
    assert(result.includes("T4"), "T4 is blocked");
  });

  it("returns empty when all deps are completed", () => {
    const task = makeTask({ id: "T3", dependencies: ["T1", "T2"] });
    const taskState: Record<string, { status?: string } | undefined> = {
      T1: { status: "completed" },
      T2: { status: "completed" },
    };

    const result = failedDependencies(task, taskState);
    assert(result.length === 0, "no failed deps");
  });

  it("does not treat pending or ready deps as failed", () => {
    const task = makeTask({ id: "T3", dependencies: ["T1", "T2"] });
    const taskState: Record<string, { status?: string } | undefined> = {
      T1: { status: "pending" },
      T2: { status: "ready" },
    };

    const result = failedDependencies(task, taskState);
    assert(result.length === 0, "pending/ready deps are not failed");
  });
});

describe("dependenciesResolved", () => {
  it("returns true only when all deps are completed", () => {
    const task = makeTask({ id: "T3", dependencies: ["T1", "T2"] });
    const state1: Record<string, { status?: string } | undefined> = {
      T1: { status: "completed" },
      T2: { status: "pending" },
    };
    assert(!dependenciesResolved(task, state1), "not all completed");

    const state2: Record<string, { status?: string } | undefined> = {
      T1: { status: "completed" },
      T2: { status: "completed" },
    };
    assert(dependenciesResolved(task, state2), "all completed");
  });

  it("returns true when task has no deps", () => {
    const task = makeTask({ id: "T1" });
    assert(dependenciesResolved(task, {}), "no deps = resolved");
  });
});