const nodeTestModulePath = "node:test";
const helperModulePath = "./helpers.ts";
const projectionModulePath = "../../../agent/extensions/task-forge/src/status/projection/root-actionable-blocker-selection.ts";
const renderModulePath = "../../../agent/extensions/task-forge/src/commands/status/render-root-blocker.ts";

const { describe, it } = await import(nodeTestModulePath);
const { assert, blocker, buildSnapshot, makeTask } = await import(helperModulePath);
const { projectRootActionableBlocker } = await import(projectionModulePath);
const { renderRootActionableBlockerStatus } = await import(renderModulePath);

export {};

describe("regression: direct vs dependency blocker selection", () => {
  it("prefers direct blockers over dependency-only blockers", () => {
    const snapshot = buildSnapshot({
      orchestrationId: "regression-direct-over-dependency",
      tasks: [makeTask("T10"), makeTask("T20", ["T10"])],
      taskState: {
        T10: { taskId: "T10", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T10", "runtime", "Worker crashed") },
        T20: { taskId: "T20", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T20", "dependency", "Blocked by failed dependency: T10") },
      },
      blockers: [
        blocker("T10", "runtime", "Worker crashed"),
        blocker("T20", "dependency", "Blocked by failed dependency: T10"),
      ],
    });

    const projection = projectRootActionableBlocker(snapshot);

    assert(projection.primaryBlocker?.taskId === "T10", "expected direct blocker T10 to remain primary over dependency-only blocker T20");
  });

  it("prefers dependency-chain root even when upstream task has failed state but no unresolved blocker record", () => {
    const snapshot = buildSnapshot({
      orchestrationId: "regression-root-from-failed-upstream",
      tasks: [makeTask("T5"), makeTask("T6", ["T5"]), makeTask("T7", ["T6"])],
      taskState: {
        T5: { taskId: "T5", status: "failed", retries: 0, runAttempt: 1, error: "Upstream test command failed" },
        T6: { taskId: "T6", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T6", "dependency", "Blocked by failed dependency: T5") },
        T7: { taskId: "T7", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T7", "dependency", "Blocked by failed dependency: T6") },
      },
      blockers: [
        blocker("T6", "dependency", "Blocked by failed dependency: T5"),
        blocker("T7", "dependency", "Blocked by failed dependency: T6"),
      ],
    });

    const projection = projectRootActionableBlocker(snapshot);
    const output = renderRootActionableBlockerStatus(snapshot);

    assert(projection.primaryBlocker?.taskId === "T5", "expected root-cause upstream task T5 to be selected as primary blocker");
    assert(output.includes('next: /forge blocker T5 --resolve "..." then /forge execute'), "expected next guidance to target upstream root task T5");
  });
});
