import { describe, it } from "node:test";
import { TaskForgeV2Engine } from "./engine.ts";
import type { ForgeEvent } from "./events.ts";
import type { RunSnapshot } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

it("TaskForgeV2Engine planning phase event methods append events and return updated snapshots", async () => {
  const engine = new TaskForgeV2Engine(".", ".task-forge-test");
  const appendedEvents: ForgeEvent[] = [];
  const snapshot: RunSnapshot = {
    schemaVersion: 4,
    orchestrationId: "orch-plan-rec-007",
    status: "planning",
    currentPhase: 2,
    phaseLabel: "Planning & Decomposition",
    resolvedModels: {},
    cost: {},
    tasks: [],
    taskState: {},
    blockers: [],
    supervisors: {},
    timestamps: {
      started: "2026-04-19T00:00:00.000Z",
      lastUpdated: "2026-04-19T00:00:00.000Z",
    },
  };

  engine.append = async (event: ForgeEvent) => {
    appendedEvents.push(event);
    return snapshot;
  };

  const startedSnapshot = await engine.markPlanningPhaseStarted("planner", 2, "Planning & Decomposition");
  const completedSnapshot = await engine.markPlanningPhaseCompleted("planner", 2);
  const interruptedSnapshot = await engine.markPlanningPhaseInterrupted(null, 3);

  assert(startedSnapshot === snapshot, "expected started snapshot to be returned from append");
  assert(completedSnapshot === snapshot, "expected completed snapshot to be returned from append");
  assert(interruptedSnapshot === snapshot, "expected interrupted snapshot to be returned from append");

  const [startedEvent, completedEvent, interruptedEvent] = appendedEvents;

  assert(startedEvent?.type === "planning_phase_started", "expected planning_phase_started event to be appended first");
  assert(startedEvent.role === "planner", "expected started role to match");
  assert(startedEvent.phase === 2, "expected started phase to match");
  assert(startedEvent.phaseLabel === "Planning & Decomposition", "expected started phase label to match");
  assert(typeof startedEvent.at === "string" && startedEvent.at.length > 0, "expected started event timestamp");

  assert(completedEvent?.type === "planning_phase_completed", "expected planning_phase_completed event to be appended second");
  assert(completedEvent.role === "planner", "expected completed role to match");
  assert(completedEvent.phase === 2, "expected completed phase to match");
  assert(typeof completedEvent.at === "string" && completedEvent.at.length > 0, "expected completed event timestamp");

  assert(interruptedEvent?.type === "planning_phase_interrupted", "expected planning_phase_interrupted event to be appended third");
  assert(interruptedEvent.role === null, "expected interrupted role to support null");
  assert(interruptedEvent.phase === 3, "expected interrupted phase to match");
  assert(typeof interruptedEvent.at === "string" && interruptedEvent.at.length > 0, "expected interrupted event timestamp");
});
