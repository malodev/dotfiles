import type { Blocker, ForgeTask, NextAction, RunPhase, RunSnapshot, TaskRuntimeState, TestSpecEntry, TddPhase } from "./types.ts";

export type ForgeEvent =
  | { type: "run_created"; at: string; orchestrationId: string; prdFile: string }
  | { type: "run_restored"; at: string; orchestrationId: string; reason: string }
  | { type: "phase_entered"; at: string; phase: RunPhase; label: string }
  | { type: "planning_phase_started"; at: string; role: import("./types.ts").Role; phase: RunPhase; phaseLabel: string }
  | { type: "planning_phase_completed"; at: string; role: import("./types.ts").Role; phase: RunPhase }
  | { type: "planning_phase_interrupted"; at: string; role: import("./types.ts").Role | null; phase: RunPhase }
  | { type: "routing_decided"; at: string; mode: "micro" | "standard" | "complex"; rationale?: string }
  | { type: "approval_required"; at: string; nextAction: NextAction; label: string }
  | { type: "approval_granted"; at: string; nextAction?: NextAction }
  | { type: "run_paused"; at: string; label: string; nextAction: NextAction; reason?: string }
  | { type: "run_resumed"; at: string; reason?: string }
  | { type: "requirements_written"; at: string; file: string }
  | { type: "plan_written"; at: string; planFile: string; tasksFile?: string; tasksMarkdownFile?: string; costFile?: string }
  | { type: "test_spec_written"; at: string; file: string; markdownFile?: string; specs: TestSpecEntry[] }
  | { type: "tasks_registered"; at: string; tasks: ForgeTask[] }
  | { type: "task_ready"; at: string; taskId: string }
  | { type: "task_started"; at: string; taskId: string; runAttempt: number; model?: string; pidHint?: number; watchdogDeadlineAt?: string }
  | { type: "task_heartbeat"; at: string; taskId: string; watchdogDeadlineAt?: string }
  | { type: "task_runtime_updated"; at: string; taskId: string; retries?: number; error?: string | null; failureSignature?: string | null; stallWarnedAt?: string | null; diagnostic?: { classification: string; notes: string; blockerCategory?: import("./types.ts").BlockerCategory; remediationMode?: import("./types.ts").BlockerResolutionMode } | null; diagnosticCount?: number | null }
  | { type: "task_tdd_progress"; at: string; taskId: string; phase: TddPhase; iterationCount?: number; redEstablishedAt?: string; greenAchievedAt?: string; refactorValidatedAt?: string }
  | { type: "task_validation_failed"; at: string; taskId: string; error: string; output?: string; framework?: string }
  | { type: "task_validation_passed"; at: string; taskId: string; output?: string; framework?: string; coverage?: number }
  | { type: "task_blocked"; at: string; taskId: string; blocker: Blocker }
  | { type: "task_contract_patched"; at: string; taskId: string; patch: import("./blocker-resolution.ts").BlockerResolutionPatch; durabilityCommitRef: string }
  | { type: "test_spec_patched"; at: string; taskId: string; patch: import("./blocker-resolution.ts").BlockerResolutionPatch; durabilityCommitRef: string }
  | { type: "task_requeued"; at: string; taskId: string; reason: string; resolutionInstruction?: string }
  | { type: "task_gate_reviewed"; at: string; taskId: string; passed: boolean; notes: string }
  | { type: "task_completed"; at: string; taskId: string; result?: string }
  | { type: "task_failed"; at: string; taskId: string; error: string }
  | { type: "human_intervention_requested"; at: string; taskId: string; reason: string; suggestion: string }
  | { type: "human_intervention_resolved"; at: string; taskId: string; resolution: string; resolutionMode?: import("./types.ts").BlockerResolutionMode }
  | { type: "integration_review_started"; at: string }
  | { type: "integration_review_completed"; at: string; reviewFile: string }
  | { type: "run_aborted"; at: string; reason: string }
  | { type: "run_completed"; at: string }
  | { type: "run_failed"; at: string; reason: string };

export function isTaskTerminal(state: TaskRuntimeState | undefined) {
  return state ? ["completed", "blocked", "failed", "skipped"].includes(state.status) : false;
}

export function initSnapshot(orchestrationId: string, prdFile: string, at: string): RunSnapshot {
  return {
    schemaVersion: 4,
    orchestrationId,
    status: "planning",
    currentPhase: 0,
    phaseLabel: "Scope Classification",
    prdFile,
    resolvedModels: {},
    cost: {},
    tasks: [],
    taskState: {},
    blockers: [],
    supervisors: {},
    timestamps: {
      started: at,
      lastUpdated: at,
    },
  };
}
