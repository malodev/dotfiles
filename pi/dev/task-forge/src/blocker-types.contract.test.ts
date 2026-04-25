import { describe, it } from "node:test";
import { BLOCKER_CATEGORIES, BLOCKER_RESOLUTION_MODES, createBlocker, createRemediationRecord } from "./blocker-model.ts";
import type { BlockerCategory, BlockerResolutionMode, RemediationRecord } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

describe("blocker-types", () => {
  it("typed blocker categories are represented in domain model", () => {
    const categories: BlockerCategory[] = [...BLOCKER_CATEGORIES];

    assert(categories.includes("dependency"), "expected dependency blocker category");
    assert(categories.includes("validation_contract"), "expected validation contract blocker category");
    assert(categories.includes("plan_contract"), "expected plan contract blocker category");

    const blocker = createBlocker({
      taskId: "T1",
      category: "validation_contract",
      reason: "Acceptance command is invalid",
      suggestion: "Patch the task contract",
      blockedTasks: ["T1"],
    });

    assert(blocker.category === "validation_contract", "expected typed blocker category on blocker record");
  });

  it("typed blocker resolution modes are represented in domain model", () => {
    const modes: BlockerResolutionMode[] = [...BLOCKER_RESOLUTION_MODES];

    assert(modes.includes("retry"), "expected retry remediation mode");
    assert(modes.includes("patch_task_contract"), "expected patch_task_contract remediation mode");
    assert(modes.includes("replan_subgraph"), "expected replan_subgraph remediation mode");
  });

  it("RemediationRecord includes category/mode/rationale/durability commit reference fields", () => {
    const remediation: RemediationRecord = createRemediationRecord({
      mode: "patch_task_contract",
      category: "validation_contract",
      rationale: "Replace prose acceptance text with executable command",
      durabilityCommitRef: "events:42",
      durabilityCommittedAt: "2026-04-18T12:00:00.000Z",
    });

    assert(remediation.mode === "patch_task_contract", "expected remediation mode");
    assert(remediation.category === "validation_contract", "expected remediation category");
    assert(remediation.rationale.includes("Replace prose acceptance text"), "expected remediation rationale");
    assert(remediation.durabilityCommitRef === "events:42", "expected durability commit ref");
    assert(remediation.durabilityCommittedAt === "2026-04-18T12:00:00.000Z", "expected durability commit timestamp");
  });
});
