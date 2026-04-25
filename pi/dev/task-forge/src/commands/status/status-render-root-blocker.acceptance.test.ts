import { describe, it } from "node:test";
import { renderRootActionableBlockerStatus } from "./render-root-blocker.ts";
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

function statusCliSnapshotFixture(): RunSnapshot {
  return {
    schemaVersion: 3,
    orchestrationId: "orch-status",
    status: "needs_human_intervention",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: {},
    cost: {},
    tasks: [
      makeTask("TF-05"),
      makeTask("TF-06", ["TF-05"]),
      makeTask("TF-07", ["TF-05"]),
    ],
    taskState: {
      "TF-05": {
        taskId: "TF-05",
        status: "blocked",
        retries: 1,
        runAttempt: 1,
        blocker: {
          taskId: "TF-05",
          category: "plan_contract",
          reason: "Generated tests contradict the task contract",
          suggestion: "Replan the affected task subtree",
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
          reason: "Blocked by failed dependency: TF-05",
          suggestion: "Resolve TF-05 and then rerun /forge execute.",
          blockedTasks: ["TF-07", "TF-05"],
        },
      },
    },
    blockers: [
      {
        taskId: "TF-05",
        category: "plan_contract",
        reason: "Generated tests contradict the task contract",
        suggestion: "Replan the affected task subtree",
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
        reason: "Blocked by failed dependency: TF-05",
        suggestion: "Resolve TF-05 and then rerun /forge execute.",
        blockedTasks: ["TF-07", "TF-05"],
      },
    ],
    supervisors: {},
    timestamps: {
      started: "2026-04-19T09:00:00.000Z",
      lastUpdated: "2026-04-19T10:00:00.000Z",
    },
  };
}

describe("status-render-root-blocker", () => {
  it("points user to root actionable blocker first and keeps downstream impact secondary", () => {
    const output = renderRootActionableBlockerStatus(statusCliSnapshotFixture());

    assert(output.includes("blockers: TF-05, TF-06, TF-07"), "expected all blockers in summary");
    assert(output.includes("primary blocker: TF-05"), "expected root actionable blocker to be rendered first");
    assert(output.includes("blocker category: plan_contract"), "expected blocker category in output");
    assert(output.includes("remediation direction: patch/replan"), "expected remediation direction hint in output");
    assert(output.includes("downstream impact: TF-06, TF-07"), "expected downstream impact summary in output");
    assert(output.includes('next: /forge blocker TF-05 --resolve "..." then /forge execute'), "expected next action to target the root blocker");
    assert(!output.includes('next: /forge blocker TF-06 --resolve "..." then /forge execute'), "expected dependency symptom not to be rendered as primary action");
  });
});