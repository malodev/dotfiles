import type { Blocker, ForgeTask, NextAction, RunSnapshot } from "./types";

export type ExecutionDecision =
  | { kind: "halt"; reason: "aborted" | "awaiting_input" }
  | { kind: "continue"; batchTaskIds: string[] }
  | { kind: "stalled"; blockedByHuman: boolean }
  | { kind: "review_ready" }
  | { kind: "completed_with_issues"; blockedByHuman: boolean };

export function overdueSupervisors(snapshot: RunSnapshot | null, now = Date.now()) {
  if (!snapshot) return [] as Array<RunSnapshot["supervisors"][string]>;
  return Object.values(snapshot.supervisors).filter((supervisor) => {
    const runtime = snapshot.taskState[supervisor.taskId];
    if (!runtime || runtime.status !== "running") return false;
    const deadline = Date.parse(supervisor.watchdogDeadlineAt);
    return Number.isFinite(deadline) && deadline <= now;
  });
}

export function failedDependencies(
  task: Pick<ForgeTask, "id" | "dependencies">,
  taskState: Record<string, { status?: string } | undefined>,
) {
  return task.dependencies.filter((dep) => {
    const status = taskState[dep]?.status;
    return status === "failed" || status === "blocked";
  });
}

export function dependenciesResolved(
  task: Pick<ForgeTask, "id" | "dependencies">,
  taskState: Record<string, { status?: string } | undefined>,
) {
  return task.dependencies.every((dep) => taskState[dep]?.status === "completed");
}

export function createDependencyBlocker(task: Pick<ForgeTask, "id">, blockingDeps: string[]): Blocker {
  return {
    taskId: task.id,
    reason: `Blocked by failed dependency: ${blockingDeps.join(", ")}`,
    suggestion: `Resolve the upstream dependency task${blockingDeps.length > 1 ? "s" : ""} (${blockingDeps.join(", ")}) and then rerun /forge execute.`,
    blockedTasks: [task.id, ...blockingDeps],
  };
}

function isDependencyBlocker(blocker: { reason?: string } | undefined) {
  return Boolean(blocker?.reason?.startsWith("Blocked by failed dependency:"));
}

export function computeSchedulingActions(snapshot: RunSnapshot | null) {
  if (!snapshot) {
    return {
      readyTaskIds: [] as string[],
      blockedTasks: [] as Array<{ taskId: string; blocker: Blocker }>,
      requeueTaskIds: [] as string[],
    };
  }

  const readyTaskIds: string[] = [];
  const blockedTasks: Array<{ taskId: string; blocker: Blocker }> = [];
  const requeueTaskIds: string[] = [];

  for (const task of snapshot.tasks) {
    const runtime = snapshot.taskState[task.id];
    const status = runtime?.status ?? "pending";

    if (status === "blocked" && isDependencyBlocker(runtime?.blocker)) {
      const blockingDeps = failedDependencies(task, snapshot.taskState);
      if (blockingDeps.length === 0) {
        requeueTaskIds.push(task.id);
        if (dependenciesResolved(task, snapshot.taskState)) {
          readyTaskIds.push(task.id);
        }
      }
      continue;
    }

    if (status !== "pending") continue;

    const blockingDeps = failedDependencies(task, snapshot.taskState);
    if (blockingDeps.length > 0) {
      blockedTasks.push({ taskId: task.id, blocker: createDependencyBlocker(task, blockingDeps) });
      continue;
    }

    if (dependenciesResolved(task, snapshot.taskState)) {
      readyTaskIds.push(task.id);
    }
  }

  return { readyTaskIds, blockedTasks, requeueTaskIds };
}

export function executionFacts(snapshot: RunSnapshot | null) {
  if (!snapshot) {
    return {
      readyTaskIds: [] as string[],
      runningTaskIds: [] as string[],
      pendingTaskIds: [] as string[],
      blockedTaskIds: [] as string[],
      failedTaskIds: [] as string[],
      unfinishedTaskIds: [] as string[],
      overdueSupervisorTaskIds: [] as string[],
    };
  }

  const readyTaskIds: string[] = [];
  const runningTaskIds: string[] = [];
  const pendingTaskIds: string[] = [];
  const blockedTaskIds: string[] = [];
  const failedTaskIds: string[] = [];
  const unfinishedTaskIds: string[] = [];

  for (const [taskId, runtime] of Object.entries(snapshot.taskState)) {
    const status = runtime.status;
    if (status === "ready") readyTaskIds.push(taskId);
    if (status === "running") runningTaskIds.push(taskId);
    if (status === "pending") pendingTaskIds.push(taskId);
    if (status === "blocked") blockedTaskIds.push(taskId);
    if (status === "failed") failedTaskIds.push(taskId);
    if (!["completed", "failed", "blocked", "skipped"].includes(status)) unfinishedTaskIds.push(taskId);
  }

  return {
    readyTaskIds,
    runningTaskIds,
    pendingTaskIds,
    blockedTaskIds,
    failedTaskIds,
    unfinishedTaskIds,
    overdueSupervisorTaskIds: overdueSupervisors(snapshot).map((supervisor) => supervisor.taskId),
  };
}

export function decideExecution(snapshot: RunSnapshot | null, maxWorkers: number): ExecutionDecision {
  if (!snapshot) {
    return { kind: "stalled", blockedByHuman: false };
  }

  if (snapshot.status === "aborted") {
    return { kind: "halt", reason: "aborted" };
  }

  if (["paused", "needs_human_intervention", "awaiting_approval"].includes(snapshot.status)) {
    return { kind: "halt", reason: "awaiting_input" };
  }

  const facts = executionFacts(snapshot);
  const blockedByHuman = snapshot.status === "needs_human_intervention"
    || Boolean(snapshot.pendingHumanIntervention)
    || facts.blockedTaskIds.length > 0;

  if (facts.unfinishedTaskIds.length === 0 && facts.runningTaskIds.length === 0 && facts.readyTaskIds.length === 0) {
    if (facts.failedTaskIds.length > 0 || facts.blockedTaskIds.length > 0 || snapshot.status === "needs_human_intervention") {
      return { kind: "completed_with_issues", blockedByHuman };
    }
    return { kind: "review_ready" };
  }

  if (facts.readyTaskIds.length === 0 && facts.runningTaskIds.length === 0) {
    return { kind: "stalled", blockedByHuman };
  }

  return {
    kind: "continue",
    batchTaskIds: facts.readyTaskIds.slice(0, Math.max(0, maxWorkers - facts.runningTaskIds.length)),
  };
}

export function describeInterruptedExecution(snapshot: RunSnapshot | null): { label: string; nextAction: NextAction; requeuedTaskIds: string[] } | null {
  if (!snapshot) return null;

  const runningTaskIds = Object.values(snapshot.taskState)
    .filter((task) => task.status === "running")
    .map((task) => task.taskId);
  const wasActive = snapshot.status === "executing" || snapshot.status === "reviewing" || runningTaskIds.length > 0;
  if (!wasActive) return null;

  return {
    label: snapshot.currentPhase >= 6 ? "Integration Review (interrupted)" : "Execution (interrupted)",
    nextAction: "executePlan",
    requeuedTaskIds: runningTaskIds,
  };
}
