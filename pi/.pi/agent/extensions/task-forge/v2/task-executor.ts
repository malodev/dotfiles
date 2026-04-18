export interface TaskExecutionBlockerLike {
  taskId: string;
  reason: string;
  suggestion: string;
  blockedTasks: string[];
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface TaskExecutionTaskLike {
  id: string;
  taskMode: "single-pass" | "iterative";
  retries: number;
  status: string;
  resolvedModel?: string;
  result?: string;
  error?: string;
  blocker?: TaskExecutionBlockerLike;
  gateReview?: { passed: boolean; notes: string };
  startedAt?: string;
  completedAt?: string;
  failureSignature?: string;
  stallWarnedAt?: string;
  tddPhase?: "red" | "green" | "refactor" | "complete";
  redEstablishedAt?: string;
  greenAchievedAt?: string;
  refactorValidatedAt?: string;
  iterationCount?: number;
}

export interface BeginTaskExecutionHooks<TTask extends TaskExecutionTaskLike> {
  nowIso: () => string;
  resolveModel: (role: "worker" | "workerIterative") => Promise<string>;
  persist: (event: string, details?: Record<string, unknown>) => Promise<void>;
  markStarted: (taskId: string, runAttempt: number, model: string) => Promise<void>;
  markRuntime: (taskId: string, runtime: { retries: number; error?: string | null; stallWarnedAt?: string | null }) => Promise<void>;
  markTddProgress?: (taskId: string, phase: "red" | "green" | "refactor" | "complete", runtime: {
    iterationCount?: number;
    redEstablishedAt?: string;
    greenAchievedAt?: string;
    refactorValidatedAt?: string;
  }) => Promise<void>;
}

export interface CompleteTaskExecutionHooks<TTask extends TaskExecutionTaskLike> {
  nowIso: () => string;
  saveTaskResult: (taskId: string, result: string) => Promise<void>;
  saveGateReview: (taskId: string, gate: { passed: boolean; notes: string }) => Promise<void>;
  persist: (event: string, details?: Record<string, unknown>) => Promise<void>;
  markRuntime: (taskId: string, runtime: {
    retries: number;
    error?: string | null;
    failureSignature?: string | null;
    stallWarnedAt?: string | null;
  }) => Promise<void>;
  markCompleted: (taskId: string, result?: string) => Promise<void>;
}

export interface FailTaskExecutionHooks<TTask extends TaskExecutionTaskLike> {
  markRuntime: (taskId: string, runtime: { retries: number; error?: string | null }) => Promise<void>;
}

export async function beginTaskExecution<TTask extends TaskExecutionTaskLike>(
  task: TTask,
  hooks: BeginTaskExecutionHooks<TTask>
) {
  task.status = "running";
  task.startedAt = hooks.nowIso();
  task.error = undefined;
  task.blocker = undefined;
  task.gateReview = undefined;
  task.stallWarnedAt = undefined;

  if (task.taskMode === "iterative") {
    task.tddPhase = "red";
    task.redEstablishedAt = undefined;
    task.greenAchievedAt = undefined;
    task.refactorValidatedAt = undefined;
  }

  const role = task.taskMode === "iterative" ? "workerIterative" : "worker";
  task.resolvedModel = await hooks.resolveModel(role);

  await hooks.persist("task_start", { taskId: task.id, mode: task.taskMode });
  await hooks.markStarted(task.id, task.retries + 1, task.resolvedModel);
  await hooks.markRuntime(task.id, {
    retries: task.retries,
    error: null,
    stallWarnedAt: null,
  });

  if (task.taskMode === "iterative" && hooks.markTddProgress && task.tddPhase) {
    await hooks.markTddProgress(task.id, task.tddPhase, {
      iterationCount: task.iterationCount,
      redEstablishedAt: task.redEstablishedAt,
      greenAchievedAt: task.greenAchievedAt,
      refactorValidatedAt: task.refactorValidatedAt,
    });
  }

  return { resolvedModel: task.resolvedModel };
}

export async function completeTaskExecution<TTask extends TaskExecutionTaskLike>(
  task: TTask,
  gate: { passed: boolean; notes: string },
  hooks: CompleteTaskExecutionHooks<TTask>
) {
  task.status = "completed";
  task.failureSignature = undefined;
  if (task.taskMode === "iterative") task.tddPhase = "complete";
  task.completedAt = hooks.nowIso();

  await hooks.saveTaskResult(task.id, task.result ?? "");
  await hooks.saveGateReview(task.id, gate);
  await hooks.persist("task_complete", { taskId: task.id });
  await hooks.markRuntime(task.id, {
    retries: task.retries,
    error: null,
    failureSignature: null,
    stallWarnedAt: null,
  });
  await hooks.markCompleted(task.id, task.result);
}

export async function failTaskExecutionAttempt<TTask extends TaskExecutionTaskLike>(
  task: TTask,
  error: unknown,
  hooks: FailTaskExecutionHooks<TTask>
) {
  task.retries += 1;
  task.error = String((error as any)?.message ?? error);
  await hooks.markRuntime(task.id, {
    retries: task.retries,
    error: task.error,
  });
  return { error: task.error, retries: task.retries };
}
