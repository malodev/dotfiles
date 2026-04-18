import { computeSchedulingActions, decideExecution } from "./execution";
import type { ExecutionDecision } from "./execution";
import type { TaskForgeV2Engine } from "./engine";
import type { RunSnapshot } from "./types";

export type ExecutionActionPlan =
  | { kind: "halt" }
  | { kind: "continue"; batchTaskIds: string[] }
  | {
      kind: "apply";
      statePatch: {
        localStatus: "paused" | "failed" | "reviewing";
        currentPhase?: 6;
        phaseLabel?: "Integration Review";
      };
      persistEvent: "execution_stalled" | "phase_complete";
      persistDetails?: Record<string, unknown>;
      followUp: "return" | "phaseIntegrationReview";
    };

export async function applySchedulingActions(engine: TaskForgeV2Engine, snapshot: RunSnapshot | null) {
  const actions = computeSchedulingActions(snapshot);
  let latestSnapshot = snapshot;
  for (const taskId of actions.requeueTaskIds) {
    latestSnapshot = await engine.requeueTask(taskId, "Dependency blockers cleared");
  }
  for (const entry of actions.blockedTasks) {
    latestSnapshot = await engine.markTaskBlocked(entry.taskId, entry.blocker);
  }
  for (const taskId of actions.readyTaskIds) {
    latestSnapshot = await engine.markTaskReady(taskId);
  }
  return {
    snapshot: latestSnapshot,
    changed: actions.requeueTaskIds.length > 0 || actions.blockedTasks.length > 0 || actions.readyTaskIds.length > 0,
    readyPromoted: actions.readyTaskIds.length,
    dependencyBlocked: actions.blockedTasks.length,
    dependencyReopened: actions.requeueTaskIds.length,
  };
}

export async function stepExecution(engine: TaskForgeV2Engine, snapshot: RunSnapshot | null, maxWorkers: number) {
  const scheduling = await applySchedulingActions(engine, snapshot);
  const decision = decideExecution(scheduling.snapshot, maxWorkers);
  const actionPlan = await applyExecutionDecision(engine, decision);
  return { scheduling, actionPlan };
}

export async function applyExecutionDecision(engine: TaskForgeV2Engine, decision: ExecutionDecision): Promise<ExecutionActionPlan> {
  switch (decision.kind) {
    case "halt":
      return { kind: "halt" };
    case "continue":
      return { kind: "continue", batchTaskIds: decision.batchTaskIds };
    case "stalled":
      if (decision.blockedByHuman) {
        await engine.markApprovalRequired("executePlan", "Execution (human intervention required)");
        return {
          kind: "apply",
          statePatch: { localStatus: "paused" },
          persistEvent: "execution_stalled",
          followUp: "return",
        };
      }
      await engine.markRunFailed("Execution stalled with no runnable tasks");
      return {
        kind: "apply",
        statePatch: { localStatus: "failed" },
        persistEvent: "execution_stalled",
        followUp: "return",
      };
    case "completed_with_issues":
      if (decision.blockedByHuman) {
        await engine.markApprovalRequired("executePlan", "Execution (human intervention required)");
        return {
          kind: "apply",
          statePatch: { localStatus: "paused" },
          persistEvent: "phase_complete",
          persistDetails: { phase: 5, status: "paused" },
          followUp: "return",
        };
      }
      await engine.markRunFailed("Execution ended with failed tasks and no recovery path");
      return {
        kind: "apply",
        statePatch: { localStatus: "failed" },
        persistEvent: "phase_complete",
        persistDetails: { phase: 5, status: "failed" },
        followUp: "return",
      };
    case "review_ready":
      await engine.markIntegrationReviewStarted();
      return {
        kind: "apply",
        statePatch: {
          localStatus: "reviewing",
          currentPhase: 6,
          phaseLabel: "Integration Review",
        },
        persistEvent: "phase_complete",
        persistDetails: { phase: 5, next: 6 },
        followUp: "phaseIntegrationReview",
      };
  }
}
