import { describe, it } from "node:test";
import { applyEvent, replayEvents } from "./derive.ts";
import { initSnapshot } from "./events.ts";
import type { ForgeEvent } from "./events.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

describe("derive planning phase events", () => {
  it("applyEvent initializes planningRuntime on planning_phase_started", () => {
    const snapshot = initSnapshot("orch-1", "./prd.md", "2026-04-19T00:00:00.000Z");

    const updated = applyEvent(snapshot, {
      type: "planning_phase_started",
      at: "2026-04-19T00:01:00.000Z",
      role: "planner",
      phase: 2,
      phaseLabel: "Planning & Decomposition",
    });

    assert(updated.planningRuntime !== undefined, "expected planningRuntime to be initialized");
    assert(updated.planningRuntime.activeRole === "planner", "expected activeRole to track the started planning role");
    assert(updated.planningRuntime.startedAt === "2026-04-19T00:01:00.000Z", "expected startedAt to initialize from the first planning phase start");
    assert(updated.planningRuntime.phaseStartedAt === "2026-04-19T00:01:00.000Z", "expected phaseStartedAt to track the current phase start");
    assert(updated.planningRuntime.phase === 2, "expected phase to be tracked on start");
    assert(updated.planningRuntime.interrupted === false, "expected started runtime to be non-interrupted");
    assert(updated.phaseLabel === "Planning & Decomposition", "expected phaseLabel to reflect the started planning phase");
  });

  it("applyEvent updates planningRuntime on planning_phase_completed and clears it on execution entry", () => {
    const snapshot = initSnapshot("orch-2", "./prd.md", "2026-04-19T00:00:00.000Z");
    applyEvent(snapshot, {
      type: "planning_phase_started",
      at: "2026-04-19T00:01:00.000Z",
      role: "strategist",
      phase: 1,
      phaseLabel: "PRD Analysis",
    });

    const completed = applyEvent(snapshot, {
      type: "planning_phase_completed",
      at: "2026-04-19T00:05:00.000Z",
      role: "strategist",
      phase: 1,
    });

    assert(completed.planningRuntime !== undefined, "expected planningRuntime to remain available during planning");
    assert(completed.planningRuntime.activeRole === null, "expected activeRole to clear after planning phase completion");
    assert(completed.planningRuntime.phase === 1, "expected completed phase to be tracked");
    assert(completed.planningRuntime.startedAt === "2026-04-19T00:01:00.000Z", "expected startedAt to remain stable across planning phase updates");
    assert(completed.planningRuntime.interrupted === false, "expected completed runtime to remain non-interrupted");

    const execution = applyEvent(snapshot, {
      type: "phase_entered",
      at: "2026-04-19T00:06:00.000Z",
      phase: 5,
      label: "Execution",
    });

    assert(execution.planningRuntime === undefined, "expected planningRuntime to clear once execution begins");
  });

  it("applyEvent marks planningRuntime interrupted on planning_phase_interrupted", () => {
    const snapshot = initSnapshot("orch-3", "./prd.md", "2026-04-19T00:00:00.000Z");
    applyEvent(snapshot, {
      type: "planning_phase_started",
      at: "2026-04-19T00:01:00.000Z",
      role: "testDesigner",
      phase: 3,
      phaseLabel: "Test Design",
    });

    const interrupted = applyEvent(snapshot, {
      type: "planning_phase_interrupted",
      at: "2026-04-19T00:02:00.000Z",
      role: null,
      phase: 3,
    });

    assert(interrupted.planningRuntime !== undefined, "expected planningRuntime to exist after interruption");
    assert(interrupted.planningRuntime.activeRole === null, "expected interrupted event to persist the reported role value");
    assert(interrupted.planningRuntime.phase === 3, "expected interrupted phase to be tracked");
    assert(interrupted.planningRuntime.interrupted === true, "expected interrupted flag to be set");
    assert(interrupted.planningRuntime.interruptedAt === "2026-04-19T00:02:00.000Z", "expected interruption timestamp to be recorded");
  });

  it("replayEvents reconstructs planningRuntime from started+completed events", () => {
    const events: ForgeEvent[] = [
      {
        type: "run_created",
        at: "2026-04-19T00:00:00.000Z",
        orchestrationId: "orch-reconstruct",
        prdFile: "./prd.md",
      },
      {
        type: "planning_phase_started",
        at: "2026-04-19T00:01:00.000Z",
        role: "scopeClassifier",
        phase: 0,
        phaseLabel: "Scope Classification",
      },
      {
        type: "planning_phase_completed",
        at: "2026-04-19T00:02:00.000Z",
        role: "scopeClassifier",
        phase: 0,
      },
      {
        type: "planning_phase_started",
        at: "2026-04-19T00:03:00.000Z",
        role: "strategist",
        phase: 1,
        phaseLabel: "PRD Analysis",
      },
      {
        type: "planning_phase_completed",
        at: "2026-04-19T00:05:00.000Z",
        role: "strategist",
        phase: 1,
      },
    ];

    const snapshot = replayEvents(events);

    assert(snapshot !== null, "expected replayEvents to reconstruct a snapshot");
    assert(snapshot.planningRuntime !== undefined, "expected replayed snapshot to include planningRuntime after completed phases");
    assert(snapshot.planningRuntime.startedAt === "2026-04-19T00:01:00.000Z", "expected original planning start to be preserved during replay");
    assert(snapshot.planningRuntime.phaseStartedAt === "2026-04-19T00:03:00.000Z", "expected latest phase start to be preserved during replay");
    assert(snapshot.planningRuntime.activeRole === null, "expected activeRole to be null after phase completion");
    assert(snapshot.planningRuntime.phase === 1, "expected completed phase to be tracked");
    assert(snapshot.planningRuntime.interrupted === false, "expected interrupted flag to be false after normal completion");
    assert(snapshot.planningRuntime.interruptedAt === undefined, "expected interruptedAt to be undefined after normal completion");
  });

  it("replayEvents sets interrupted flag from interruption event", () => {
    const events: ForgeEvent[] = [
      {
        type: "run_created",
        at: "2026-04-19T00:00:00.000Z",
        orchestrationId: "orch-interrupted",
        prdFile: "./prd.md",
      },
      {
        type: "planning_phase_started",
        at: "2026-04-19T00:01:00.000Z",
        role: "planner",
        phase: 2,
        phaseLabel: "Planning & Decomposition",
      },
      {
        type: "planning_phase_interrupted",
        at: "2026-04-19T00:02:00.000Z",
        role: "planner",
        phase: 2,
      },
    ];

    const snapshot = replayEvents(events);

    assert(snapshot !== null, "expected replayEvents to reconstruct a snapshot");
    assert(snapshot.planningRuntime !== undefined, "expected replayed snapshot to include planningRuntime");
    assert(snapshot.planningRuntime.interrupted === true, "expected interrupted flag to be set from interruption event");
    assert(snapshot.planningRuntime.interruptedAt === "2026-04-19T00:02:00.000Z", "expected interruptedAt to be set from interruption event");
    assert(snapshot.planningRuntime.activeRole === "planner", "expected interrupted role to be reconstructed");
    assert(snapshot.planningRuntime.phase === 2, "expected interrupted phase to be reconstructed");
  });

  it("replayEvents clears planningRuntime when phase >= 5 entered", () => {
    const events: ForgeEvent[] = [
      {
        type: "run_created",
        at: "2026-04-19T00:00:00.000Z",
        orchestrationId: "orch-execution",
        prdFile: "./prd.md",
      },
      {
        type: "planning_phase_started",
        at: "2026-04-19T00:01:00.000Z",
        role: "testDesigner",
        phase: 3,
        phaseLabel: "Test Design",
      },
      {
        type: "planning_phase_completed",
        at: "2026-04-19T00:02:00.000Z",
        role: "testDesigner",
        phase: 3,
      },
      {
        type: "phase_entered",
        at: "2026-04-19T00:03:00.000Z",
        phase: 5,
        label: "Execution",
      },
    ];

    const snapshot = replayEvents(events);

    assert(snapshot !== null, "expected replayEvents to reconstruct a snapshot");
    assert(snapshot.planningRuntime === undefined, "expected planningRuntime to be cleared when execution phase entered");
    assert(snapshot.currentPhase === 5, "expected currentPhase to be 5 (execution)");
  });

  it("replayEvents handles missing planningRuntime (legacy) correctly", () => {
    // Legacy events without any planning phase events - no planningRuntime should exist
    const events: ForgeEvent[] = [
      {
        type: "run_created",
        at: "2026-04-19T00:00:00.000Z",
        orchestrationId: "orch-legacy",
        prdFile: "./prd.md",
      },
      {
        type: "phase_entered",
        at: "2026-04-19T00:01:00.000Z",
        phase: 1,
        label: "PRD Analysis",
      },
      {
        type: "requirements_written",
        at: "2026-04-19T00:02:00.000Z",
        file: "01-requirements.md",
      },
    ];

    const snapshot = replayEvents(events);

    assert(snapshot !== null, "expected replayEvents to reconstruct a snapshot");
    assert(snapshot.planningRuntime === undefined, "expected planningRuntime to be undefined for legacy events without planning events");
    assert(snapshot.currentPhase === 1, "expected currentPhase to be tracked from phase_entered");
    assert(snapshot.requirementsFile === "01-requirements.md", "expected requirementsFile to be tracked");
  });

  it("replayEvents reconstructs planningRuntime deterministically with multiple phases and interruption", () => {
    const events: ForgeEvent[] = [
      {
        type: "run_created",
        at: "2026-04-19T00:00:00.000Z",
        orchestrationId: "orch-full",
        prdFile: "./prd.md",
      },
      {
        type: "planning_phase_started",
        at: "2026-04-19T00:01:00.000Z",
        role: "scopeClassifier",
        phase: 0,
        phaseLabel: "Scope Classification",
      },
      {
        type: "planning_phase_completed",
        at: "2026-04-19T00:02:00.000Z",
        role: "scopeClassifier",
        phase: 0,
      },
      {
        type: "planning_phase_started",
        at: "2026-04-19T00:03:00.000Z",
        role: "strategist",
        phase: 1,
        phaseLabel: "PRD Analysis",
      },
      {
        type: "planning_phase_completed",
        at: "2026-04-19T00:04:00.000Z",
        role: "strategist",
        phase: 1,
      },
      {
        type: "planning_phase_started",
        at: "2026-04-19T00:05:00.000Z",
        role: "planner",
        phase: 2,
        phaseLabel: "Planning & Decomposition",
      },
      {
        type: "planning_phase_interrupted",
        at: "2026-04-19T00:06:00.000Z",
        role: "planner",
        phase: 2,
      },
    ];

    const snapshot = replayEvents(events);

    assert(snapshot !== null, "expected replayEvents to reconstruct a snapshot");
    assert(snapshot.planningRuntime !== undefined, "expected replayed snapshot to include planningRuntime");
    assert(snapshot.planningRuntime.startedAt === "2026-04-19T00:01:00.000Z", "expected original planning start to be preserved");
    assert(snapshot.planningRuntime.phaseStartedAt === "2026-04-19T00:05:00.000Z", "expected latest phase start to be preserved");
    assert(snapshot.planningRuntime.activeRole === "planner", "expected interrupted role to be reconstructed");
    assert(snapshot.planningRuntime.phase === 2, "expected interrupted phase to be reconstructed");
    assert(snapshot.planningRuntime.interrupted === true, "expected interrupted flag to survive replay");
    assert(snapshot.planningRuntime.interruptedAt === "2026-04-19T00:06:00.000Z", "expected interruptedAt to survive replay");
  });
});
