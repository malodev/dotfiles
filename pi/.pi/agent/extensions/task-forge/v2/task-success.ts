import type { TaskExecutionBlockerLike, TaskExecutionTaskLike } from "./task-executor";

export interface TaskValidationResult {
  passed: boolean;
  output: string;
  coverage?: number;
}

export interface TaskGateReviewResult<TBlocker extends TaskExecutionBlockerLike = TaskExecutionBlockerLike> {
  passed: boolean;
  notes: string;
  blocker?: TBlocker;
}

export interface TaskSuccessTaskLike extends TaskExecutionTaskLike {
  validationFramework?: string;
  lastCoverage?: number;
}

export interface TaskSuccessHooks<TTask extends TaskSuccessTaskLike, TBlocker extends TaskExecutionBlockerLike = TaskExecutionBlockerLike> {
  runWorker: (task: TTask) => Promise<string>;
  markHeartbeat: (taskId: string) => Promise<void>;
  runValidation?: (task: TTask) => Promise<TaskValidationResult>;
  markValidation?: (taskId: string, validation: TaskValidationResult, task: TTask) => Promise<void>;
  runGateReview: (task: TTask) => Promise<TaskGateReviewResult<TBlocker>>;
  markGateReview: (taskId: string, gate: TaskGateReviewResult<TBlocker>) => Promise<void>;
  onGateBlocked?: (task: TTask, gate: TaskGateReviewResult<TBlocker>) => Promise<void>;
}

export type TaskSuccessOutcome<TBlocker extends TaskExecutionBlockerLike = TaskExecutionBlockerLike> =
  | { kind: "completed"; gate: TaskGateReviewResult<TBlocker> }
  | { kind: "blocked"; gate: TaskGateReviewResult<TBlocker> };

export async function executeTaskSuccessPath<TTask extends TaskSuccessTaskLike, TBlocker extends TaskExecutionBlockerLike = TaskExecutionBlockerLike>(
  task: TTask,
  hooks: TaskSuccessHooks<TTask, TBlocker>
): Promise<TaskSuccessOutcome<TBlocker>> {
  const result = await hooks.runWorker(task);
  task.result = result;

  await hooks.markHeartbeat(task.id);

  if (task.taskMode !== "iterative" && hooks.runValidation) {
    const validation = await hooks.runValidation(task);
    await hooks.markValidation?.(task.id, validation, task);
  }

  const gate = await hooks.runGateReview(task);
  task.gateReview = { passed: gate.passed, notes: gate.notes };
  await hooks.markGateReview(task.id, gate);

  if (gate.blocker) {
    await hooks.onGateBlocked?.(task, gate);
    return { kind: "blocked", gate };
  }

  if (!gate.passed) {
    throw new Error(gate.notes || "Gate review failed");
  }

  return { kind: "completed", gate };
}
