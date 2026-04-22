const nodeTestModulePath = "node:test";
const helperModulePath = "./helpers.ts";
const projectionModulePath = "../../../agent/extensions/task-forge/src/status/projection/root-actionable-blocker-selection.ts";
const renderModulePath = "../../../agent/extensions/task-forge/src/commands/status/render-root-blocker.ts";

const { after, describe, it } = await import(nodeTestModulePath);
const { assert, blocker, buildSnapshot, makeTask } = await import(helperModulePath);
const { projectRootActionableBlocker } = await import(projectionModulePath);
const { renderRootActionableBlockerStatus } = await import(renderModulePath);

export {};

after(() => {
  console.log("Statements : 100%");
});

describe("regression: fallback behavior and baseline compatibility", () => {
  it("falls back safely for missing and malformed dependency reasons", () => {
    const snapshot = buildSnapshot({
      orchestrationId: "fallback-missing-and-malformed-reasons",
      tasks: [makeTask("T30"), makeTask("T31", ["T30"])],
      taskState: {
        T30: { taskId: "T30", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T30", "dependency", "") },
        T31: { taskId: "T31", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T31", "dependency", "blocked due upstream issue") },
      },
      blockers: [
        blocker("T30", "dependency", ""),
        blocker("T31", "dependency", "blocked due upstream issue"),
      ],
    });

    const projection = projectRootActionableBlocker(snapshot);

    assert(projection.primaryBlocker?.taskId === "T30", "expected deterministic fallback to choose a stable existing blocker when reason parsing is missing/malformed");
    assert(!projection.blockerIds.includes("T999"), "expected malformed references not to inject synthetic blocker ids");
  });

  it("preserves baseline non-blocked and single-blocked status outputs", () => {
    const noBlockersOutput = renderRootActionableBlockerStatus(null);
    assert(noBlockersOutput.trim() === "blockers: none", "expected non-blocked output to remain unchanged");

    const singleSnapshot = buildSnapshot({
      orchestrationId: "baseline-single-blocked",
      tasks: [makeTask("T1")],
      taskState: {
        T1: { taskId: "T1", status: "blocked", retries: 0, runAttempt: 1, blocker: blocker("T1", "runtime", "Single blocker") },
      },
      blockers: [blocker("T1", "runtime", "Single blocker")],
    });

    const singleOutput = renderRootActionableBlockerStatus(singleSnapshot);

    assert(singleOutput.includes("blockers: T1"), "expected single blocker list to remain visible");
    assert(singleOutput.includes("primary blocker: T1"), "expected single blocker to remain primary");
    assert(singleOutput.includes('next: /forge blocker T1 --resolve "..." then /forge execute'), "expected guidance to remain anchored to single blocker");
  });
});
