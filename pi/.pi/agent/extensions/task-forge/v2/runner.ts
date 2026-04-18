import { TaskForgeV2Engine } from "./engine";
import { decideExecution, executionFacts } from "./execution";
import { applyExecutionDecision, applySchedulingActions } from "./executor";
import type { ExecutionActionPlan } from "./executor";
import type { ForgeTask, RunSnapshot } from "./types";

export interface RunnerPersistRecord {
  event: string;
  details?: Record<string, unknown>;
}

export interface RunnerNormalizedCommandUpdate<TTask extends ForgeTask = ForgeTask> {
  taskId: string;
  task: TTask;
  originalCommand?: string;
  normalizedCommand: string;
  persist: RunnerPersistRecord;
}

export interface RunnerExecutionControl<TTask extends ForgeTask = ForgeTask> {
  kind: "done" | "continue";
  statePatch?: {
    localStatus: "paused" | "failed" | "reviewing";
    currentPhase?: 6;
    phaseLabel?: "Integration Review";
  };
  persist?: RunnerPersistRecord;
  followUp?: "phaseIntegrationReview";
  launchTasks?: TTask[];
}

export interface RunnerAdvanceResult<TTask extends ForgeTask = ForgeTask> {
  schedulingPersist?: RunnerPersistRecord;
  normalizedCommands: RunnerNormalizedCommandUpdate<TTask>[];
  blocked?: {
    taskId: string;
    task: TTask;
    blocker: any;
    persist: RunnerPersistRecord;
  };
  control: RunnerExecutionControl<TTask>;
}

export class TaskForgeV2Runner {
  private engine: TaskForgeV2Engine;

  constructor(private cwd: string, private outputDir = ".task-forge") {
    this.engine = new TaskForgeV2Engine(cwd, outputDir);
  }

  async snapshot(): Promise<RunSnapshot | null> {
    return await this.engine.snapshot();
  }

  async beginExecution() {
    await this.engine.markExecutionPhaseStarted();
    return await this.snapshot();
  }

  async abortExecution(reason: string) {
    await this.engine.markRunAborted(reason);
    return await this.snapshot();
  }

  private toExecutionControl<TTask extends ForgeTask>(actionPlan: ExecutionActionPlan, tasks: TTask[]): RunnerExecutionControl<TTask> {
    if (actionPlan.kind === "halt") {
      return { kind: "done" };
    }

    if (actionPlan.kind === "continue") {
      const taskMap = new Map(tasks.map((task) => [task.id, task]));
      return {
        kind: "continue",
        launchTasks: actionPlan.batchTaskIds.map((taskId) => taskMap.get(taskId)).filter(Boolean) as TTask[],
      };
    }

    return {
      kind: "done",
      statePatch: actionPlan.statePatch,
      persist: {
        event: actionPlan.persistEvent,
        details: actionPlan.persistDetails,
      },
      followUp: actionPlan.followUp === "phaseIntegrationReview" ? "phaseIntegrationReview" : undefined,
    };
  }

  async advanceExecution<TTask extends ForgeTask>(tasks: TTask[], maxWorkers: number): Promise<RunnerAdvanceResult<TTask>> {
    const scheduling = await applySchedulingActions(this.engine, await this.snapshot());
    const readyTaskIds = new Set(executionFacts(scheduling.snapshot).readyTaskIds);
    const normalizedCommands: RunnerNormalizedCommandUpdate<TTask>[] = [];

    for (const task of tasks) {
      if (!readyTaskIds.has(task.id)) continue;
      const originalCommand = task.acceptanceSignal || task.testCommand;
      const result = await this.engine.preflightTask(task as any);
      if (!result.ok) {
        await this.engine.markApprovalRequired("executePlan", "Execution (human intervention required)");
        return {
          schedulingPersist: scheduling.changed
            ? {
                event: "task_scheduling_state_synced",
                details: {
                  readyPromoted: Boolean(scheduling.readyPromoted),
                  dependencyBlocked: Boolean(scheduling.dependencyBlocked),
                },
              }
            : undefined,
          normalizedCommands,
          blocked: {
            taskId: task.id,
            task,
            blocker: result.blocker,
            persist: {
              event: "task_preflight_blocked",
              details: { taskId: task.id, blocker: result.blocker?.reason },
            },
          },
          control: { kind: "done" },
        };
      }
      if (result.normalizedCommand && result.normalizedCommand !== originalCommand) {
        normalizedCommands.push({
          taskId: task.id,
          task,
          originalCommand,
          normalizedCommand: result.normalizedCommand,
          persist: {
            event: "task_acceptance_normalized",
            details: { taskId: task.id, command: result.normalizedCommand },
          },
        });
      }
    }

    const decision = decideExecution(await this.snapshot(), maxWorkers);
    const actionPlan = await applyExecutionDecision(this.engine, decision);
    return {
      schedulingPersist: scheduling.changed
        ? {
            event: "task_scheduling_state_synced",
            details: {
              readyPromoted: Boolean(scheduling.readyPromoted),
              dependencyBlocked: Boolean(scheduling.dependencyBlocked),
            },
          }
        : undefined,
      normalizedCommands,
      blocked: undefined,
      control: this.toExecutionControl(actionPlan, tasks),
    };
  }
}
