import type { RunSnapshot } from "../types.ts";
import type { ForgeEvent } from "../events.ts";
import type { CommandResult } from "./contracts.ts";
import { canAbort } from "../transition-policy.ts";

export interface AbortInput {
  reason: string;
}

export interface AbortData {
  decision: ReturnType<typeof canAbort>;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function abort(snapshot: RunSnapshot | null, input: AbortInput): CommandResult<AbortData> {
  if (!snapshot) {
    return {
      ok: false,
      events: [],
      message: "No run snapshot available",
    };
  }

  const decision = canAbort(snapshot);
  if (!decision.allowed) {
    return {
      ok: false,
      events: [],
      snapshot,
      message: `Abort not allowed: ${decision.reason}`,
      data: { decision },
    };
  }

  const events: ForgeEvent[] = [
    {
      type: "run_aborted",
      at: nowIso(),
      reason: input.reason,
    },
  ];

  return {
    ok: true,
    events,
    snapshot,
    message: `Abort allowed: ${decision.reason}`,
    data: { decision },
  };
}
