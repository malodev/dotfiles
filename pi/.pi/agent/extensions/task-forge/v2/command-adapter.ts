import { applyRunnerAdvanceBridgeResult, type RunnerAdvanceBridgeHooks, type RunnerAdvanceBridgeOutcome } from "./bridge";
import { launchTaskBatchWithWatchdogs } from "./launcher";
import type { RunnerAdvanceResult } from "./runner";
import type { ForgeTask } from "./types";

export interface ExecutionLoopStateLike<TTask> {
  tasks: TTask[];
  status?: string;
  currentPhase?: number;
  phaseLabel?: string;
}

export interface ExecutionLoopHooks<TTask extends ForgeTask> {
  persistState: (event: string, details?: Record<string, unknown>) => Promise<void>;
  beginExecution: () => Promise<void>;
  reconcile: () => Promise<void>;
  syncExecutionSnapshot: () => Promise<{ effectiveStatus?: string }>;
  isAbortRequested: () => boolean;
  abortExecution: () => Promise<void>;
  advanceExecution: () => Promise<RunnerAdvanceResult<TTask>>;
  bridgeHooks: RunnerAdvanceBridgeHooks<TTask>;
  launchTaskBatch: (tasks: TTask[]) => Promise<void>;
}

export async function executeApprovedPlanLoop<TTask extends ForgeTask>(
  state: ExecutionLoopStateLike<TTask>,
  hooks: ExecutionLoopHooks<TTask>,
) {
  if (!state.tasks.length) throw new Error("No tasks available");

  state.status = "executing";
  state.currentPhase = 5;
  state.phaseLabel = "Execution";
  await hooks.persistState("phase_start", { phase: 5 });
  await hooks.beginExecution();
  await hooks.reconcile();

  while (true) {
    const executionState = await hooks.syncExecutionSnapshot();

    if (hooks.isAbortRequested() || executionState.effectiveStatus === "aborted") {
      state.status = "aborted";
      await hooks.persistState("aborted");
      await hooks.abortExecution();
      await hooks.reconcile();
      return;
    }

    const step = await hooks.advanceExecution();
    const advanceHandled: RunnerAdvanceBridgeOutcome<TTask> = await applyRunnerAdvanceBridgeResult(step, hooks.bridgeHooks);
    if (advanceHandled.done) {
      return;
    }

    await hooks.launchTaskBatch(advanceHandled.launchTasks);
    await hooks.reconcile();
  }
}

export interface WatchdogLaunchHooks<TTask> {
  runTask: (task: TTask) => Promise<void>;
  sweepOverdueSupervisors: () => Promise<void> | void;
  sweepIntervalMs: number;
}

export async function launchExecutionBatch<TTask>(tasks: TTask[], hooks: WatchdogLaunchHooks<TTask>) {
  await launchTaskBatchWithWatchdogs(tasks, {
    runTask: hooks.runTask,
    sweep: hooks.sweepOverdueSupervisors,
    sweepIntervalMs: hooks.sweepIntervalMs,
  });
}
