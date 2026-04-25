import type { RunSnapshot, RunStatus, TaskRuntimeState } from "../types.ts";
import type { CommandResult } from "./contracts.ts";

export interface StatusSummary {
  orchestrationId: string;
  status: RunStatus;
  phase: number;
  phaseLabel: string;
  mode?: "micro" | "standard" | "complex";
  taskCounts: {
    total: number;
    pending: number;
    ready: number;
    running: number;
    completed: number;
    failed: number;
    blocked: number;
    skipped: number;
  };
  blockers: Array<{
    taskId: string;
    category: string;
    reason: string;
    suggestion: string;
    resolved: boolean;
  }>;
  nextAction?: string;
  timestamps: {
    started: string;
    lastUpdated: string;
  };
}

function countByStatus(taskState: Record<string, TaskRuntimeState>, status: TaskRuntimeState["status"]): number {
  return Object.values(taskState).filter((t) => t.status === status).length;
}

export function status(snapshot: RunSnapshot | null): CommandResult<StatusSummary> {
  if (!snapshot) {
    return {
      ok: false,
      events: [],
      message: "No run snapshot available",
    };
  }

  const summary: StatusSummary = {
    orchestrationId: snapshot.orchestrationId,
    status: snapshot.status,
    phase: snapshot.currentPhase,
    phaseLabel: snapshot.phaseLabel,
    mode: snapshot.orchestrationMode,
    taskCounts: {
      total: snapshot.tasks.length,
      pending: countByStatus(snapshot.taskState, "pending"),
      ready: countByStatus(snapshot.taskState, "ready"),
      running: countByStatus(snapshot.taskState, "running"),
      completed: countByStatus(snapshot.taskState, "completed"),
      failed: countByStatus(snapshot.taskState, "failed"),
      blocked: countByStatus(snapshot.taskState, "blocked"),
      skipped: countByStatus(snapshot.taskState, "skipped"),
    },
    blockers: snapshot.blockers.map((b) => ({
      taskId: b.taskId,
      category: b.category,
      reason: b.reason,
      suggestion: b.suggestion,
      resolved: Boolean(b.resolvedAt),
    })),
    nextAction: snapshot.nextAction,
    timestamps: snapshot.timestamps,
  };

  return {
    ok: true,
    events: [],
    snapshot,
    data: summary,
  };
}
