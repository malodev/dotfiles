import { describe, it } from "node:test";
import { selectBlockerResolutionMode } from "./blocker-resolution-mode.ts";

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

describe("resolution-mode-selector", () => {
  it("contract-related categories do not fall through to plain retry unless explicit override exists", () => {
    assertEquals(
      selectBlockerResolutionMode({
        category: "validation_contract",
        reason: "Acceptance command is prose, not executable",
        suggestion: "Replace prose validation with an executable command",
        diagnosticClassification: "requirement_or_plan_error",
        diagnosticNotes: "validation command is prose",
        resolution: "Use the correct validation command for this task",
        blockedTasks: ["TF-03"],
      }),
      "patch_test_spec",
      "validation-contract blockers should choose a structural remediation mode",
    );

    assertEquals(
      selectBlockerResolutionMode({
        category: "plan_contract",
        reason: "Generated tests contradict the task contract",
        suggestion: "Regenerate the affected task subtree",
        diagnosticClassification: "requirement_or_plan_error",
        diagnosticNotes: "planner/test contract mismatch",
        resolution: "Regenerate the affected task subtree with corrected contract inputs",
        blockedTasks: ["TF-03", "TF-04"],
      }),
      "replan_subgraph",
      "plan-contract blockers should choose a replan mode",
    );

    assertEquals(
      selectBlockerResolutionMode({
        category: "validation_contract",
        reason: "Acceptance signal is invalid prose",
        suggestion: "Replace the acceptance contract",
        resolution: "Force retry after human review; explicit retry override",
      }),
      "retry",
      "explicit override should permit retry for contract blockers",
    );
  });

  it("transient/environment categories preserve retry behavior", () => {
    assertEquals(
      selectBlockerResolutionMode({
        category: "environment",
        reason: "Environment timed out while reaching test service",
        suggestion: "Retry after transient outage clears",
        resolution: "Rerun once the service is healthy",
      }),
      "retry",
      "environment blockers should continue using retry",
    );

    assertEquals(
      selectBlockerResolutionMode({
        category: "dependency",
        reason: "Blocked by failed dependency: TF-02",
        suggestion: "Resolve TF-02 first",
        resolution: "Retry after TF-02 is resolved",
        blockedTasks: ["TF-03", "TF-02"],
      }),
      "retry",
      "dependency blockers should continue using retry semantics",
    );
  });
});
