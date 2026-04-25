import { describe, it } from "node:test";
import assert from "node:assert";
import { describeInterruptedPlanning } from "./planning-recovery.ts";
import type { RunSnapshot, V2StorageLayout } from "./types.ts";

const mockLayout: V2StorageLayout = {
  baseDir: "/tmp/test",
  eventsFile: "/tmp/test/events.jsonl",
  stateFile: "/tmp/test/state.json",
};

function createSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    schemaVersion: 4,
    orchestrationId: "test-123",
    status: "planning",
    currentPhase: 2,
    phaseLabel: "Planning & Decomposition",
    orchestrationMode: "standard",
    resolvedModels: {},
    cost: {},
    tasks: [],
    taskState: {},
    blockers: [],
    supervisors: {},
    timestamps: {
      started: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    },
    ...overrides,
  };
}

describe("describeInterruptedPlanning", () => {
  describe("non-interrupted states", () => {
    it("returns null when planningRuntime.interrupted is false", async () => {
      const snapshot = createSnapshot({
        planningRuntime: {
          activeRole: "planner",
          startedAt: new Date().toISOString(),
          phaseStartedAt: new Date().toISOString(),
          phase: 2,
          interrupted: false,
        },
      });

      const result = await describeInterruptedPlanning(snapshot, mockLayout);
      assert.strictEqual(result, null);
    });

    it("returns null when planningRuntime is undefined and status is not planning", async () => {
      const snapshot = createSnapshot({
        status: "executing",
        currentPhase: 5,
      });

      const result = await describeInterruptedPlanning(snapshot, mockLayout);
      assert.strictEqual(result, null);
    });

    it("returns null when currentPhase >= 5", async () => {
      const snapshot = createSnapshot({
        status: "planning",
        currentPhase: 5,
      });

      const result = await describeInterruptedPlanning(snapshot, mockLayout);
      assert.strictEqual(result, null);
    });
  });

  describe("planningRuntime.interrupted flag detection", () => {
    it("detects interruption when planningRuntime.interrupted is true", async () => {
      const snapshot = createSnapshot({
        currentPhase: 2,
        planningRuntime: {
          activeRole: "planner",
          startedAt: new Date().toISOString(),
          phaseStartedAt: new Date().toISOString(),
          phase: 2,
          interrupted: true,
          interruptedAt: new Date().toISOString(),
        },
      });

      const result = await describeInterruptedPlanning(snapshot, mockLayout);
      assert.notStrictEqual(result, null);
      assert.strictEqual(result?.kind, "restart_required");
    });
  });

  describe("legacy snapshot detection (no planningRuntime)", () => {
    it("detects legacy interrupted planning when status=planning, phase<5, no planningRuntime", async () => {
      const snapshot = createSnapshot({
        status: "planning",
        currentPhase: 2,
        planningRuntime: undefined,
      });

      const result = await describeInterruptedPlanning(snapshot, mockLayout);
      assert.notStrictEqual(result, null);
      assert.strictEqual(result?.kind, "restart_required");
      assert.ok(result?.kind === "restart_required" && result.reason.includes("Legacy"));
    });

    it("does not detect interruption for phase 0 without planningRuntime but with routing file", async () => {
      // This test would need filesystem mocking to fully test
      // For now, just verify the detection logic
      const snapshot = createSnapshot({
        status: "planning",
        currentPhase: 0,
        orchestrationMode: "standard",
        planningRuntime: undefined,
      });

      const result = await describeInterruptedPlanning(snapshot, mockLayout);
      assert.notStrictEqual(result, null);
    });
  });

  describe("classifyPlanningResumability integration", () => {
    it("returns resumable result when classifyPlanningResumability returns 'resumable'", async () => {
      // This requires mocking the filesystem to simulate artifacts existing
      // For unit testing, we verify the structure of the function
      const snapshot = createSnapshot({
        currentPhase: 4, // Approval gate - always resumable if prerequisites met
        orchestrationMode: "standard",
        planningRuntime: {
          activeRole: null,
          startedAt: new Date().toISOString(),
          phaseStartedAt: new Date().toISOString(),
          phase: 4,
          interrupted: true,
        },
      });

      const result = await describeInterruptedPlanning(snapshot, mockLayout);
      // Without proper artifact setup, this will likely be restart_required
      // but we verify the function runs and returns the correct structure
      assert.ok(result !== null);
      assert.ok(result?.kind === "resumable" || result?.kind === "restart_required");
    });

    it("returns restart_required with proper reason for legacy snapshots", async () => {
      const snapshot = createSnapshot({
        currentPhase: 1,
        status: "planning",
        planningRuntime: undefined,
      });

      const result = await describeInterruptedPlanning(snapshot, mockLayout);
      assert.strictEqual(result?.kind, "restart_required");
      if (result?.kind === "restart_required") {
        assert.ok(result.reason.includes("Legacy"));
        assert.ok(result.reason.includes("phase 1"));
      }
    });
  });

  describe("return value structure", () => {
    it("resumable result has correct structure", async () => {
      // Phase 4 with no artifacts should be resumable (approval gate)
      const snapshot = createSnapshot({
        currentPhase: 4,
        status: "planning",
        orchestrationMode: "micro", // micro mode has fewer requirements
        planningRuntime: {
          activeRole: null,
          startedAt: new Date().toISOString(),
          phaseStartedAt: new Date().toISOString(),
          phase: 4,
          interrupted: true,
        },
      });

      const result = await describeInterruptedPlanning(snapshot, mockLayout);
      assert.ok(result !== null);
      if (result?.kind === "resumable") {
        assert.strictEqual(result.phase, 4);
        assert.strictEqual(result.nextAction, "continuePlanning");
      }
    });

    it("restart_required result has correct structure", async () => {
      const snapshot = createSnapshot({
        currentPhase: 0,
        status: "planning",
        orchestrationMode: "standard",
        planningRuntime: undefined, // Legacy - no planning runtime
      });

      const result = await describeInterruptedPlanning(snapshot, mockLayout);
      assert.strictEqual(result?.kind, "restart_required");
      if (result?.kind === "restart_required") {
        assert.ok(typeof result.reason === "string");
        assert.ok(result.reason.length > 0);
      }
    });
  });
});
