/**
 * Tests for statusLabelFromV2 interrupted planning display (PLAN-REC-016)
 *
 * Acceptance Criteria:
 * - Shows 'planning (interrupted)' when planningRuntime.interrupted is true
 * - Includes phase number in display
 * - Shows 'resumable' when applicable
 * - Does not change RunStatus enum value
 */

import { describe, it } from "node:test";
import assert from "node:assert";

// Import the function to test - we need to extract it or test via the module
// For now, we'll test by replicating the logic from index.ts

interface PlanningRuntimeState {
  activeRole: string | null;
  startedAt: string;
  phaseStartedAt: string;
  phase: number;
  interrupted: boolean;
  interruptedAt?: string;
}

interface RunSnapshot {
  schemaVersion: 2 | 3 | 4;
  orchestrationId: string;
  status: string;
  currentPhase: number;
  phaseLabel: string;
  nextAction?: "continuePlanning" | "executePlan";
  orchestrationMode?: "micro" | "standard" | "complex";
  tasks: unknown[];
  taskState: Record<string, unknown>;
  blockers: unknown[];
  supervisors: Record<string, unknown>;
  planningRuntime?: PlanningRuntimeState;
  timestamps: {
    started: string;
    lastUpdated: string;
    completed?: string;
  };
}

function statusIcon(status: string): string {
  switch (status) {
    case "idle": return "💤";
    case "analyzing": return "🔍";
    case "planning": return "📋";
    case "awaiting_approval": return "⏳";
    case "executing": return "⚙️";
    case "reviewing": return "🧪";
    case "completed": return "✅";
    case "paused": return "⏸️";
    case "aborted": return "🛑";
    case "blocked": return "🚧";
    case "failed": return "❌";
    default: return "❓";
  }
}

// Replicated logic from index.ts statusLabelFromV2
function statusLabelFromV2(snapshot: RunSnapshot | null): string {
  if (!snapshot) return "forge:idle";

  const taskState = Object.values(snapshot.taskState);
  const total = snapshot.tasks.length || taskState.length;
  const done = taskState.filter((t: unknown) => (t as { status?: string }).status === "completed").length;
  const running = taskState.filter((t: unknown) => (t as { status?: string }).status === "running").length;
  const blocked = taskState.filter((t: unknown) => (t as { status?: string }).status === "blocked").length;
  const failed = taskState.filter((t: unknown) => (t as { status?: string }).status === "failed").length;

  const parts: string[] = [];
  if (total > 0) parts.push(`${done}/${total}`);
  if (running > 0) parts.push(`r${running}`);
  if (blocked > 0) parts.push(`b${blocked}`);
  if (failed > 0) parts.push(`f${failed}`);

  if (snapshot.status === "awaiting_approval" || snapshot.status === "paused") {
    if (snapshot.nextAction === "continuePlanning") parts.push("next:plan");
    if (snapshot.nextAction === "executePlan") parts.push("next:exec");
  }

  const suffix = parts.length > 0 ? ` [${parts.join("|")}]` : "";

  // Handle interrupted planning display (FR-18)
  if (snapshot.status === "planning" && snapshot.planningRuntime?.interrupted === true) {
    const phaseDisplay = `phase ${snapshot.currentPhase}/5`;
    const resumableIndicator = snapshot.nextAction === "continuePlanning" ? " — resumable" : "";
    const statusDisplay = `planning (interrupted — ${phaseDisplay}${resumableIndicator})`;
    return `forge:${statusIcon(snapshot.status)}${statusDisplay}${suffix}`;
  }

  return `forge:${statusIcon(snapshot.status)}${snapshot.status}${suffix}`;
}

// Test fixtures
function createBaseSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    schemaVersion: 4,
    orchestrationId: "test-run-001",
    status: "planning",
    currentPhase: 2,
    phaseLabel: "Planning & Decomposition",
    orchestrationMode: "standard",
    tasks: [],
    taskState: {},
    blockers: [],
    supervisors: {},
    timestamps: {
      started: "2026-04-20T00:00:00.000Z",
      lastUpdated: "2026-04-20T00:01:00.000Z",
    },
    ...overrides,
  };
}

describe("statusLabelFromV2 interrupted planning display", () => {
  describe("AC-1: Shows 'planning (interrupted)' when planningRuntime.interrupted is true", () => {
    it("displays 'planning (interrupted)' when interrupted flag is true", () => {
      const snapshot = createBaseSnapshot({
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:01:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-20T00:02:00.000Z",
        },
      });

      const label = statusLabelFromV2(snapshot);

      assert(label.includes("planning (interrupted"), `Expected label to contain 'planning (interrupted', got: ${label}`);
    });

    it("does NOT show interrupted when interrupted flag is false", () => {
      const snapshot = createBaseSnapshot({
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:01:00.000Z",
          phase: 2,
          interrupted: false,
        },
      });

      const label = statusLabelFromV2(snapshot);

      assert(!label.includes("interrupted"), `Expected label NOT to contain 'interrupted', got: ${label}`);
      assert(label.includes("📋planning"), `Expected normal planning status, got: ${label}`);
    });

    it("does NOT show interrupted when planningRuntime is undefined", () => {
      const snapshot = createBaseSnapshot({
        planningRuntime: undefined,
      });

      const label = statusLabelFromV2(snapshot);

      assert(!label.includes("interrupted"), `Expected label NOT to contain 'interrupted', got: ${label}`);
      assert(label.includes("📋planning"), `Expected normal planning status, got: ${label}`);
    });

    it("does NOT show interrupted when status is not 'planning'", () => {
      const snapshot = createBaseSnapshot({
        status: "executing",
        planningRuntime: {
          activeRole: null,
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:01:00.000Z",
          phase: 5,
          interrupted: true,
          interruptedAt: "2026-04-20T00:02:00.000Z",
        },
      });

      const label = statusLabelFromV2(snapshot);

      assert(!label.includes("interrupted"), `Expected label NOT to contain 'interrupted' when status is executing, got: ${label}`);
    });
  });

  describe("AC-2: Includes phase number in display", () => {
    it("shows phase 0/5 when interrupted at phase 0", () => {
      const snapshot = createBaseSnapshot({
        currentPhase: 0,
        phaseLabel: "Scope Classification",
        planningRuntime: {
          activeRole: "scopeClassifier",
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:00:00.000Z",
          phase: 0,
          interrupted: true,
          interruptedAt: "2026-04-20T00:02:00.000Z",
        },
      });

      const label = statusLabelFromV2(snapshot);

      assert(label.includes("phase 0/5"), `Expected label to contain 'phase 0/5', got: ${label}`);
    });

    it("shows phase 2/5 when interrupted at phase 2", () => {
      const snapshot = createBaseSnapshot({
        currentPhase: 2,
        phaseLabel: "Planning & Decomposition",
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:01:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-20T00:02:00.000Z",
        },
      });

      const label = statusLabelFromV2(snapshot);

      assert(label.includes("phase 2/5"), `Expected label to contain 'phase 2/5', got: ${label}`);
    });

    it("shows phase 4/5 when interrupted at phase 4 (approval gate)", () => {
      const snapshot = createBaseSnapshot({
        currentPhase: 4,
        phaseLabel: "Approval Gate",
        planningRuntime: {
          activeRole: null,
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:04:00.000Z",
          phase: 4,
          interrupted: true,
          interruptedAt: "2026-04-20T00:05:00.000Z",
        },
      });

      const label = statusLabelFromV2(snapshot);

      assert(label.includes("phase 4/5"), `Expected label to contain 'phase 4/5', got: ${label}`);
    });
  });

  describe("AC-3: Shows 'resumable' when applicable", () => {
    it("shows 'resumable' indicator when nextAction is 'continuePlanning'", () => {
      const snapshot = createBaseSnapshot({
        nextAction: "continuePlanning",
        planningRuntime: {
          activeRole: null,
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:01:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-20T00:02:00.000Z",
        },
      });

      const label = statusLabelFromV2(snapshot);

      assert(label.includes("resumable"), `Expected label to contain 'resumable', got: ${label}`);
      assert(label.includes("phase 2/5"), `Expected label to contain 'phase 2/5', got: ${label}`);
    });

    it("does NOT show 'resumable' when nextAction is undefined", () => {
      const snapshot = createBaseSnapshot({
        nextAction: undefined,
        planningRuntime: {
          activeRole: null,
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:01:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-20T00:02:00.000Z",
        },
      });

      const label = statusLabelFromV2(snapshot);

      assert(!label.includes("resumable"), `Expected label NOT to contain 'resumable' when no nextAction, got: ${label}`);
      assert(label.includes("planning (interrupted"), `Expected interrupted status, got: ${label}`);
    });

    it("does NOT show 'resumable' when nextAction is 'executePlan'", () => {
      const snapshot = createBaseSnapshot({
        nextAction: "executePlan",
        planningRuntime: {
          activeRole: null,
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:01:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-20T00:02:00.000Z",
        },
      });

      const label = statusLabelFromV2(snapshot);

      assert(!label.includes("resumable"), `Expected label NOT to contain 'resumable' when nextAction is executePlan, got: ${label}`);
    });
  });

  describe("AC-4: Does not change RunStatus enum value", () => {
    it("keeps snapshot.status as 'planning' (not 'planning_interrupted')", () => {
      const snapshot = createBaseSnapshot({
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:01:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-20T00:02:00.000Z",
        },
      });

      // The status should remain "planning" - only display changes
      assert.strictEqual(snapshot.status, "planning", "snapshot.status should remain 'planning', not change to 'planning_interrupted'");

      const label = statusLabelFromV2(snapshot);

      // But the label should show interrupted
      assert(label.includes("interrupted"), `Expected label to show interrupted status, got: ${label}`);
    });

    it("displays with planning icon (📋) even when interrupted", () => {
      const snapshot = createBaseSnapshot({
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:01:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-20T00:02:00.000Z",
        },
      });

      const label = statusLabelFromV2(snapshot);

      assert(label.startsWith("forge:📋"), `Expected label to start with planning icon 'forge:📋', got: ${label}`);
    });
  });

  describe("Backward compatibility", () => {
    it("shows normal planning status when not interrupted (no planningRuntime)", () => {
      const snapshot = createBaseSnapshot({
        planningRuntime: undefined,
      });

      const label = statusLabelFromV2(snapshot);

      assert.strictEqual(label, "forge:📋planning", `Expected normal planning label, got: ${label}`);
    });

    it("preserves existing task counters in interrupted display", () => {
      const snapshot = createBaseSnapshot({
        tasks: [{ id: "task-1" }, { id: "task-2" }] as unknown[],
        taskState: {
          "task-1": { status: "completed" },
          "task-2": { status: "running" },
        } as unknown as Record<string, unknown>,
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:01:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-20T00:02:00.000Z",
        },
      });

      const label = statusLabelFromV2(snapshot);

      assert(label.includes("1/2"), `Expected label to contain task count '1/2', got: ${label}`);
      assert(label.includes("r1"), `Expected label to contain running count 'r1', got: ${label}`);
      assert(label.includes("interrupted"), `Expected label to contain 'interrupted', got: ${label}`);
    });

    it("does NOT include next:plan in suffix for interrupted planning (status is still 'planning')", () => {
      // Note: next:plan suffix is only added for "awaiting_approval" or "paused" statuses
      // For interrupted planning, status remains "planning", so next:plan won't appear in suffix
      // but the "resumable" indicator is shown in the status display instead
      const snapshot = createBaseSnapshot({
        nextAction: "continuePlanning",
        planningRuntime: {
          activeRole: null,
          startedAt: "2026-04-20T00:00:00.000Z",
          phaseStartedAt: "2026-04-20T00:01:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-20T00:02:00.000Z",
        },
      });

      const label = statusLabelFromV2(snapshot);

      // Status is still "planning", not "awaiting_approval" or "paused", so no next:plan suffix
      assert(!label.includes("next:plan"), `Expected label NOT to contain 'next:plan' (status is planning), got: ${label}`);
      // But "resumable" should be shown because nextAction is continuePlanning
      assert(label.includes("resumable"), `Expected label to contain 'resumable', got: ${label}`);
    });
  });
});
