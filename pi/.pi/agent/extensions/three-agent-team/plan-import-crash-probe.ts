/**
 * Crash-probe instrumentation for plan-import tests.
 *
 * When CRASH_PROBE_PHASE env var is set, the importer writes "READY <phase>"
 * to stdout and stalls until SIGKILL. The test parent reads this signal,
 * kills the worker, then verifies recovery.
 *
 * Production code is unaffected — the env check is a no-op when unset.
 */

export type CrashProbePhase =
  | "AFTER_PREPARED"
  | "AFTER_TREE_INSTALLED"
  | "AFTER_REF_CAS_BEFORE_GIT_INSTALLED"
  | "AFTER_GIT_INSTALLED"
  | "AFTER_QUEUE_PERSISTED_BEFORE_ENROLLED"
  | "AFTER_QUEUE_ENROLLED";

const PHASE = (typeof process !== "undefined" && process.env.CRASH_PROBE_PHASE) || null;

export function maybeCrashProbe(phase: CrashProbePhase): void {
  if (PHASE === phase) {
    process.stdout.write(`READY ${phase}\n`);
    // Stall indefinitely until parent sends SIGKILL
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      // Busy-wait — SIGKILL will terminate us
    }
  }
}
