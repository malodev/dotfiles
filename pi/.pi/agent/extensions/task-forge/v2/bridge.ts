import type { RunnerAdvanceResult } from "./runner";
import type { ForgeTask } from "./types";

export interface RunnerAdvanceBridgeHooks<TTask extends ForgeTask> {
  reconcile: () => Promise<void>;
  persistTaskDefinitions: () => Promise<void>;
  persist: (event: string, details?: Record<string, unknown>) => Promise<void>;
  updateTaskCommand: (task: TTask, normalizedCommand: string) => void;
  emitHumanIntervention: (task: TTask, blocker: any) => Promise<void>;
  applyStatePatch?: (statePatch: NonNullable<RunnerAdvanceResult<TTask>["control"]["statePatch"]>) => void;
  runFollowUp?: (followUp: NonNullable<RunnerAdvanceResult<TTask>["control"]["followUp"]>) => Promise<void>;
}

export type RunnerAdvanceBridgeOutcome<TTask extends ForgeTask> =
  | { done: true }
  | { done: false; launchTasks: TTask[] };

export async function applyRunnerAdvanceBridgeResult<TTask extends ForgeTask>(
  step: RunnerAdvanceResult<TTask>,
  hooks: RunnerAdvanceBridgeHooks<TTask>
): Promise<RunnerAdvanceBridgeOutcome<TTask>> {
  const needsTaskDefinitionMirror = Boolean(step.schedulingPersist) || step.normalizedCommands.length > 0;

  if (needsTaskDefinitionMirror) {
    await hooks.reconcile();
  }

  for (const result of step.normalizedCommands) {
    hooks.updateTaskCommand(result.task, result.normalizedCommand);
  }

  if (needsTaskDefinitionMirror) {
    await hooks.persistTaskDefinitions();
  }

  const persistRecords = [
    ...(step.schedulingPersist ? [step.schedulingPersist] : []),
    ...step.normalizedCommands.map((result) => result.persist),
  ];
  for (const record of persistRecords) {
    await hooks.persist(record.event, record.details);
  }

  if (step.blocked) {
    await hooks.reconcile();
    await hooks.persist(step.blocked.persist.event, step.blocked.persist.details);
    await hooks.emitHumanIntervention(step.blocked.task, step.blocked.blocker);
    return { done: true };
  }

  if (step.control.kind === "done") {
    if (step.control.statePatch) {
      hooks.applyStatePatch?.(step.control.statePatch);
    }
    if (step.control.persist) {
      await hooks.persist(step.control.persist.event, step.control.persist.details);
    }
    await hooks.reconcile();
    if (step.control.followUp) {
      await hooks.runFollowUp?.(step.control.followUp);
    }
    return { done: true };
  }

  return {
    done: false,
    launchTasks: step.control.launchTasks ?? [],
  };
}
