import type { CommandResult } from "./contracts.ts";

/**
 * /forge help — returns the help text as a command result.
 *
 * This module provides the help text data; rendering is handled by index.ts.
 */
export function help(): CommandResult<{ commands: string[] }> {
  return {
    ok: true,
    events: [],
    data: {
      commands: [
        "[task-forge] Commands:",
        "  /forge <prd-file>             analyze + plan + decompose, stop at approval gate",
        "  /forge <prd-file> --execute   full run without stopping at approval gate",
        "  /forge execute                execute current approved plan",
        "/forge status",
        "  /forge status                 show status",
        "  /forge blocker <id> --resolve \"...\"  resolve blocker and requeue task",
        "  /forge blocker <id> --retry         retry a blocked task",
        "  /forge blocker <id> --force-unblock  force-unblock a blocked task",
        "  /forge blocker <id> --patch-validation \"command\"  patch validation command",
        "  /forge blocker <id> --diagnostic   view blocker diagnostic",
        "  /forge pause                  pause execution",
        "  /forge resume                 resume execution",
        "  /forge abort                  abort orchestration",
        "  /forge cost                   show current cost estimate",
        "  /forge models                 show resolved models per role",
        "  /forge config                 show effective config",
      ],
    },
  };
}