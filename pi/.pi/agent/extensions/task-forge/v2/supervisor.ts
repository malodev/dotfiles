import type { Blocker, ForgeTask, RunSnapshot } from "./types";

export interface SupervisorWarningDecision<TTask extends Pick<ForgeTask, "id" | "title"> = Pick<ForgeTask, "id" | "title">> {
  kind: "warn";
  supervisorTaskId: string;
  task: TTask;
  blocker: Blocker;
  warnedAt: string;
}

export interface SupervisorEscalationDecision<TTask extends Pick<ForgeTask, "id" | "title"> = Pick<ForgeTask, "id" | "title">> {
  kind: "escalate";
  supervisorTaskId: string;
  task: TTask;
  blocker: Blocker;
}

export type SupervisorDecision<TTask extends Pick<ForgeTask, "id" | "title"> = Pick<ForgeTask, "id" | "title">> =
  | SupervisorWarningDecision<TTask>
  | SupervisorEscalationDecision<TTask>;

export function overdueSupervisors(snapshot: RunSnapshot | null, now = Date.now()) {
  if (!snapshot) return [] as Array<RunSnapshot["supervisors"][string]>;
  return Object.values(snapshot.supervisors).filter((supervisor) => {
    const runtime = snapshot.taskState[supervisor.taskId];
    if (!runtime || runtime.status !== "running") return false;
    const deadline = Date.parse(supervisor.watchdogDeadlineAt);
    return Number.isFinite(deadline) && deadline <= now;
  });
}

export function decideSupervisorActions<TTask extends Pick<ForgeTask, "id" | "title">>(input: {
  snapshot: RunSnapshot | null;
  now: number;
  nowIso: string;
  escalationMs: number;
  fallbackTask: (taskId: string) => TTask;
  createBlocker: (task: TTask) => Blocker;
  resolveTask?: (taskId: string) => TTask | undefined;
}): SupervisorDecision<TTask>[] {
  if (!input.snapshot) return [];

  const decisions: SupervisorDecision<TTask>[] = [];
  for (const supervisor of overdueSupervisors(input.snapshot, input.now)) {
    const runtime = input.snapshot.taskState[supervisor.taskId];
    const task = input.resolveTask?.(supervisor.taskId) ?? input.fallbackTask(supervisor.taskId);
    const blocker = input.createBlocker(task);

    if (!runtime?.stallWarnedAt) {
      decisions.push({
        kind: "warn",
        supervisorTaskId: supervisor.taskId,
        task,
        blocker,
        warnedAt: input.nowIso,
      });
      continue;
    }

    const warnedAt = Date.parse(runtime.stallWarnedAt);
    const alreadyRequestedHumanHelp = input.snapshot.pendingHumanIntervention?.taskId === supervisor.taskId;
    if (!alreadyRequestedHumanHelp && Number.isFinite(warnedAt) && input.now - warnedAt >= input.escalationMs) {
      decisions.push({
        kind: "escalate",
        supervisorTaskId: supervisor.taskId,
        task,
        blocker,
      });
    }
  }

  return decisions;
}
