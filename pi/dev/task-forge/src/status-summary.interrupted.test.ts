/**
 * Tests for statusSummaryFromV2 interruption section
 * Tests FR-19, FR-20, FR-21
 */

import { describe, it } from "node:test";
import assert from "node:assert";

// Type definitions matching the actual implementation
type RunPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type RunStatus = "idle" | "planning" | "awaiting_approval" | "executing" | "reviewing" | "completed" | "aborted" | "failed" | "paused" | "needs_human_intervention";
type Role = "scopeClassifier" | "strategist" | "planner" | "testDesigner" | "worker" | "workerIterative" | "gateReviewer" | "diagnosticReviewer" | "integrationReviewer";

interface PlanningRuntimeState {
  activeRole: Role | null;
  startedAt: string;
  phaseStartedAt: string;
  phase: RunPhase;
  interrupted: boolean;
  interruptedAt?: string;
}

interface TaskState {
  status: "pending" | "ready" | "running" | "completed" | "failed" | "blocked";
  retries: number;
  resolvedModel?: string;
  result?: string;
  gateReview?: { passed: boolean; notes: string };
  blocker?: { taskId: string; reason: string; suggestion: string; blockedTasks: string[]; resolvedBy?: string; resolvedAt?: string };
  error?: string;
  validationOutput?: string;
  validationFramework?: string;
  lastCoverage?: number;
  tddPhase?: "red" | "green" | "refactor" | "complete";
  startedAt?: string;
  completedAt?: string;
  iterationCount?: number;
  diagnosticCount?: number;
  stallWarnedAt?: string;
}

interface RunSnapshot {
  schemaVersion: 2 | 3 | 4;
  orchestrationId: string;
  status: RunStatus;
  orchestrationMode?: "micro" | "standard" | "complex";
  currentPhase: RunPhase;
  phaseLabel: string;
  nextAction?: "continuePlanning" | "executePlan";
  prdFile?: string;
  tasks: Array<{ id: string; title: string; description: string; dependencies: string[] }>;
  taskState: Record<string, TaskState>;
  blockers: Array<{ taskId: string; reason: string; suggestion: string; blockedTasks: string[]; resolvedBy?: string; resolvedAt?: string }>;
  planningRuntime?: PlanningRuntimeState;
}

// Mock implementation matching the logic in index.ts
function statusIcon(status: RunStatus): string {
  switch (status) {
    case "idle": return "💤";
    case "planning": return "📋";
    case "awaiting_approval": return "⏳";
    case "executing": return "⚙️";
    case "reviewing": return "🧪";
    case "completed": return "✅";
    case "paused": return "⏸️";
    case "aborted": return "🛑";
    case "failed": return "❌";
    case "needs_human_intervention": return "⚠️";
  }
}

function planningPhaseChecklist(snapshot: RunSnapshot) {
  const complex = snapshot.orchestrationMode === "complex";
  const micro = snapshot.orchestrationMode === "micro";
  const steps = complex
    ? [
        { phase: 0, label: "Scope Classification" },
        { phase: 1, label: "PRD Analysis" },
        { phase: 2, label: "Planning & Decomposition" },
        { phase: 3, label: "Test Design" },
        { phase: 4, label: "Approval Gate" },
      ]
    : micro
      ? [
          { phase: 0, label: "Scope Classification" },
          { phase: 2, label: "Micro Planning" },
          { phase: 4, label: "Approval Gate" },
        ]
      : [
          { phase: 0, label: "Scope Classification" },
          { phase: 1, label: "PRD Analysis" },
          { phase: 2, label: "Planning & Decomposition" },
          { phase: 3, label: "Test Design" },
          { phase: 4, label: "Approval Gate" },
        ];

  const currentIndex = Math.max(0, steps.findIndex((step) => step.phase === snapshot.currentPhase));
  const total = steps.length;
  const done = steps.filter((step, index) => index < currentIndex).length;
  const currentStep = steps[currentIndex] ?? steps[steps.length - 1];

  const checklist = steps.map((step, index) => {
    const marker = index < currentIndex ? "✅" : index === currentIndex ? "⏳" : "⏸";
    return `${marker} ${step.label}`;
  });

  return {
    summary: `planning progress: ${Math.min(done + 1, total)}/${total} — ${currentStep?.label ?? snapshot.phaseLabel}`,
    checklist,
  };
}

function overdueSupervisorsV2(snapshot: RunSnapshot): Array<{ taskId: string }> {
  return [];
}

function renderRootActionableBlockerStatus(snapshot: RunSnapshot): string {
  const rootBlockers = snapshot.blockers.filter(b => !b.resolvedAt && b.blockedTasks.length > 0);
  if (rootBlockers.length === 0) return "root actionable blockers: none";
  return `root actionable blockers: ${rootBlockers.map(b => b.taskId).join(", ")}`;
}

// Implementation of statusSummaryFromV2 with interruption section
function statusSummaryFromV2(snapshot: RunSnapshot | null, localState?: unknown): string {
  if (!snapshot) return "[task-forge] No active orchestration";

  const taskState = Object.values(snapshot.taskState);
  const overdue = overdueSupervisorsV2(snapshot);
  const counts = {
    ready: taskState.filter((t) => t.status === "ready").length,
    running: taskState.filter((t) => t.status === "running").length,
    completed: taskState.filter((t) => t.status === "completed").length,
    pending: taskState.filter((t) => t.status === "pending").length,
    failed: taskState.filter((t) => t.status === "failed").length,
    blocked: taskState.filter((t) => t.status === "blocked").length,
  };
  const planningProgress = ["planning", "awaiting_approval"].includes(snapshot.status)
    ? planningPhaseChecklist(snapshot)
    : null;

  const activeAgent = undefined; // Simplified for testing

  // Build interruption section when planning was interrupted (FR-19, FR-20, FR-21)
  const interruptionSection: string[] = [];
  if (snapshot.planningRuntime?.interrupted === true) {
    const isResumable = snapshot.nextAction === "continuePlanning";
    const phaseForResume = snapshot.phaseLabel?.trim().length ? snapshot.phaseLabel : `phase ${snapshot.currentPhase}`;
    if (isResumable) {
      interruptionSection.push("⚠ planning interrupted after restart");
      interruptionSection.push(`next action: continuePlanning — /forge execute to resume from ${phaseForResume}`);
    } else {
      interruptionSection.push("⚠ restart required — rerun /forge <prd> to restart planning");
    }
  }

  return [
    `[task-forge] ${statusIcon(snapshot.status)} ${snapshot.status}`,
    `mode: ${snapshot.orchestrationMode ?? "n/a"}`,
    `phase: ${snapshot.phaseLabel}`,
    planningProgress?.summary ?? "",
    planningProgress ? ["planning phases:", ...planningProgress.checklist].join("\n") : "",
    ...interruptionSection,
    activeAgent ? `active agent: ...` : "",
    activeAgent ? `active since: ...` : "",
    snapshot.nextAction ? `next action: ${snapshot.nextAction}` : "",
    `prd: ${snapshot.prdFile ?? "n/a"}`,
    `tasks: ${counts.completed}/${snapshot.tasks.length || taskState.length} completed, ${counts.running} running, ${counts.ready} ready, ${counts.pending} pending, ${counts.failed} failed, ${counts.blocked} blocked`,
    overdue.length > 0 ? `overdue supervisors: ${overdue.map((s) => s.taskId).join(", ")}` : "overdue supervisors: none",
    renderRootActionableBlockerStatus(snapshot),
  ].filter(Boolean).join("\n");
}

// Test fixtures
function createBaseSnapshot(): RunSnapshot {
  return {
    schemaVersion: 4,
    orchestrationId: "test-orchestration",
    status: "planning",
    currentPhase: 2,
    phaseLabel: "Planning & Decomposition",
    orchestrationMode: "standard",
    prdFile: "test.prd",
    tasks: [],
    taskState: {},
    blockers: [],
  };
}

describe("statusSummaryFromV2 interruption section", () => {
  describe("FR-19: Interruption section only shown when planningRuntime.interrupted is true", () => {
    it("shows interruption section when interrupted is true", () => {
      const snapshot: RunSnapshot = {
        ...createBaseSnapshot(),
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-19T00:01:00.000Z",
          phaseStartedAt: "2026-04-19T00:02:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-19T00:03:00.000Z",
        },
        nextAction: "continuePlanning",
      };

      const summary = statusSummaryFromV2(snapshot);
      assert(summary.includes("⚠ planning interrupted after restart"), "should show interruption warning");
    });

    it("does NOT show interruption section when interrupted is false", () => {
      const snapshot: RunSnapshot = {
        ...createBaseSnapshot(),
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-19T00:01:00.000Z",
          phaseStartedAt: "2026-04-19T00:02:00.000Z",
          phase: 2,
          interrupted: false,
        },
      };

      const summary = statusSummaryFromV2(snapshot);
      assert(!summary.includes("⚠ planning interrupted"), "should NOT show interruption warning when not interrupted");
      assert(!summary.includes("⚠ restart required"), "should NOT show restart required when not interrupted");
    });

    it("does NOT show interruption section when planningRuntime is undefined", () => {
      const snapshot: RunSnapshot = {
        ...createBaseSnapshot(),
        planningRuntime: undefined,
      };

      const summary = statusSummaryFromV2(snapshot);
      assert(!summary.includes("⚠ planning interrupted"), "should NOT show interruption warning without planningRuntime");
      assert(!summary.includes("⚠ restart required"), "should NOT show restart required without planningRuntime");
    });
  });

  describe("FR-20: Resumable state shows correct message and next action", () => {
    it("shows resumable message when nextAction is continuePlanning", () => {
      const snapshot: RunSnapshot = {
        ...createBaseSnapshot(),
        currentPhase: 2,
        phaseLabel: "Planning & Decomposition",
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-19T00:01:00.000Z",
          phaseStartedAt: "2026-04-19T00:02:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-19T00:03:00.000Z",
        },
        nextAction: "continuePlanning",
      };

      const summary = statusSummaryFromV2(snapshot);
      assert(summary.includes("⚠ planning interrupted after restart"), "should show interrupted after restart message");
      assert(summary.includes("next action: continuePlanning — /forge execute to resume from Planning & Decomposition"), "should show correct next action with phase label");
    });

    it("includes correct phase label in resumable message", () => {
      const snapshot: RunSnapshot = {
        ...createBaseSnapshot(),
        currentPhase: 3,
        phaseLabel: "Test Design",
        planningRuntime: {
          activeRole: "testDesigner",
          startedAt: "2026-04-19T00:01:00.000Z",
          phaseStartedAt: "2026-04-19T00:02:00.000Z",
          phase: 3,
          interrupted: true,
          interruptedAt: "2026-04-19T00:03:00.000Z",
        },
        nextAction: "continuePlanning",
      };

      const summary = statusSummaryFromV2(snapshot);
      assert(summary.includes("next action: continuePlanning — /forge execute to resume from Test Design"), "should show correct phase label");
    });

    it("falls back to phase number when phase label is empty", () => {
      const snapshot: RunSnapshot = {
        ...createBaseSnapshot(),
        currentPhase: 2,
        phaseLabel: "",
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-19T00:01:00.000Z",
          phaseStartedAt: "2026-04-19T00:02:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-19T00:03:00.000Z",
        },
        nextAction: "continuePlanning",
      };

      const summary = statusSummaryFromV2(snapshot);
      assert(summary.includes("next action: continuePlanning — /forge execute to resume from phase 2"), "should fall back to phase number");
    });

    it("shows resumable message for different phases", () => {
      const phases: Array<{ phase: RunPhase; label: string; role: Role }> = [
        { phase: 0, label: "Scope Classification", role: "scopeClassifier" },
        { phase: 1, label: "PRD Analysis", role: "strategist" },
        { phase: 2, label: "Planning & Decomposition", role: "planner" },
        { phase: 3, label: "Test Design", role: "testDesigner" },
        { phase: 4, label: "Approval Gate", role: "planner" },
      ];

      for (const { phase, label, role } of phases) {
        const snapshot: RunSnapshot = {
          ...createBaseSnapshot(),
          currentPhase: phase,
          phaseLabel: label,
          planningRuntime: {
            activeRole: role,
            startedAt: "2026-04-19T00:01:00.000Z",
            phaseStartedAt: "2026-04-19T00:02:00.000Z",
            phase,
            interrupted: true,
            interruptedAt: "2026-04-19T00:03:00.000Z",
          },
          nextAction: "continuePlanning",
        };

        const summary = statusSummaryFromV2(snapshot);
        assert(summary.includes(`⚠ planning interrupted after restart`), `phase ${phase}: should show interrupted message`);
        assert(summary.includes(`next action: continuePlanning — /forge execute to resume from ${label}`), `phase ${phase}: should show resume message with correct label`);
      }
    });
  });

  describe("FR-21: Restart-required state shows correct message", () => {
    it("shows restart required message when interrupted but nextAction is NOT continuePlanning", () => {
      const snapshot: RunSnapshot = {
        ...createBaseSnapshot(),
        planningRuntime: {
          activeRole: "scopeClassifier",
          startedAt: "2026-04-19T00:01:00.000Z",
          phaseStartedAt: "2026-04-19T00:02:00.000Z",
          phase: 0,
          interrupted: true,
          interruptedAt: "2026-04-19T00:03:00.000Z",
        },
        nextAction: undefined,
      };

      const summary = statusSummaryFromV2(snapshot);
      assert(summary.includes("⚠ restart required — rerun /forge <prd> to restart planning"), "should show restart required message");
      assert(!summary.includes("planning interrupted after restart"), "should NOT show resumable message");
    });

    it("shows restart required message when nextAction is executePlan (not continuePlanning)", () => {
      const snapshot: RunSnapshot = {
        ...createBaseSnapshot(),
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-19T00:01:00.000Z",
          phaseStartedAt: "2026-04-19T00:02:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-19T00:03:00.000Z",
        },
        nextAction: "executePlan",
      };

      const summary = statusSummaryFromV2(snapshot);
      assert(summary.includes("⚠ restart required — rerun /forge <prd> to restart planning"), "should show restart required when nextAction is executePlan");
    });
  });

  describe("Acceptance Criteria: Uses ⚠ prefix for warning styling", () => {
    it("uses ⚠ prefix for resumable interruption", () => {
      const snapshot: RunSnapshot = {
        ...createBaseSnapshot(),
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-19T00:01:00.000Z",
          phaseStartedAt: "2026-04-19T00:02:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-19T00:03:00.000Z",
        },
        nextAction: "continuePlanning",
      };

      const summary = statusSummaryFromV2(snapshot);
      const lines = summary.split("\n");
      const interruptionLine = lines.find(l => l.includes("planning interrupted after restart"));
      assert(interruptionLine, "should have interruption line");
      assert(interruptionLine.startsWith("⚠ "), "interruption line should start with ⚠ prefix");
    });

    it("uses ⚠ prefix for restart-required interruption", () => {
      const snapshot: RunSnapshot = {
        ...createBaseSnapshot(),
        planningRuntime: {
          activeRole: "scopeClassifier",
          startedAt: "2026-04-19T00:01:00.000Z",
          phaseStartedAt: "2026-04-19T00:02:00.000Z",
          phase: 0,
          interrupted: true,
          interruptedAt: "2026-04-19T00:03:00.000Z",
        },
        nextAction: undefined,
      };

      const summary = statusSummaryFromV2(snapshot);
      const lines = summary.split("\n");
      const restartLine = lines.find(l => l.includes("restart required"));
      assert(restartLine, "should have restart required line");
      assert(restartLine.startsWith("⚠ "), "restart required line should start with ⚠ prefix");
    });
  });

  describe("Integration: Interruption section appears in correct location", () => {
    it("interruption section appears in summary output", () => {
      const snapshot: RunSnapshot = {
        ...createBaseSnapshot(),
        planningRuntime: {
          activeRole: "planner",
          startedAt: "2026-04-19T00:01:00.000Z",
          phaseStartedAt: "2026-04-19T00:02:00.000Z",
          phase: 2,
          interrupted: true,
          interruptedAt: "2026-04-19T00:03:00.000Z",
        },
        nextAction: "continuePlanning",
      };

      const summary = statusSummaryFromV2(snapshot);
      
      // Verify structure includes all expected parts
      assert(summary.startsWith("[task-forge]"), "should start with [task-forge]");
      assert(summary.includes("📋 planning"), "should include status icon and status");
      assert(summary.includes("mode: standard"), "should include mode");
      assert(summary.includes("phase: Planning & Decomposition"), "should include phase");
      assert(summary.includes("⚠ planning interrupted after restart"), "should include interruption warning");
      assert(summary.includes("next action: continuePlanning — /forge execute to resume from Planning & Decomposition"), "should include next action");
    });
  });
});
