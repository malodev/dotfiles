import type { RunSnapshot, TaskRuntimeState, TaskValidationContract } from "./types.ts";
import { assertSafeValidationCommand } from "./validation.ts";

export interface TaskRequeuedEvent {
  type: "task_requeued";
  at: string;
  taskId: string;
  reason: string;
  resolutionInstruction?: string;
}

export interface TaskContractPatchedEvent {
  type: "task_contract_patched";
  at: string;
  taskId: string;
  patch: { validation: TaskValidationContract };
  durabilityCommitRef: string;
}

export type TransitionReasonCode =
  | "run_not_found"
  | "run_is_awaiting_approval"
  | "has_runnable_tasks"
  | "no_runnable_tasks"
  | "run_needs_human_intervention"
  | "run_is_failed"
  | "run_is_paused"
  | "run_is_completed"
  | "run_is_aborted"
  | "no_tasks_registered"
  | "has_interrupted_tasks"
  | "no_interrupted_execution"
  | "run_is_active"
  | "has_running_tasks"
  | "run_not_active"
  | "run_is_abortable"
  | "blocker_is_resolvable"
  | "blocker_already_resolved"
  | "task_not_found"
  | "task_is_terminal"
  | "task_not_blocked";

export type TransitionDecision = {
  allowed: boolean;
  reason: TransitionReasonCode;
};

function nowIso() {
  return new Date().toISOString();
}

function hasRunnableTasks(snapshot: RunSnapshot) {
  return Object.values(snapshot.taskState).some((runtime) => runtime.status === "ready" || runtime.status === "running");
}

function hasRunningTasks(snapshot: RunSnapshot) {
  return Object.values(snapshot.taskState).some((runtime) => runtime.status === "running");
}

function findRuntimeTask(snapshot: RunSnapshot, taskId: string): TaskRuntimeState | undefined {
  return snapshot.taskState[taskId] ?? Object.values(snapshot.taskState).find((runtime) => runtime.taskId === taskId);
}

function hasUnresolvedTaskBlocker(snapshot: RunSnapshot, taskId: string) {
  return snapshot.blockers.some((blocker) => blocker.taskId === taskId && !blocker.resolvedAt);
}

function hasResolvedTaskBlocker(snapshot: RunSnapshot, taskId: string) {
  return snapshot.blockers.some((blocker) => blocker.taskId === taskId && Boolean(blocker.resolvedAt));
}

export function canExecute(snapshot: RunSnapshot | null): TransitionDecision {
  if (!snapshot) return { allowed: false, reason: "run_not_found" };
  if (snapshot.status === "aborted") return { allowed: false, reason: "run_is_aborted" };
  if (snapshot.status === "completed") return { allowed: false, reason: "run_is_completed" };
  if (snapshot.status === "failed") return { allowed: false, reason: "run_is_failed" };
  if (snapshot.status === "paused") return { allowed: false, reason: "run_is_paused" };
  if (snapshot.status === "needs_human_intervention" || snapshot.pendingHumanIntervention) {
    return { allowed: false, reason: "run_needs_human_intervention" };
  }

  if (snapshot.status === "awaiting_approval" && snapshot.nextAction === "executePlan") {
    return { allowed: true, reason: "run_is_awaiting_approval" };
  }

  if (snapshot.status === "executing") {
    return hasRunnableTasks(snapshot)
      ? { allowed: true, reason: "has_runnable_tasks" }
      : { allowed: false, reason: "no_runnable_tasks" };
  }

  if (snapshot.tasks.length === 0) {
    return { allowed: false, reason: "no_tasks_registered" };
  }

  return hasRunnableTasks(snapshot)
    ? { allowed: true, reason: "has_runnable_tasks" }
    : { allowed: false, reason: "no_runnable_tasks" };
}

export function canResume(snapshot: RunSnapshot | null): TransitionDecision {
  if (!snapshot) return { allowed: false, reason: "run_not_found" };
  if (snapshot.status === "aborted") return { allowed: false, reason: "run_is_aborted" };
  if (snapshot.status === "completed") return { allowed: false, reason: "run_is_completed" };
  if (snapshot.status === "failed") return { allowed: false, reason: "run_is_failed" };
  if (snapshot.status === "needs_human_intervention" || snapshot.pendingHumanIntervention) {
    return { allowed: false, reason: "run_needs_human_intervention" };
  }
  if (snapshot.status === "paused") return { allowed: true, reason: "run_is_paused" };

  if (hasRunningTasks(snapshot)) {
    return { allowed: true, reason: "has_interrupted_tasks" };
  }

  return { allowed: false, reason: "no_interrupted_execution" };
}

export function canPause(snapshot: RunSnapshot | null): TransitionDecision {
  if (!snapshot) return { allowed: false, reason: "run_not_found" };

  if (snapshot.status === "executing" || snapshot.status === "reviewing") {
    return { allowed: true, reason: "run_is_active" };
  }

  if (hasRunningTasks(snapshot)) {
    return { allowed: true, reason: "has_running_tasks" };
  }

  return { allowed: false, reason: "run_not_active" };
}

export function canAbort(snapshot: RunSnapshot | null): TransitionDecision {
  if (!snapshot) return { allowed: false, reason: "run_not_found" };
  if (snapshot.status === "aborted") return { allowed: false, reason: "run_is_aborted" };
  if (snapshot.status === "completed") return { allowed: false, reason: "run_is_completed" };
  return { allowed: true, reason: "run_is_abortable" };
}

export function canResolveBlocker(snapshot: RunSnapshot | null, taskId: string): TransitionDecision {
  if (!snapshot) return { allowed: false, reason: "run_not_found" };

  const runtimeTask = findRuntimeTask(snapshot, taskId);
  const taskRegistered = snapshot.tasks.some((task) => task.id === taskId);
  if (!runtimeTask && !taskRegistered) {
    return { allowed: false, reason: "task_not_found" };
  }

  if (runtimeTask && ["completed", "failed", "skipped"].includes(runtimeTask.status)) {
    return { allowed: false, reason: "task_is_terminal" };
  }

  const pendingInterventionForTask = snapshot.pendingHumanIntervention?.taskId === taskId;
  const runtimeBlocker = runtimeTask?.blocker;
  const unresolvedRuntimeBlocker = Boolean(runtimeBlocker && !runtimeBlocker.resolvedAt);
  const resolvedRuntimeBlocker = Boolean(runtimeBlocker?.resolvedAt);

  if (pendingInterventionForTask || unresolvedRuntimeBlocker || hasUnresolvedTaskBlocker(snapshot, taskId)) {
    return { allowed: true, reason: "blocker_is_resolvable" };
  }

  if (resolvedRuntimeBlocker || hasResolvedTaskBlocker(snapshot, taskId)) {
    return { allowed: false, reason: "blocker_already_resolved" };
  }

  return { allowed: false, reason: "task_not_blocked" };
}

export function planRetryEvents(snapshot: RunSnapshot | null, taskId: string): TaskRequeuedEvent[] {
  if (!snapshot) return [];

  const runtimeTask = findRuntimeTask(snapshot, taskId);
  if (!runtimeTask) return [];
  if (runtimeTask.status !== "failed" && runtimeTask.status !== "blocked") return [];

  return [
    {
      type: "task_requeued",
      at: nowIso(),
      taskId,
      reason: `Retry requested for task ${taskId}`,
      resolutionInstruction: runtimeTask.error,
    },
  ];
}

export function canForceUnblock(snapshot: RunSnapshot | null, taskId: string): TransitionDecision {
  if (!snapshot) return { allowed: false, reason: "run_not_found" };

  const runtimeTask = findRuntimeTask(snapshot, taskId);
  const taskRegistered = snapshot.tasks.some((task) => task.id === taskId);
  if (!runtimeTask && !taskRegistered) {
    return { allowed: false, reason: "task_not_found" };
  }

  if (runtimeTask && runtimeTask.status === "blocked") {
    return { allowed: true, reason: "blocker_is_resolvable" };
  }

  const unresolvedBlocker = hasUnresolvedTaskBlocker(snapshot, taskId);
  if (unresolvedBlocker) {
    return { allowed: true, reason: "blocker_is_resolvable" };
  }

  return { allowed: false, reason: "task_not_blocked" };
}

export function planForceUnblockEvents(snapshot: RunSnapshot | null, taskId: string): TaskRequeuedEvent[] {
  if (!snapshot) return [];

  const runtimeTask = findRuntimeTask(snapshot, taskId);
  if (!runtimeTask) return [];
  if (runtimeTask.status !== "blocked") return [];

  return [
    {
      type: "task_requeued",
      at: nowIso(),
      taskId,
      reason: `Force unblock requested for task ${taskId}`,
      resolutionInstruction: runtimeTask.error,
    },
  ];
}

export function planPatchValidationEvents(
  snapshot: RunSnapshot | null,
  taskId: string,
  command: string,
): Array<TaskContractPatchedEvent | TaskRequeuedEvent> {
  if (!snapshot) return [];

  const runtimeTask = findRuntimeTask(snapshot, taskId);
  if (!runtimeTask) return [];
  if (runtimeTask.status !== "failed" && runtimeTask.status !== "blocked") return [];

  const normalizedCommand = command.trim();
  if (!normalizedCommand) return [];

  try {
    assertSafeValidationCommand(normalizedCommand);
  } catch {
    return [];
  }

  const at = nowIso();
  return [
    {
      type: "task_contract_patched",
      at,
      taskId,
      patch: {
        validation: {
          mode: "command",
          command: normalizedCommand,
        },
      },
      durabilityCommitRef: `${taskId}:${Date.now()}`,
    },
    {
      type: "task_requeued",
      at,
      taskId,
      reason: `Retry after validation patch for task ${taskId}`,
      resolutionInstruction: normalizedCommand,
    },
  ];
}
