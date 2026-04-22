const nodeTestModulePath = "node:test";
const { describe, it } = await import(nodeTestModulePath);

const projectionModulePath = "../../agent/extensions/task-forge/src/status/projection/root-actionable-blocker-selection.ts";
const { projectRootActionableBlocker } = await import(projectionModulePath);

type ForgeTask = {
  id: string;
  title: string;
  description: string;
  complexity: "S" | "M" | "L";
  taskMode: "single-pass" | "iterative";
  contextManifest: Record<string, unknown>;
  outputManifest: string[];
  dependencies: string[];
  acceptanceCriteria: string[];
  escalationTriggers: string[];
  validation: { mode: "manual"; notes: string };
};

type BlockerCategory = "environment" | "dependency" | "validation_contract" | "plan_contract" | "runtime" | "unknown";

type RunSnapshot = {
  schemaVersion: 3;
  orchestrationId: string;
  status: "needs_human_intervention";
  currentPhase: 5;
  phaseLabel: string;
  resolvedModels: Record<string, unknown>;
  cost: Record<string, unknown>;
  tasks: ForgeTask[];
  taskState: Record<string, {
    taskId: string;
    status: "blocked";
    retries: number;
    runAttempt: number;
    blocker: {
      taskId: string;
      category: BlockerCategory;
      reason: string;
      suggestion: string;
      blockedTasks: string[];
    };
  }>;
  blockers: Array<{
    taskId: string;
    category: BlockerCategory;
    reason: string;
    suggestion: string;
    blockedTasks: string[];
  }>;
  supervisors: Record<string, unknown>;
  pendingHumanIntervention?: {
    taskId: string;
    reason: string;
    suggestion: string;
    requestedAt: string;
  };
  timestamps: {
    started: string;
    lastUpdated: string;
  };
};

export {};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeTask(id: string, dependencies: string[] = []): ForgeTask {
  return {
    id,
    title: id,
    description: id,
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: [],
    dependencies,
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: { mode: "manual", notes: "n/a" },
  };
}

function blocker(taskId: string, category: BlockerCategory, reason: string) {
  return {
    taskId,
    category,
    reason,
    suggestion: `Resolve ${taskId}`,
    blockedTasks: [taskId],
  };
}

function buildSnapshot(args: {
  orchestrationId: string;
  tasks: ForgeTask[];
  taskState: RunSnapshot["taskState"];
  blockers: RunSnapshot["blockers"];
  pendingHumanIntervention?: RunSnapshot["pendingHumanIntervention"];
}): RunSnapshot {
  return {
    schemaVersion: 3,
    orchestrationId: args.orchestrationId,
    status: "needs_human_intervention",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: {},
    cost: {},
    tasks: args.tasks,
    taskState: args.taskState,
    blockers: args.blockers,
    supervisors: {},
    pendingHumanIntervention: args.pendingHumanIntervention,
    timestamps: {
      started: "2026-04-22T09:00:00.000Z",
      lastUpdated: "2026-04-22T10:00:00.000Z",
    },
  };
}

describe("primary blocker selector", () => {
  it("enforces selection priority: human intervention > direct blocker > dependency-blocked fallback", () => {
    const directAndDependency = buildSnapshot({
      orchestrationId: "priority-direct-over-dependency",
      tasks: [
        makeTask("TF-10"),
        makeTask("TF-20", ["TF-10"]),
      ],
      taskState: {
        "TF-10": { taskId: "TF-10", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("TF-10", "runtime", "Runtime panic") },
        "TF-20": {
          taskId: "TF-20",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-20", "dependency", "Blocked by failed dependency: TF-10"),
        },
      },
      blockers: [
        blocker("TF-10", "runtime", "Runtime panic"),
        blocker("TF-20", "dependency", "Blocked by failed dependency: TF-10"),
      ],
    });

    const withHumanIntervention = buildSnapshot({
      orchestrationId: "priority-human-over-direct",
      tasks: [
        makeTask("TF-30"),
        ...directAndDependency.tasks,
      ],
      taskState: {
        "TF-30": {
          taskId: "TF-30",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-30", "validation_contract", "Needs human contract fix"),
        },
        ...directAndDependency.taskState,
      },
      blockers: [
        blocker("TF-30", "validation_contract", "Needs human contract fix"),
        ...directAndDependency.blockers,
      ],
      pendingHumanIntervention: {
        taskId: "TF-30",
        reason: "Needs human contract fix",
        suggestion: "Patch task contract",
        requestedAt: "2026-04-22T10:01:00.000Z",
      },
    });

    const dependencyOnlyFallback = buildSnapshot({
      orchestrationId: "priority-dependency-fallback",
      tasks: [
        makeTask("TF-40"),
        makeTask("TF-41", ["TF-40"]),
      ],
      taskState: {
        "TF-40": {
          taskId: "TF-40",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-40", "dependency", "External dependency unavailable"),
        },
        "TF-41": {
          taskId: "TF-41",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-41", "dependency", "Blocked by failed dependency: TF-40"),
        },
      },
      blockers: [
        blocker("TF-40", "dependency", "External dependency unavailable"),
        blocker("TF-41", "dependency", "Blocked by failed dependency: TF-40"),
      ],
    });

    assert(projectRootActionableBlocker(withHumanIntervention).primaryBlocker?.taskId === "TF-30", "expected human intervention task to outrank all others");
    assert(projectRootActionableBlocker(directAndDependency).primaryBlocker?.taskId === "TF-10", "expected direct blocker to outrank dependency blocker");
    assert(projectRootActionableBlocker(dependencyOnlyFallback).primaryBlocker?.taskId === "TF-40", "expected dependency-only fallback to choose deterministic upstream candidate");
  });

  it("resolves upstream root blockers across one-hop and multi-hop dependency chains", () => {
    const snapshot = buildSnapshot({
      orchestrationId: "upstream-root-resolution",
      tasks: [
        makeTask("TF-05"),
        makeTask("TF-06", ["TF-05"]),
        makeTask("TF-07", ["TF-05"]),
        makeTask("TF-08"),
      ],
      taskState: {
        "TF-05": {
          taskId: "TF-05",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-05", "plan_contract", "Task contract mismatch"),
        },
        "TF-06": {
          taskId: "TF-06",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-06", "dependency", "Blocked by failed dependency: TF-05"),
        },
        "TF-07": {
          taskId: "TF-07",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-07", "dependency", "Blocked by failed dependency: TF-05"),
        },
        "TF-08": {
          taskId: "TF-08",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-08", "dependency", "Blocked by failed dependency: TF-07"),
        },
      },
      blockers: [
        blocker("TF-05", "plan_contract", "Task contract mismatch"),
        blocker("TF-06", "dependency", "Blocked by failed dependency: TF-05"),
        blocker("TF-07", "dependency", "Blocked by failed dependency: TF-05"),
        blocker("TF-08", "dependency", "Blocked by failed dependency: TF-07"),
      ],
    });

    const projection = projectRootActionableBlocker(snapshot);

    assert(projection.primaryBlocker?.taskId === "TF-05", "expected T6/T7/T8 dependency chain to resolve to root blocker TF-05");
    assert(projection.downstreamImpactTaskIds.join(",") === "TF-06,TF-07,TF-08", "expected downstream impact to include one-hop and multi-hop dependents");
  });

  it("applies deterministic tie-break rules among same-priority candidates", () => {
    const snapshot = buildSnapshot({
      orchestrationId: "deterministic-tie-break",
      tasks: [
        makeTask("TF-11"),
        makeTask("TF-02"),
      ],
      taskState: {
        "TF-11": {
          taskId: "TF-11",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-11", "runtime", "Same-priority runtime blocker A"),
        },
        "TF-02": {
          taskId: "TF-02",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-02", "runtime", "Same-priority runtime blocker B"),
        },
      },
      blockers: [
        blocker("TF-11", "runtime", "Same-priority runtime blocker A"),
        blocker("TF-02", "runtime", "Same-priority runtime blocker B"),
      ],
    });

    const first = projectRootActionableBlocker(snapshot);
    const second = projectRootActionableBlocker(snapshot);

    assert(first.primaryBlocker?.taskId === "TF-02", "expected deterministic tie-break to select lexicographically smallest task id");
    assert(second.primaryBlocker?.taskId === "TF-02", "expected repeated selection to remain deterministic");
  });

  it("falls back safely when upstream root cannot be resolved confidently", () => {
    const cycleSnapshot = buildSnapshot({
      orchestrationId: "safe-fallback-cycle",
      tasks: [
        makeTask("TF-90", ["TF-91"]),
        makeTask("TF-91", ["TF-90"]),
      ],
      taskState: {
        "TF-90": {
          taskId: "TF-90",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-90", "dependency", "Blocked by failed dependency: TF-91"),
        },
        "TF-91": {
          taskId: "TF-91",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-91", "dependency", "Blocked by failed dependency: TF-90"),
        },
      },
      blockers: [
        blocker("TF-90", "dependency", "Blocked by failed dependency: TF-91"),
        blocker("TF-91", "dependency", "Blocked by failed dependency: TF-90"),
      ],
    });

    const missingUpstreamSnapshot = buildSnapshot({
      orchestrationId: "safe-fallback-missing-upstream",
      tasks: [makeTask("TF-95")],
      taskState: {
        "TF-95": {
          taskId: "TF-95",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: blocker("TF-95", "dependency", "Blocked by failed dependency: TF-999"),
        },
      },
      blockers: [
        blocker("TF-95", "dependency", "Blocked by failed dependency: TF-999"),
      ],
    });

    const cycleProjection = projectRootActionableBlocker(cycleSnapshot);
    const missingProjection = projectRootActionableBlocker(missingUpstreamSnapshot);

    assert(cycleProjection.primaryBlocker?.taskId === "TF-90", "expected cycle fallback to remain deterministic without misleading upstream promotion");
    assert(missingProjection.primaryBlocker?.taskId === "TF-95", "expected missing upstream reference to fall back to local dependency blocker");
    assert(!missingProjection.blockerIds.includes("TF-999"), "expected unresolved upstream references not to be promoted into blocker list");
  });
});
