import type { ForgeEvent } from "../events.ts";
import type { RunSnapshot } from "../types.ts";

/**
 * Shared command result contract for all V2 command services.
 *
 * Commands are pure functions that:
 * - Accept a RunSnapshot (and command-specific input)
 * - Return event intents to append (never mutate runtime state directly)
 * - Return structured data payloads without UI rendering concerns
 * - Are testable without extension shell runtime
 */
export interface CommandResult<T = unknown> {
  /** Whether the command succeeded. */
  ok: boolean;
  /** Event intents to durably append. */
  events: ForgeEvent[];
  /** The updated snapshot after applying the command's events (optional, for convenience). */
  snapshot?: RunSnapshot;
  /** Human-readable message. */
  message?: string;
  /** Command-specific structured data. */
  data?: T;
}

/** Reason codes shared across commands. */
export type CommandReasonCode =
  | "ok"
  | "run_not_found"
  | "invalid_input"
  | "precondition_failed"
  | "not_allowed"
  | "task_not_found"
  | "no_change_needed";

export interface CommandDecision {
  allowed: boolean;
  reason: CommandReasonCode;
}
