import { describe, it } from "node:test";
import { initSnapshot } from "./events.ts";
import type { PlanningRuntimeState, RunSnapshot } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

describe("types.schema", () => {
  it("PlanningRuntimeState exposes the durable planning runtime fields", () => {
    const planningRuntime: PlanningRuntimeState = {
      activeRole: "planner",
      startedAt: "2026-04-19T00:00:00.000Z",
      phaseStartedAt: "2026-04-19T00:01:00.000Z",
      phase: 2,
      interrupted: true,
      interruptedAt: "2026-04-19T00:02:00.000Z",
    };

    const snapshot: RunSnapshot = {
      schemaVersion: 4,
      orchestrationId: "orch-1",
      status: "planning",
      currentPhase: 2,
      phaseLabel: "Planning & Decomposition",
      resolvedModels: {},
      cost: {},
      tasks: [],
      taskState: {},
      blockers: [],
      supervisors: {},
      planningRuntime,
      timestamps: {
        started: "2026-04-19T00:00:00.000Z",
        lastUpdated: "2026-04-19T00:02:00.000Z",
      },
    };

    assert(snapshot.schemaVersion === 4, "expected RunSnapshot schemaVersion 4");
    assert(snapshot.planningRuntime?.activeRole === "planner", "expected planningRuntime to be assignable on RunSnapshot");
    assert(snapshot.planningRuntime?.phase === 2, "expected planning phase to be tracked");
    assert(snapshot.planningRuntime?.interruptedAt === "2026-04-19T00:02:00.000Z", "expected interruption timestamp to be tracked");
  });

  it("initSnapshot creates schema version 4 snapshots", () => {
    const snapshot = initSnapshot("orch-2", "./prd.md", "2026-04-19T00:00:00.000Z");

    assert(snapshot.schemaVersion === 4, "expected initSnapshot to initialize schemaVersion 4");
    assert(snapshot.planningRuntime === undefined, "expected planningRuntime to remain optional on new snapshots");
  });
});
