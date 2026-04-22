import { describe, it } from "node:test";
import { renderRootActionableBlockerStatus } from "../../../agent/extensions/task-forge/src/commands/status/render-root-blocker.ts";
import type { ForgeTask, RunSnapshot } from "../../../agent/extensions/task-forge/v2/types.ts";

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

function dependencyChainE2EFixture(): RunSnapshot {
  return {
    schemaVersion: 3,
    orchestrationId: "orch-tf-08-status",
    status: "needs_human_intervention",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: {},
    cost: {},
    tasks: [
      makeTask("TF-08-root"),
      makeTask("TF-08-mid", ["TF-08-root"]),
      makeTask("TF-08-leaf", ["TF-08-mid"]),
    ],
    taskState: {
      "TF-08-root": {
        taskId: "TF-08-root",
        status: "blocked",
        retries: 1,
        runAttempt: 1,
        blocker: {
          taskId: "TF-08-root",
          category: "plan_contract",
          reason: "Plan/test-spec mismatch requires targeted replan",
          suggestion: "Replan only the affected task subtree",
          blockedTasks: ["TF-08-root"],
        },
      },
      "TF-08-mid": {
        taskId: "TF-08-mid",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-08-mid",
          category: "dependency",
          reason: "Blocked by failed dependency: TF-08-root",
          suggestion: "Resolve TF-08-root and rerun execution",
          blockedTasks: ["TF-08-mid", "TF-08-root"],
        },
      },
      "TF-08-leaf": {
        taskId: "TF-08-leaf",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-08-leaf",
          category: "dependency",
          reason: "Blocked by failed dependency: TF-08-mid",
          suggestion: "Resolve TF-08-mid and rerun execution",
          blockedTasks: ["TF-08-leaf", "TF-08-mid"],
        },
      },
    },
    blockers: [
      {
        taskId: "TF-08-root",
        category: "plan_contract",
        reason: "Plan/test-spec mismatch requires targeted replan",
        suggestion: "Replan only the affected task subtree",
        blockedTasks: ["TF-08-root"],
      },
      {
        taskId: "TF-08-mid",
        category: "dependency",
        reason: "Blocked by failed dependency: TF-08-root",
        suggestion: "Resolve TF-08-root and rerun execution",
        blockedTasks: ["TF-08-mid", "TF-08-root"],
      },
      {
        taskId: "TF-08-leaf",
        category: "dependency",
        reason: "Blocked by failed dependency: TF-08-mid",
        suggestion: "Resolve TF-08-mid and rerun execution",
        blockedTasks: ["TF-08-leaf", "TF-08-mid"],
      },
    ],
    supervisors: {},
    pendingHumanIntervention: {
      taskId: "TF-08-root",
      reason: "Plan/test-spec mismatch requires targeted replan",
      suggestion: "Replan only the affected task subtree",
      requestedAt: "2026-04-19T10:00:00.000Z",
    },
    timestamps: {
      started: "2026-04-19T09:00:00.000Z",
      lastUpdated: "2026-04-19T10:00:00.000Z",
    },
  };
}

it("Status prioritizes root actionable blocker over downstream dependency blockers in end-to-end flow", () => {
  const output = renderRootActionableBlockerStatus(dependencyChainE2EFixture());

  assert(output.includes("blockers: TF-08-leaf, TF-08-mid, TF-08-root"), "expected all blockers in status output");
  assert(output.includes("primary blocker: TF-08-root"), "expected root actionable blocker to be prioritized");
  assert(output.includes("blocker category: plan_contract"), "expected category for root blocker");
  assert(output.includes("remediation direction: patch/replan"), "expected patch/replan hint for root blocker");
  assert(output.includes("downstream impact: TF-08-leaf, TF-08-mid"), "expected dependency impact listed as secondary");
  assert(output.includes('next: /forge blocker TF-08-root --resolve "..." then /forge execute'), "expected action to target root blocker");
  assert(!output.includes('next: /forge blocker TF-08-mid --resolve "..." then /forge execute'), "expected downstream dependency blocker not to be primary action");
});
