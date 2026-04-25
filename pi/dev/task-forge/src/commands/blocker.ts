import type { RunSnapshot, Blocker } from "../types.ts";
import type { ForgeEvent } from "../events.ts";
import type { CommandResult } from "./contracts.ts";
import { canResolveBlocker, canForceUnblock, planRetryEvents, planForceUnblockEvents, planPatchValidationEvents } from "../transition-policy.ts";

export interface BlockerListData {
  blockers: Blocker[];
  unresolvedCount: number;
  pendingHumanIntervention?: { taskId: string; reason: string; suggestion: string };
}

export interface BlockerResolveInput {
  taskId: string;
  resolution: string;
  resolutionMode?: import("../types.ts").BlockerResolutionMode;
}

export interface BlockerResolveData {
  taskId: string;
  decision: ReturnType<typeof canResolveBlocker>;
}

export interface BlockerRetryInput {
  taskId: string;
}

export interface BlockerPatchInput {
  taskId: string;
  command: string;
}

export interface BlockerForceUnblockInput {
  taskId: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** List all blockers and human intervention state. */
export function listBlockers(snapshot: RunSnapshot | null): CommandResult<BlockerListData> {
  if (!snapshot) {
    return {
      ok: false,
      events: [],
      message: "No run snapshot available",
    };
  }

  const data: BlockerListData = {
    blockers: snapshot.blockers,
    unresolvedCount: snapshot.blockers.filter((b) => !b.resolvedAt).length,
    pendingHumanIntervention: snapshot.pendingHumanIntervention
      ? {
          taskId: snapshot.pendingHumanIntervention.taskId,
          reason: snapshot.pendingHumanIntervention.reason,
          suggestion: snapshot.pendingHumanIntervention.suggestion,
        }
      : undefined,
  };

  return {
    ok: true,
    events: [],
    snapshot,
    data,
  };
}

/** Resolve a blocker via human intervention. */
export function resolveBlocker(snapshot: RunSnapshot | null, input: BlockerResolveInput): CommandResult<BlockerResolveData> {
  if (!snapshot) {
    return {
      ok: false,
      events: [],
      message: "No run snapshot available",
    };
  }

  const decision = canResolveBlocker(snapshot, input.taskId);
  if (!decision.allowed) {
    return {
      ok: false,
      events: [],
      snapshot,
      message: `Cannot resolve blocker: ${decision.reason}`,
      data: { taskId: input.taskId, decision },
    };
  }

  const events: ForgeEvent[] = [
    {
      type: "human_intervention_resolved",
      at: nowIso(),
      taskId: input.taskId,
      resolution: input.resolution,
      resolutionMode: input.resolutionMode,
    },
  ];

  return {
    ok: true,
    events,
    snapshot,
    message: `Blocker resolution planned for ${input.taskId}`,
    data: { taskId: input.taskId, decision },
  };
}

/** Retry a blocked or failed task. */
export function retryTask(snapshot: RunSnapshot | null, input: BlockerRetryInput): CommandResult<{ taskId: string; plannedEvents: number }> {
  if (!snapshot) {
    return {
      ok: false,
      events: [],
      message: "No run snapshot available",
    };
  }

  const events = planRetryEvents(snapshot, input.taskId);
  if (events.length === 0) {
    return {
      ok: false,
      events: [],
      snapshot,
      message: `No retry events planned for ${input.taskId}`,
      data: { taskId: input.taskId, plannedEvents: 0 },
    };
  }

  return {
    ok: true,
    events,
    snapshot,
    message: `Retry planned for ${input.taskId}`,
    data: { taskId: input.taskId, plannedEvents: events.length },
  };
}

/** Force-unblock a blocked task. */
export function forceUnblock(
  snapshot: RunSnapshot | null,
  input: BlockerForceUnblockInput,
): CommandResult<{ taskId: string; plannedEvents: number }> {
  if (!snapshot) {
    return {
      ok: false,
      events: [],
      message: "No run snapshot available",
    };
  }

  const decision = canForceUnblock(snapshot, input.taskId);
  if (!decision.allowed) {
    return {
      ok: false,
      events: [],
      snapshot,
      message: `Cannot force-unblock: ${decision.reason}`,
      data: { taskId: input.taskId, plannedEvents: 0 },
    };
  }

  const events = planForceUnblockEvents(snapshot, input.taskId);
  if (events.length === 0) {
    return {
      ok: false,
      events: [],
      snapshot,
      message: `No force-unblock events planned for ${input.taskId}`,
      data: { taskId: input.taskId, plannedEvents: 0 },
    };
  }

  return {
    ok: true,
    events,
    snapshot,
    message: `Force-unblock planned for ${input.taskId}`,
    data: { taskId: input.taskId, plannedEvents: events.length },
  };
}

/** Patch task validation contract and requeue. */
export function patchValidation(
  snapshot: RunSnapshot | null,
  input: BlockerPatchInput,
): CommandResult<{ taskId: string; plannedEvents: number }> {
  if (!snapshot) {
    return {
      ok: false,
      events: [],
      message: "No run snapshot available",
    };
  }

  const events = planPatchValidationEvents(snapshot, input.taskId, input.command);
  if (events.length === 0) {
    return {
      ok: false,
      events: [],
      snapshot,
      message: `No patch events planned for ${input.taskId}`,
      data: { taskId: input.taskId, plannedEvents: 0 },
    };
  }

  return {
    ok: true,
    events,
    snapshot,
    message: `Validation patch planned for ${input.taskId}`,
    data: { taskId: input.taskId, plannedEvents: events.length },
  };
}
