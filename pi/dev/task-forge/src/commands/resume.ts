// @ts-nocheck
import type { RunSnapshot } from "../types.ts";
import type { ForgeEvent } from "../events.ts";
import type { CommandResult } from "./contracts.ts";
import { canResume } from "../transition-policy.ts";

export interface ResumeInput {
  reason?: string;
}

export interface ResumeData {
  decision: ReturnType<typeof canResume>;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function resume(snapshot: RunSnapshot | null, input: ResumeInput = {}): CommandResult<ResumeData> {
  if (!snapshot) {
    return {
      ok: false,
      events: [],
      message: "No run snapshot available",
    };
  }

  const decision = canResume(snapshot);
  if (!decision.allowed) {
    return {
      ok: false,
      events: [],
      snapshot,
      message: `Resume not allowed: ${decision.reason}`,
      data: { decision },
    };
  }

  const events: ForgeEvent[] = [
    {
      type: "run_resumed",
      at: nowIso(),
      reason: input.reason,
    },
    {
      type: "phase_entered",
      at: nowIso(),
      phase: 5,
      label: "Execution",
    },
  ];

  return {
    ok: true,
    events,
    snapshot,
    message: `Resume allowed: ${decision.reason}`,
    data: { decision },
  };
}
