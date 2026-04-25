import { describe, it } from "node:test";
import { projectRootActionableBlocker } from "./root-actionable-blocker-selection.ts";
import type { ForgeTask, RunSnapshot } from "../../types.ts";

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

function blockedDependencyChainFixture(): RunSnapshot {
  return {
    schemaVersion: 3,
    orchestrationId: "orch-chain",
    status: "needs_human_intervention",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: {},
    cost: {},
    tasks: [
      makeTask("TF-05"),
      makeTask("TF-06", ["TF-05"]),
      makeTask("TF-07", ["TF-06"]),
    ],
    taskState: {
      "TF-05": {
        taskId: "TF-05",
        status: "blocked",
        retries: 1,
        runAttempt: 1,
        diagnostic: {
          classification: "requirement_or_plan_error",
          notes: "Acceptance command is prose, not executable",
          blockerCategory: "validation_contract",
        },
        blocker: {
          taskId: "TF-05",
          category: "validation_contract",
          reason: "Acceptance command is prose, not executable",
          suggestion: "Patch the validation contract with a real executable command",
          blockedTasks: ["TF-05"],
        },
      },
      "TF-06": {
        taskId: "TF-06",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-06",
          category: "dependency",
          reason: "Blocked by failed dependency: TF-05",
          suggestion: "Resolve TF-05 and then rerun /forge execute.",
          blockedTasks: ["TF-06", "TF-05"],
        },
      },
      "TF-07": {
        taskId: "TF-07",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-07",
          category: "dependency",
          reason: "Blocked by failed dependency: TF-06",
          suggestion: "Resolve TF-06 and then rerun /forge execute.",
          blockedTasks: ["TF-07", "TF-06"],
        },
      },
    },
    blockers: [
      {
        taskId: "TF-05",
        category: "validation_contract",
        reason: "Acceptance command is prose, not executable",
        suggestion: "Patch the validation contract with a real executable command",
        blockedTasks: ["TF-05"],
      },
      {
        taskId: "TF-06",
        category: "dependency",
        reason: "Blocked by failed dependency: TF-05",
        suggestion: "Resolve TF-05 and then rerun /forge execute.",
        blockedTasks: ["TF-06", "TF-05"],
      },
      {
        taskId: "TF-07",
        category: "dependency",
        reason: "Blocked by failed dependency: TF-06",
        suggestion: "Resolve TF-06 and then rerun /forge execute.",
        blockedTasks: ["TF-07", "TF-06"],
      },
    ],
    supervisors: {},
    pendingHumanIntervention: {
      taskId: "TF-05",
      reason: "Acceptance command is prose, not executable",
      suggestion: "Patch the validation contract with a real executable command",
      requestedAt: "2026-04-19T10:00:00.000Z",
    },
    timestamps: {
      started: "2026-04-19T09:00:00.000Z",
      lastUpdated: "2026-04-19T10:00:00.000Z",
    },
  };
}

function multipleRootBlockersFixture(): RunSnapshot {
  return {
    schemaVersion: 3,
    orchestrationId: "orch-multi-root",
    status: "needs_human_intervention",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: {},
    cost: {},
    tasks: [
      makeTask("TF-01"),
      makeTask("TF-02", ["TF-01"]),
      makeTask("TF-09"),
      makeTask("TF-10", ["TF-09"]),
    ],
    taskState: {
      "TF-01": {
        taskId: "TF-01",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-01",
          category: "environment",
          reason: "Environment timed out while reaching test service",
          suggestion: "Retry after the transient outage clears",
          blockedTasks: ["TF-01"],
        },
      },
      "TF-02": {
        taskId: "TF-02",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-02",
          category: "dependency",
          reason: "Blocked by failed dependency: TF-01",
          suggestion: "Resolve TF-01 and then rerun /forge execute.",
          blockedTasks: ["TF-02", "TF-01"],
        },
      },
      "TF-09": {
        taskId: "TF-09",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-09",
          category: "plan_contract",
          reason: "Generated tests contradict the task contract",
          suggestion: "Replan the affected task subtree",
          blockedTasks: ["TF-09"],
        },
      },
      "TF-10": {
        taskId: "TF-10",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-10",
          category: "dependency",
          reason: "Blocked by failed dependency: TF-09",
          suggestion: "Resolve TF-09 and then rerun /forge execute.",
          blockedTasks: ["TF-10", "TF-09"],
        },
      },
    },
    blockers: [
      {
        taskId: "TF-01",
        category: "environment",
        reason: "Environment timed out while reaching test service",
        suggestion: "Retry after the transient outage clears",
        blockedTasks: ["TF-01"],
      },
      {
        taskId: "TF-02",
        category: "dependency",
        reason: "Blocked by failed dependency: TF-01",
        suggestion: "Resolve TF-01 and then rerun /forge execute.",
        blockedTasks: ["TF-02", "TF-01"],
      },
      {
        taskId: "TF-09",
        category: "plan_contract",
        reason: "Generated tests contradict the task contract",
        suggestion: "Replan the affected task subtree",
        blockedTasks: ["TF-09"],
      },
      {
        taskId: "TF-10",
        category: "dependency",
        reason: "Blocked by failed dependency: TF-09",
        suggestion: "Resolve TF-09 and then rerun /forge execute.",
        blockedTasks: ["TF-10", "TF-09"],
      },
    ],
    supervisors: {},
    timestamps: {
      started: "2026-04-19T09:00:00.000Z",
      lastUpdated: "2026-04-19T10:00:00.000Z",
    },
  };
}

function zeroBlockerFixture(): RunSnapshot {
  return {
    schemaVersion: 3,
    orchestrationId: "orch-zero",
    status: "executing",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: {},
    cost: {},
    tasks: [
      makeTask("TF-20"),
      makeTask("TF-21", ["TF-20"]),
    ],
    taskState: {
      "TF-20": { taskId: "TF-20", status: "completed", retries: 0, runAttempt: 1 },
      "TF-21": { taskId: "TF-21", status: "running", retries: 0, runAttempt: 1 },
    },
    blockers: [],
    supervisors: {},
    timestamps: {
      started: "2026-04-19T09:00:00.000Z",
      lastUpdated: "2026-04-19T10:00:00.000Z",
    },
  };
}

function allDependencyBlockerFixture(): RunSnapshot {
  return {
    schemaVersion: 3,
    orchestrationId: "orch-dep-only",
    status: "needs_human_intervention",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: {},
    cost: {},
    tasks: [
      makeTask("TF-60"),
      makeTask("TF-61", ["TF-60"]),
    ],
    taskState: {
      "TF-60": {
        taskId: "TF-60",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-60",
          category: "dependency",
          reason: "External dependency unavailable",
          suggestion: "Retry after the external service recovers",
          blockedTasks: ["TF-60"],
        },
      },
      "TF-61": {
        taskId: "TF-61",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-61",
          category: "dependency",
          reason: "Blocked by failed dependency: TF-60",
          suggestion: "Resolve TF-60 and then rerun /forge execute.",
          blockedTasks: ["TF-61", "TF-60"],
        },
      },
    },
    blockers: [
      {
        taskId: "TF-60",
        category: "dependency",
        reason: "External dependency unavailable",
        suggestion: "Retry after the external service recovers",
        blockedTasks: ["TF-60"],
      },
      {
        taskId: "TF-61",
        category: "dependency",
        reason: "Blocked by failed dependency: TF-60",
        suggestion: "Resolve TF-60 and then rerun /forge execute.",
        blockedTasks: ["TF-61", "TF-60"],
      },
    ],
    supervisors: {},
    timestamps: {
      started: "2026-04-19T09:00:00.000Z",
      lastUpdated: "2026-04-19T10:00:00.000Z",
    },
  };
}

function diamondDependencyFixture(): RunSnapshot {
  return {
    schemaVersion: 3,
    orchestrationId: "orch-diamond",
    status: "needs_human_intervention",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: {},
    cost: {},
    tasks: [
      makeTask("TF-70"),
      makeTask("TF-71", ["TF-70"]),
      makeTask("TF-72", ["TF-70"]),
    ],
    taskState: {
      "TF-70": {
        taskId: "TF-70",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-70",
          category: "runtime",
          reason: "Test runner crashed with segfault",
          suggestion: "Re-run the test suite after cleaning build artifacts",
          blockedTasks: ["TF-70"],
        },
      },
      "TF-71": {
        taskId: "TF-71",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-71",
          category: "dependency",
          reason: "Blocked by failed dependency: TF-70",
          suggestion: "Resolve TF-70 and then rerun /forge execute.",
          blockedTasks: ["TF-71", "TF-70"],
        },
      },
      "TF-72": {
        taskId: "TF-72",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-72",
          category: "dependency",
          reason: "Blocked by failed dependency: TF-70",
          suggestion: "Resolve TF-70 and then rerun /forge execute.",
          blockedTasks: ["TF-72", "TF-70"],
        },
      },
    },
    blockers: [
      {
        taskId: "TF-70",
        category: "runtime",
        reason: "Test runner crashed with segfault",
        suggestion: "Re-run the test suite after cleaning build artifacts",
        blockedTasks: ["TF-70"],
      },
      {
        taskId: "TF-71",
        category: "dependency",
        reason: "Blocked by failed dependency: TF-70",
        suggestion: "Resolve TF-70 and then rerun /forge execute.",
        blockedTasks: ["TF-71", "TF-70"],
      },
      {
        taskId: "TF-72",
        category: "dependency",
        reason: "Blocked by failed dependency: TF-70",
        suggestion: "Resolve TF-70 and then rerun /forge execute.",
        blockedTasks: ["TF-72", "TF-70"],
      },
    ],
    supervisors: {},
    timestamps: {
      started: "2026-04-19T09:00:00.000Z",
      lastUpdated: "2026-04-19T10:00:00.000Z",
    },
  };
}

function remediationOverrideFixture(): RunSnapshot {
  return {
    schemaVersion: 3,
    orchestrationId: "orch-remediation-override",
    status: "needs_human_intervention",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: {},
    cost: {},
    tasks: [
      makeTask("TF-80"),
    ],
    taskState: {
      "TF-80": {
        taskId: "TF-80",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-80",
          category: "validation_contract",
          reason: "Acceptance command is prose, not executable",
          suggestion: "Patch the validation contract with a real executable command",
          blockedTasks: ["TF-80"],
          remediation: {
            mode: "retry",
            category: "validation_contract",
            rationale: "Operator manually overrode to retry after fixing env",
          },
        },
      },
    },
    blockers: [
      {
        taskId: "TF-80",
        category: "validation_contract",
        reason: "Acceptance command is prose, not executable",
        suggestion: "Patch the validation contract with a real executable command",
        blockedTasks: ["TF-80"],
        remediation: {
          mode: "retry",
          category: "validation_contract",
          rationale: "Operator manually overrode to retry after fixing env",
        },
      },
    ],
    supervisors: {},
    timestamps: {
      started: "2026-04-19T09:00:00.000Z",
      lastUpdated: "2026-04-19T10:00:00.000Z",
    },
  };
}

describe("root-actionable-blocker-selection integration", () => {
  it("Status projection prioritizes upstream root actionable blocker over downstream dependency symptoms", () => {
    const projection = projectRootActionableBlocker(blockedDependencyChainFixture());
  
    assert(projection.primaryBlocker?.taskId === "TF-05", "expected root actionable blocker TF-05 to be selected first");
    assert(projection.downstreamImpactTaskIds.join(",") === "TF-06,TF-07", "expected downstream impact summary to remain secondary");
    assert(projection.blockerIds.join(",") === "TF-05,TF-06,TF-07", "expected all blocker ids in summary");
  });
  
  it("Projection includes blocker category and remediation direction hints", () => {
    const chainProjection = projectRootActionableBlocker(blockedDependencyChainFixture());
    assert(chainProjection.primaryBlockerCategory === "validation_contract", "expected blocker category to be preserved");
    assert(chainProjection.remediationDirection === "patch/replan", "expected validation-contract blocker to hint patch/replan");
  
    const multipleRootsProjection = projectRootActionableBlocker(multipleRootBlockersFixture());
    assert(multipleRootsProjection.primaryBlocker?.taskId === "TF-09", "expected plan_contract blocker TF-09 to be selected as primary over environment blocker TF-01");
    assert(multipleRootsProjection.primaryBlocker?.taskId !== "TF-02", "expected dependency symptom TF-02 not to outrank a root blocker");
    assert(multipleRootsProjection.primaryBlocker?.taskId !== "TF-10", "expected dependency symptom TF-10 not to outrank a root blocker");
  });
  
  it("Zero-blocker snapshot returns empty projection without crashing", () => {
    const projection = projectRootActionableBlocker(zeroBlockerFixture());
  
    assert(projection.blockerIds.length === 0, "expected blockerIds to be empty");
    assert(projection.primaryBlocker === undefined, "expected no primaryBlocker for zero-blocker snapshot");
    assert(projection.primaryBlockerCategory === undefined, "expected no primaryBlockerCategory for zero-blocker snapshot");
    assert(projection.remediationDirection === undefined, "expected no remediationDirection for zero-blocker snapshot");
    assert(projection.downstreamImpactTaskIds.length === 0, "expected downstreamImpactTaskIds to be empty");
  });
  
  it("All-dependency-blocker snapshot falls back gracefully without crash", () => {
    const projection = projectRootActionableBlocker(allDependencyBlockerFixture());
  
    assert(projection.blockerIds.length === 2, "expected both dependency blocker IDs in summary");
    assert(projection.primaryBlocker !== undefined, "expected a fallback primaryBlocker even when all blockers are dependency type");
    assert(projection.primaryBlocker?.taskId === "TF-60", "expected root dependency blocker TF-60 as fallback primary");
    assert(projection.primaryBlockerCategory === "dependency", "expected dependency category on fallback primary");
    assert(projection.remediationDirection === "retry", "expected retry direction for dependency fallback");
  });
  
  it("Diamond dependency pattern converges on single root blocker", () => {
    const projection = projectRootActionableBlocker(diamondDependencyFixture());
  
    assert(projection.primaryBlocker?.taskId === "TF-70", "expected diamond pattern to identify TF-70 as the single root");
    assert(projection.primaryBlockerCategory === "runtime", "expected runtime category for diamond root");
    assert(projection.downstreamImpactTaskIds.join(",") === "TF-71,TF-72", "expected both diamond branches in downstream impact");
    assert(projection.blockerIds.join(",") === "TF-70,TF-71,TF-72", "expected all blocker IDs in summary");
  });
  
  it("Blocker with pre-set remediation mode reflects correct remediation direction", () => {
    const projection = projectRootActionableBlocker(remediationOverrideFixture());
  
    assert(projection.primaryBlocker?.taskId === "TF-80", "expected TF-80 as primary blocker");
    assert(projection.primaryBlockerCategory === "validation_contract", "expected validation_contract category");
    assert(projection.remediationMode === "retry", "expected remediation mode to reflect pre-set override");
    assert(projection.remediationDirection === "retry", "expected remediation direction to be retry when override is set");
  });
  
});