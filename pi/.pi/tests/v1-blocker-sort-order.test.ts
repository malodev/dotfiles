import { describe, it } from "node:test";
import { v1BlockerSortOrder } from "../agent/extensions/task-forge/v1-status-helpers.ts";

interface SimpleBlocker {
  taskId: string;
  reason: string;
  suggestion: string;
  blockedTasks: string[];
}

function makeBlocker(id: string, reason: string): SimpleBlocker {
  return { taskId: id, reason, suggestion: "", blockedTasks: [] };
}

function assertIds(blockers: SimpleBlocker[], expected: string[], label: string) {
  const actual = blockers.map((b: SimpleBlocker) => b.taskId);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

describe("v1BlockerSortOrder", () => {
  it("direct blockers come before dependency blockers", () => {
    const blockers: SimpleBlocker[] = [
      makeBlocker("B3", "Blocked by failed dependency: TF-01"),
      makeBlocker("B1", "Environment timed out"),
      makeBlocker("B4", "Blocked by failed dependency: TF-02"),
      makeBlocker("B2", "Acceptance command is prose, not executable"),
    ];

    const sorted = v1BlockerSortOrder(blockers);
    assertIds(sorted, ["B1", "B2", "B3", "B4"], "direct blockers before dependency blockers");
  });

  it("all direct blockers — order preserved", () => {
    const blockers: SimpleBlocker[] = [
      makeBlocker("B1", "Environment timed out"),
      makeBlocker("B2", "Runtime error in test"),
      makeBlocker("B3", "Some other direct reason"),
    ];

    const sorted = v1BlockerSortOrder(blockers);
    assertIds(sorted, ["B1", "B2", "B3"], "order unchanged for all direct");
  });

  it("all dependency blockers — order preserved", () => {
    const blockers: SimpleBlocker[] = [
      makeBlocker("B1", "Blocked by failed dependency: TF-01"),
      makeBlocker("B2", "Blocked by failed dependency: TF-02"),
      makeBlocker("B3", "Blocked by failed dependency: TF-03"),
    ];

    const sorted = v1BlockerSortOrder(blockers);
    assertIds(sorted, ["B1", "B2", "B3"], "order unchanged for all dependency");
  });

  it("empty array returns empty array", () => {
    const sorted = v1BlockerSortOrder([]);
    if (sorted.length !== 0) {
      throw new Error(`Expected empty array, got length ${sorted.length}`);
    }
  });

  it("single direct blocker", () => {
    const blockers: SimpleBlocker[] = [makeBlocker("B1", "Environment timed out")];
    const sorted = v1BlockerSortOrder(blockers);
    assertIds(sorted, ["B1"], "single direct blocker preserved");
  });

  it("single dependency blocker", () => {
    const blockers: SimpleBlocker[] = [makeBlocker("B1", "Blocked by failed dependency: TF-01")];
    const sorted = v1BlockerSortOrder(blockers);
    assertIds(sorted, ["B1"], "single dependency blocker preserved");
  });
});