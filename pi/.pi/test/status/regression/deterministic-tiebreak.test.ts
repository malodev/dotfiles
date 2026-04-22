const nodeTestModulePath = "node:test";
const helperModulePath = "./helpers.ts";
const projectionModulePath = "../../../agent/extensions/task-forge/src/status/projection/root-actionable-blocker-selection.ts";

const { describe, it } = await import(nodeTestModulePath);
const { assert, blocker, buildSnapshot, makeTask } = await import(helperModulePath);
const { projectRootActionableBlocker } = await import(projectionModulePath);

export {};

function buildSamePrioritySnapshot(orchestrationId: string, order: string[]) {
  const taskState: Record<string, unknown> = {};
  const blockers: unknown[] = [];

  for (const taskId of order) {
    taskState[taskId] = {
      taskId,
      status: "blocked",
      retries: 0,
      runAttempt: 1,
      blocker: blocker(taskId, "runtime", `Same-priority runtime blocker ${taskId}`),
    };
    blockers.push(blocker(taskId, "runtime", `Same-priority runtime blocker ${taskId}`));
  }

  return buildSnapshot({
    orchestrationId,
    tasks: order.map((taskId) => makeTask(taskId)),
    taskState,
    blockers,
  });
}

describe("regression: deterministic same-priority tie-break", () => {
  it("selects a stable winner across input permutations and repeated invocations", () => {
    const ids = ["TF-11", "TF-02", "TF-03"];
    const snapshotForward = buildSamePrioritySnapshot("deterministic-forward", ids);
    const snapshotReverse = buildSamePrioritySnapshot("deterministic-reverse", [...ids].reverse());

    const firstForward = projectRootActionableBlocker(snapshotForward);
    const secondForward = projectRootActionableBlocker(snapshotForward);
    const firstReverse = projectRootActionableBlocker(snapshotReverse);

    assert(firstForward.primaryBlocker?.taskId === "TF-02", "expected lexicographically smallest same-priority blocker TF-02 to win");
    assert(secondForward.primaryBlocker?.taskId === "TF-02", "expected repeated projection to remain stable");
    assert(firstReverse.primaryBlocker?.taskId === "TF-02", "expected winner to remain stable even when blocker order changes");
  });
});
