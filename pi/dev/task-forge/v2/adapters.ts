import type { RunnerAdvanceBridgeHooks } from "./bridge";
import type { ForgeTask } from "./types";
import type { BeginTaskExecutionHooks, CompleteTaskExecutionHooks, TaskExecutionTaskLike } from "./task-executor";
import type { TaskFailureHooks, TaskFailureTaskLike } from "./task-failure";
import type { IntegrationReviewHooks } from "./review";

export function createTaskForgeRunnerAdvanceHooks<TTask extends ForgeTask>(deps: {
  reconcile: () => Promise<void>;
  persistTaskDefinitions: () => Promise<void>;
  persistState: (event: string, details?: Record<string, unknown>) => Promise<void>;
  updateTaskCommand: (task: TTask, normalizedCommand: string) => void;
  emitHumanIntervention: (task: TTask, blocker: any) => Promise<void>;
  applyStatePatch: (statePatch: NonNullable<RunnerAdvanceBridgeHooks<TTask>["applyStatePatch"]> extends (arg: infer TPatch) => any ? TPatch : never) => void;
  phaseIntegrationReview: () => Promise<void>;
}): RunnerAdvanceBridgeHooks<TTask> {
  return {
    reconcile: deps.reconcile,
    persistTaskDefinitions: deps.persistTaskDefinitions,
    persist: deps.persistState,
    updateTaskCommand: deps.updateTaskCommand,
    emitHumanIntervention: deps.emitHumanIntervention,
    applyStatePatch: deps.applyStatePatch,
    runFollowUp: async (followUp) => {
      if (followUp === "phaseIntegrationReview") {
        await deps.phaseIntegrationReview();
      }
    },
  };
}

export function createTaskForgeIntegrationReviewHooks(deps: {
  runReviewer: (prompt: string) => Promise<string>;
  saveReview: (content: string) => Promise<string>;
  completeReview: (reviewFile: string, review: string) => Promise<void>;
  notifyComplete?: () => Promise<void> | void;
}): IntegrationReviewHooks {
  return {
    runReviewer: deps.runReviewer,
    saveReview: deps.saveReview,
    complete: deps.completeReview,
    notifyComplete: deps.notifyComplete,
  };
}

export function createTaskForgeBeginTaskExecutionHooks<TTask extends TaskExecutionTaskLike>(deps: {
  nowIso: () => string;
  resolveModel: BeginTaskExecutionHooks<TTask>["resolveModel"];
  persistState: BeginTaskExecutionHooks<TTask>["persist"];
  markStarted: BeginTaskExecutionHooks<TTask>["markStarted"];
  markRuntime: BeginTaskExecutionHooks<TTask>["markRuntime"];
  markTddProgress?: BeginTaskExecutionHooks<TTask>["markTddProgress"];
}): BeginTaskExecutionHooks<TTask> {
  return {
    nowIso: deps.nowIso,
    resolveModel: deps.resolveModel,
    persist: deps.persistState,
    markStarted: deps.markStarted,
    markRuntime: deps.markRuntime,
    markTddProgress: deps.markTddProgress,
  };
}

export function createTaskForgeCompleteTaskExecutionHooks<TTask extends TaskExecutionTaskLike>(deps: {
  nowIso: () => string;
  saveTaskResult: CompleteTaskExecutionHooks<TTask>["saveTaskResult"];
  saveGateReview: CompleteTaskExecutionHooks<TTask>["saveGateReview"];
  persistState: CompleteTaskExecutionHooks<TTask>["persist"];
  markRuntime: CompleteTaskExecutionHooks<TTask>["markRuntime"];
  markCompleted: CompleteTaskExecutionHooks<TTask>["markCompleted"];
}): CompleteTaskExecutionHooks<TTask> {
  return {
    nowIso: deps.nowIso,
    saveTaskResult: deps.saveTaskResult,
    saveGateReview: deps.saveGateReview,
    persist: deps.persistState,
    markRuntime: deps.markRuntime,
    markCompleted: deps.markCompleted,
  };
}

export function createTaskForgeTaskFailureHooks<TTask extends TaskFailureTaskLike>(deps: {
  markRuntime: TaskFailureHooks<TTask>["markRuntime"];
  markFailed?: TaskFailureHooks<TTask>["markFailed"];
  requeue?: TaskFailureHooks<TTask>["requeue"];
  reconcile?: TaskFailureHooks<TTask>["reconcile"];
  persistState?: TaskFailureHooks<TTask>["persist"];
}): TaskFailureHooks<TTask> {
  return {
    markRuntime: deps.markRuntime,
    markFailed: deps.markFailed,
    requeue: deps.requeue,
    reconcile: deps.reconcile,
    persist: deps.persistState,
  };
}

