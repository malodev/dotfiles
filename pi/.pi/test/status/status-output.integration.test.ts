const nodeTestModulePath = "node:test";
const { describe, it } = await import(nodeTestModulePath);

const statusRenderModulePath = "../../agent/extensions/task-forge/src/commands/status/render-root-blocker.ts";
const { renderRootActionableBlockerStatus } = await import(statusRenderModulePath);

export {};

type BlockerCategory = "environment" | "dependency" | "validation_contract" | "plan_contract" | "runtime" | "unknown";

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
  timestamps: {
    started: string;
    lastUpdated: string;
  };
};

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
    timestamps: {
      started: "2026-04-22T09:00:00.000Z",
      lastUpdated: "2026-04-22T10:00:00.000Z",
    },
  };
}

describe("status output integration", () => {
  it("keeps full blocker list visible while explicitly rendering one primary blocker", () => {
    const snapshot = buildSnapshot({
      orchestrationId: "status-mixed-blocked",
      tasks: [
        makeTask("T4"),
        makeTask("T5"),
        makeTask("T6", ["T5"]),
        makeTask("T7", ["T5"]),
      ],
      taskState: {
        T4: { taskId: "T4", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T4", "runtime", "Runtime panic") },
        T5: { taskId: "T5", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T5", "plan_contract", "Task contract mismatch") },
        T6: { taskId: "T6", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T6", "dependency", "Blocked by failed dependency: T5") },
        T7: { taskId: "T7", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T7", "dependency", "Blocked by failed dependency: T5") },
      },
      blockers: [
        blocker("T4", "runtime", "Runtime panic"),
        blocker("T5", "plan_contract", "Task contract mismatch"),
        blocker("T6", "dependency", "Blocked by failed dependency: T5"),
        blocker("T7", "dependency", "Blocked by failed dependency: T5"),
      ],
    });

    const output = renderRootActionableBlockerStatus(snapshot);

    assert(output.includes("blockers: T4, T5, T6, T7"), "expected all blockers to remain visible in status output");
    assert(output.includes("primary blocker: T5"), "expected exactly one primary blocker to be explicit");
  });

  it("references the selected primary blocker task id in next guidance", () => {
    const snapshot = buildSnapshot({
      orchestrationId: "status-next-guidance",
      tasks: [
        makeTask("T5"),
        makeTask("T6", ["T5"]),
      ],
      taskState: {
        T5: { taskId: "T5", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T5", "runtime", "Worker crashed") },
        T6: { taskId: "T6", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T6", "dependency", "Blocked by failed dependency: T5") },
      },
      blockers: [
        blocker("T5", "runtime", "Worker crashed"),
        blocker("T6", "dependency", "Blocked by failed dependency: T5"),
      ],
    });

    const output = renderRootActionableBlockerStatus(snapshot);

    assert(output.includes('next: /forge blocker T5 --resolve "..." then /forge execute'), "expected next guidance to target selected primary blocker");
    assert(!output.includes('next: /forge blocker T6 --resolve "..." then /forge execute'), "expected dependency-only downstream task not to be implied as first action");
  });

  it("matches PRD dependency-chain example: blockers T5,T6,T7,T8 => primary T5 and next guidance for T5", () => {
    const snapshot = buildSnapshot({
      orchestrationId: "status-prd-example",
      tasks: [
        makeTask("T5"),
        makeTask("T6", ["T5"]),
        makeTask("T7", ["T5"]),
        makeTask("T8", ["T7"]),
      ],
      taskState: {
        T5: { taskId: "T5", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T5", "plan_contract", "Contract mismatch") },
        T6: { taskId: "T6", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T6", "dependency", "Blocked by failed dependency: T5") },
        T7: { taskId: "T7", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T7", "dependency", "Blocked by failed dependency: T5") },
        T8: { taskId: "T8", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T8", "dependency", "Blocked by failed dependency: T7") },
      },
      blockers: [
        blocker("T5", "plan_contract", "Contract mismatch"),
        blocker("T6", "dependency", "Blocked by failed dependency: T5"),
        blocker("T7", "dependency", "Blocked by failed dependency: T5"),
        blocker("T8", "dependency", "Blocked by failed dependency: T7"),
      ],
    });

    const output = renderRootActionableBlockerStatus(snapshot);

    assert(output.includes("blockers: T5, T6, T7, T8"), "expected full blocker list to include T5,T6,T7,T8");
    assert(output.includes("primary blocker: T5"), "expected primary blocker to resolve to T5");
    assert(output.includes('next: /forge blocker T5 --resolve "..." then /forge execute'), "expected next guidance to target T5");
  });

  it("preserves baseline semantics for non-blocked and single-blocked cases", () => {
    const noBlockersOutput = renderRootActionableBlockerStatus(null);
    assert(noBlockersOutput.trim() === "blockers: none", "expected no-blocker status to remain unchanged");

    const singleSnapshot = buildSnapshot({
      orchestrationId: "status-single-blocked",
      tasks: [makeTask("T1")],
      taskState: {
        T1: { taskId: "T1", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T1", "runtime", "Single blocker") },
      },
      blockers: [blocker("T1", "runtime", "Single blocker")],
    });

    const singleOutput = renderRootActionableBlockerStatus(singleSnapshot);
    assert(singleOutput.includes("blockers: T1"), "expected single blocker to remain visible");
    assert(singleOutput.includes("primary blocker: T1"), "expected single blocker to remain primary blocker");
    assert(singleOutput.includes('next: /forge blocker T1 --resolve "..." then /forge execute'), "expected next guidance to remain targeted at the single blocker");
  });
});
