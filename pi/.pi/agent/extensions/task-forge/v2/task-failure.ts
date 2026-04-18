export interface TaskFailureDiagnosticLike {
  classification: string;
  notes: string;
}

export interface EnvironmentFailureLike {
  signature: string;
  reason: string;
  suggestion: string;
}

export interface TaskFailureDecisionInput<TTask extends TaskFailureTaskLike> {
  task: TTask;
  maxRetries: number;
  environmentFailure?: EnvironmentFailureLike | null;
  normalizedFailureSignature?: string;
  canDiagnose: boolean;
}

export type TaskFailureDecision =
  | {
      kind: "block";
      source: "environment" | "repeated_failure";
      applyFailureSignature?: string;
      blocker: {
        reason: string;
        suggestion: string;
      };
      persistEvent: string;
      persistDetails?: Record<string, unknown>;
    }
  | {
      kind: "diagnose";
      applyFailureSignature: string;
    }
  | {
      kind: "fail";
      applyFailureSignature: string;
    }
  | {
      kind: "retry";
      applyFailureSignature: string;
      retryReason: string;
    };

export interface TaskFailureDiagnosisLike {
  classification?: string;
  notes?: string;
  rewrittenTestSpec?: unknown | null;
  blocker?: {
    reason?: string;
    suggestion?: string;
    blockedTasks?: unknown;
  } | null;
}

export type TaskFailureDiagnosticDecision =
  | {
      kind: "rewrite_test_spec";
      classification: "test_spec_error";
      rewrittenTestSpec: unknown;
    }
  | {
      kind: "block";
      classification: "requirement_or_plan_error";
      blocker: {
        reason: string;
        suggestion: string;
        blockedTasks: string[];
      };
    }
  | {
      kind: "continue";
    };

export interface TaskFailureTaskLike {
  id: string;
  retries: number;
  error?: string;
  failureSignature?: string;
  diagnostic?: TaskFailureDiagnosticLike;
  diagnosticCount?: number;
}

export interface TaskFailureHooks<TTask extends TaskFailureTaskLike> {
  markRuntime: (taskId: string, runtime: {
    retries: number;
    error?: string | null;
    failureSignature?: string | null;
    diagnostic?: TaskFailureDiagnosticLike;
    diagnosticCount?: number;
  }) => Promise<void>;
  markFailed?: (taskId: string, error: string) => Promise<void>;
  requeue?: (taskId: string, reason: string) => Promise<void>;
  reconcile?: () => Promise<void>;
  persist?: (event: string, details?: Record<string, unknown>) => Promise<void>;
}

export function decideTaskFailure<TTask extends TaskFailureTaskLike>(input: TaskFailureDecisionInput<TTask>): TaskFailureDecision {
  if (input.environmentFailure) {
    return {
      kind: "block",
      source: "environment",
      applyFailureSignature: input.environmentFailure.signature,
      blocker: {
        reason: input.environmentFailure.reason,
        suggestion: input.environmentFailure.suggestion,
      },
      persistEvent: "task_blocked_environment",
      persistDetails: { signature: input.environmentFailure.signature },
    };
  }

  const failureSignature = input.normalizedFailureSignature ?? "";
  if (input.task.failureSignature && input.task.failureSignature === failureSignature) {
    return {
      kind: "block",
      source: "repeated_failure",
      blocker: {
        reason: "Repeated identical task failure requires human review",
        suggestion: "The same failure happened again without meaningful progress. Review the task result, logs, and acceptance environment, then provide a concrete resolution before retrying.",
      },
      persistEvent: "task_blocked_repeated_failure",
      persistDetails: { signature: failureSignature },
    };
  }

  if (input.task.retries > input.maxRetries) {
    if (input.canDiagnose) {
      return {
        kind: "diagnose",
        applyFailureSignature: failureSignature,
      };
    }
    return {
      kind: "fail",
      applyFailureSignature: failureSignature,
    };
  }

  return {
    kind: "retry",
    applyFailureSignature: failureSignature,
    retryReason: input.task.error ?? "retry",
  };
}

export function decideTaskFailureDiagnosis(taskId: string, taskError: string | undefined, diagnosis: TaskFailureDiagnosisLike | null | undefined): TaskFailureDiagnosticDecision {
  if (!diagnosis) {
    return { kind: "continue" };
  }

  if (diagnosis.classification === "test_spec_error" && diagnosis.rewrittenTestSpec) {
    return {
      kind: "rewrite_test_spec",
      classification: "test_spec_error",
      rewrittenTestSpec: diagnosis.rewrittenTestSpec,
    };
  }

  if (diagnosis.classification === "requirement_or_plan_error") {
    return {
      kind: "block",
      classification: "requirement_or_plan_error",
      blocker: diagnosis.blocker
        ? {
            reason: diagnosis.blocker.reason || taskError || "Requirement/plan error",
            suggestion: diagnosis.blocker.suggestion || "Review the plan and test contract",
            blockedTasks: Array.isArray(diagnosis.blocker.blockedTasks) ? diagnosis.blocker.blockedTasks.filter((value): value is string => typeof value === "string") : [],
          }
        : {
            reason: taskError || "Requirement/plan error",
            suggestion: String(diagnosis.notes || "Review the requirement, plan, and generated tests together."),
            blockedTasks: [taskId],
          },
    };
  }

  return { kind: "continue" };
}

export function taskFailureRuntimePatch<TTask extends TaskFailureTaskLike>(task: TTask) {
  return {
    retries: task.retries,
    error: task.error,
    failureSignature: task.failureSignature,
    diagnostic: task.diagnostic,
    diagnosticCount: task.diagnosticCount,
  };
}

export async function syncTaskFailureRuntime<TTask extends TaskFailureTaskLike>(task: TTask, hooks: TaskFailureHooks<TTask>) {
  await hooks.markRuntime(task.id, taskFailureRuntimePatch(task));
}

export async function applyTaskFailureSignature<TTask extends TaskFailureTaskLike>(
  task: TTask,
  failureSignature: string,
  hooks: TaskFailureHooks<TTask>
) {
  task.failureSignature = failureSignature;
  await syncTaskFailureRuntime(task, hooks);
}

export async function applyTaskDiagnostic<TTask extends TaskFailureTaskLike>(
  task: TTask,
  diagnostic: TaskFailureDiagnosticLike,
  hooks: TaskFailureHooks<TTask>
) {
  task.diagnostic = diagnostic;
  task.diagnosticCount = (task.diagnosticCount ?? 0) + 1;
  await syncTaskFailureRuntime(task, hooks);
}

export async function failTaskTerminally<TTask extends TaskFailureTaskLike>(task: TTask, hooks: TaskFailureHooks<TTask>) {
  await syncTaskFailureRuntime(task, hooks);
  await hooks.markFailed?.(task.id, task.error ?? "Task failed");
  await hooks.reconcile?.();
  await hooks.persist?.("task_failed", {
    taskId: task.id,
    error: task.error,
    diagnostic: task.diagnostic?.classification,
  });
}

export async function retryTaskAfterFailure<TTask extends TaskFailureTaskLike>(
  task: TTask,
  reason: string,
  hooks: TaskFailureHooks<TTask>
) {
  await syncTaskFailureRuntime(task, hooks);
  await hooks.requeue?.(task.id, reason);
  await hooks.reconcile?.();
  await hooks.persist?.("task_retry", {
    taskId: task.id,
    retries: task.retries,
    error: task.error,
  });
}
