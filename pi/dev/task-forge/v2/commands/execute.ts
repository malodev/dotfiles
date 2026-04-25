// @ts-nocheck
import type { RunSnapshot } from "../types.ts";
import type { ForgeEvent } from "../events.ts";
import type { CommandResult } from "./contracts.ts";
import { canExecute } from "../transition-policy.ts";

export interface ExecuteInput {
  /** If true and run is awaiting approval, emit approval_granted event. */
  grantApproval?: boolean;
}

export interface ExecuteData {
  decision: ReturnType<typeof canExecute>;
  tasksToLaunch: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

export function execute(snapshot: RunSnapshot | null, input: ExecuteInput = {}): CommandResult<ExecuteData> {
  if (!snapshot) {
    return {
      ok: false,
      events: [],
      message: "No run snapshot available",
    };
  }

  const decision = canExecute(snapshot);
  if (!decision.allowed) {
    return {
      ok: false,
      events: [],
      snapshot,
      message: `Execution not allowed: ${decision.reason}`,
      data: { decision, tasksToLaunch: [] },
    };
  }

  const events: ForgeEvent[] = [];

  if (snapshot.status === "awaiting_approval" && snapshot.nextAction === "executePlan" && input.grantApproval) {
    events.push({
      type: "approval_granted",
      at: nowIso(),
      nextAction: "executePlan",
    });
  }

  const tasksToLaunch = Object.values(snapshot.taskState)
    .filter((t) => t.status === "ready")
    .map((t) => t.taskId);

  return {
    ok: true,
    events,
    snapshot,
    message: `Execution allowed: ${decision.reason}`,
    data: { decision, tasksToLaunch },
  };
}
