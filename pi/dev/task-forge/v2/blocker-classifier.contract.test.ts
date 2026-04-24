import { describe, it } from "node:test";
import { classifyBlockerEvidence } from "./blocker-classifier.ts";
import { createDependencyBlocker } from "./execution.ts";
import { blockerFromDiagnosticDecision } from "./task-diagnostic.ts";

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

describe("blocker-classifier", () => {
  it("maps blocker evidence into required categories", () => {
    const cases = [
      {
        evidence: { reason: "Environment timed out while reaching test service", suggestion: "Retry after transient outage clears" },
        expected: "environment",
      },
      {
        evidence: { reason: "Blocked by failed dependency: T4", suggestion: "Resolve T4 first" },
        expected: "dependency",
      },
      {
        evidence: { reason: "Acceptance command is prose, not executable", suggestion: "Replace prose validation with a real command" },
        expected: "validation_contract",
      },
      {
        evidence: { reason: "Generated tests contradict the plan and task requirements", suggestion: "Replan the task/test spec" },
        expected: "plan_contract",
      },
    ] as const;

    for (const testCase of cases) {
      assertEquals(classifyBlockerEvidence(testCase.evidence), testCase.expected, `unexpected category for ${testCase.evidence.reason}`);
    }
  });

  it("classifies invalid executable/prose validation as contract-related", () => {
    const blocker = blockerFromDiagnosticDecision("TF-02", {
      kind: "block",
      classification: "requirement_or_plan_error",
      blocker: {
        reason: "Validation command is prose and not executable",
        suggestion: "Patch the validation contract to use manual validation or a real command",
        blockedTasks: ["TF-02"],
      },
    });

    assertEquals(blocker.category, "validation_contract", "expected prose validation blocker to be classified as contract-related");
  });

  it("keeps dependency blockers distinct from root contract blockers", () => {
    const dependencyBlocker = createDependencyBlocker({ id: "TF-03" }, ["TF-02"]);
    const rootBlocker = blockerFromDiagnosticDecision("TF-02", {
      kind: "block",
      classification: "requirement_or_plan_error",
      blocker: {
        reason: "Generated tests contradict the task contract",
        suggestion: "Regenerate the affected task subtree",
        blockedTasks: ["TF-02"],
      },
    });

    assertEquals(dependencyBlocker.category, "dependency", "expected downstream dependency blocker category");
    assertEquals(rootBlocker.category, "plan_contract", "expected root blocker to stay contract-scoped");
  });
});
