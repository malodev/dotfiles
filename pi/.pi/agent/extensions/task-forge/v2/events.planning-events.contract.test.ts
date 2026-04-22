import { describe, it } from "node:test";
import type { ForgeEvent } from "./events.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

describe("events.planning-events", () => {
  it("accepts planning_phase_started with at/role/phase/phaseLabel fields", () => {
    const event: ForgeEvent = {
      type: "planning_phase_started",
      at: "2026-04-19T00:00:00.000Z",
      role: "planner",
      phase: 2,
      phaseLabel: "Planning & Decomposition",
    };

    assert(event.type === "planning_phase_started", "expected planning_phase_started discriminant");
    assert(event.role === "planner", "expected role to be tracked on planning_phase_started");
    assert(event.phase === 2, "expected phase to be tracked on planning_phase_started");
    assert(event.phaseLabel === "Planning & Decomposition", "expected phaseLabel to be tracked on planning_phase_started");
  });

  it("accepts planning_phase_completed with at/role/phase fields", () => {
    const event: ForgeEvent = {
      type: "planning_phase_completed",
      at: "2026-04-19T00:05:00.000Z",
      role: "strategist",
      phase: 1,
    };

    assert(event.type === "planning_phase_completed", "expected planning_phase_completed discriminant");
    assert(event.role === "strategist", "expected role to be tracked on planning_phase_completed");
    assert(event.phase === 1, "expected phase to be tracked on planning_phase_completed");
  });

  it("accepts planning_phase_interrupted with at/role/phase fields and nullable role", () => {
    const interruptedWithRole: ForgeEvent = {
      type: "planning_phase_interrupted",
      at: "2026-04-19T00:06:00.000Z",
      role: "testDesigner",
      phase: 3,
    };

    const interruptedWithoutRole: ForgeEvent = {
      type: "planning_phase_interrupted",
      at: "2026-04-19T00:07:00.000Z",
      role: null,
      phase: 3,
    };

    assert(interruptedWithRole.type === "planning_phase_interrupted", "expected planning_phase_interrupted discriminant");
    assert(interruptedWithRole.role === "testDesigner", "expected non-null role to be accepted on planning_phase_interrupted");
    assert(interruptedWithoutRole.role === null, "expected null role to be accepted on planning_phase_interrupted");
    assert(interruptedWithoutRole.phase === 3, "expected phase to be tracked on planning_phase_interrupted");
  });

  it("supports discriminated union narrowing for planning phase events", () => {
    const events: ForgeEvent[] = [
      {
        type: "planning_phase_started",
        at: "2026-04-19T00:00:00.000Z",
        role: "scopeClassifier",
        phase: 0,
        phaseLabel: "Scope Classification",
      },
      {
        type: "planning_phase_completed",
        at: "2026-04-19T00:01:00.000Z",
        role: "scopeClassifier",
        phase: 0,
      },
      {
        type: "planning_phase_interrupted",
        at: "2026-04-19T00:02:00.000Z",
        role: null,
        phase: 1,
      },
    ];

    const summaries = events.map((event) => {
      switch (event.type) {
        case "planning_phase_started":
          return `${event.role}:${event.phaseLabel}`;
        case "planning_phase_completed":
          return `${event.role}:${event.phase}`;
        case "planning_phase_interrupted":
          return `${event.role ?? "unknown"}:${event.phase}`;
        default:
          return event.type;
      }
    });

    assert(summaries[0] === "scopeClassifier:Scope Classification", "expected started event narrowing to expose phaseLabel");
    assert(summaries[1] === "scopeClassifier:0", "expected completed event narrowing to expose role/phase");
    assert(summaries[2] === "unknown:1", "expected interrupted event narrowing to handle nullable role");
  });
});
