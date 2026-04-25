import type { RunSnapshot } from "../types.ts";
import type { ForgeEvent } from "../events.ts";
import type { CommandResult } from "./contracts.ts";
import { canPause } from "../transition-policy.ts";

export interface PauseInput {
  reason?: string;
  label?: string;
}

export interface PauseData {
  decision: ReturnType<typeof canPause>;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function pause(snapshot: RunSnapshot | null, input: PauseInput = {}): CommandResult<PauseData> {
  if (!snapshot) {
    return {
      ok: false,
      events: [],
      message: "No run snapshot available",
    };
  }

  const decision = canPause(snapshot);
  if (!decision.allowed) {
    return {
      ok: false,
      events: [],
      snapshot,
      message: `Pause not allowed: ${decision.reason}`,
      data: { decision },
    };
  }

  const events: ForgeEvent[] = [
    {
      type: "run_paused",
      at: nowIso(),
      label: input.label ?? snapshot.phaseLabel ?? "Paused",
      nextAction: snapshot.nextAction ?? "continuePlanning",
      reason: input.reason,
    },
  ];

  return {
    ok: true,
    events,
    snapshot,
    message: `Pause allowed: ${decision.reason}`,
    data: { decision },
  };
}
