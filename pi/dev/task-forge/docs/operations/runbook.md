# TaskForge Operator Runbook

> **V2-only runtime operator guide.**
>
> TaskForge runs on an event-sourced V2 engine.
> `events.jsonl` is the authoritative source of truth.
> `state.json` is derived/debug-only and is regenerated on every load.

## Quick reference

| Command | Purpose |
|---|---|
| `/forge status` | Show current run status derived from V2 snapshot |
| `/forge execute` | Start/resume execution (uses V2 transition policy) |
| `/forge resume` | Resume a paused run (same policy as execute) |
| `/forge pause` | Pause execution gracefully |
| `/forge abort` | Abort the current run |
| `/forge blocker TASK-001 --resolve "..."` | Resolve a blocker with instructions |
| `/forge blocker TASK-001 --retry` | Requeue a blocked/failed task |
| `/forge blocker TASK-001 --patch-validation "..."` | Patch validation command and clear human intervention |
| `/forge blocker TASK-001 --force-unblock` | Force-unblock a task (emits events) |
| `/forge blocker --list --json` | List blockers as JSON |
| `/forge cost` | Show cost estimate |
| `/forge models` | Show resolved models per role |
| `/forge config` | Show effective config |

## State and artifacts

### Authoritative files

```text
.task-forge/
  events.jsonl          # AUTHORITATIVE — append-only event log
  state.json            # DERIVED — regenerated from events.jsonl on every load
  locks/                # Runtime lock files
  tasks/                # Task artifacts (worker results, gate reviews, iteration logs)
  tmp/                  # Temporary working files
```

### Never edit manually

- `events.jsonl` — append-only; only the V2 engine appends events.
- `state.json` — derived; will be overwritten on the next load.

### Safe to inspect

- `events.jsonl` — read-only inspection is safe and encouraged for debugging.
- `tasks/TASK-*.md` — worker outputs.
- `tasks/TASK-*.gate.json` — gate review results.
- `tasks/TASK-*.iterations.log` — iterative task loop history.

## Recovery procedures

### Restart recovery

If pi exits during execution:

1. TaskForge replays `events.jsonl` on the next `/forge status` or command.
2. Running tasks are reconciled; stalled tasks are blocked.
3. Status after restart matches status before restart for the same event log.
4. Resume with `/forge execute` or `/forge resume`.

### Human intervention recovery

When a task needs human help:

1. The run transitions to `needs_human_intervention`.
2. No tasks are left silently running.
3. Resolve with `/forge blocker TASK-XXX --resolve "..."`.
4. Then `/forge execute` to continue.

If the issue is a validation command mismatch:

1. `/forge blocker TASK-XXX --patch-validation "correct command"`
2. Then `/forge blocker TASK-XXX --retry`
3. Then `/forge execute`

### Dependency blocker cascade

When a failed dependency blocks downstream tasks:

1. Fix or requeue the upstream task.
2. Downstream dependency blockers clear automatically via event replay.
3. No manual JSON editing is required.

## Troubleshooting

### Status looks wrong after restart

- Check `events.jsonl` for the latest events.
- Verify `state.json` was regenerated (it should show a recent `lastUpdated`).
- If `state.json` is stale, run `/forge status` to force regeneration.

### Cannot execute despite no visible blockers

- Use `/forge status` to see the V2-derived state.
- Check for `needs_human_intervention` state.
- Verify the run is not `awaiting_approval`.
- Check that there are ready tasks (not just pending tasks with unmet dependencies).

### Blocker resolution not taking effect

- Ensure you used `--resolve`, `--retry`, or `--patch-validation`.
- Check that the resolution produced events (inspect `events.jsonl`).
- Run `/forge status` to confirm the snapshot reflects the new events.

## Validation policy

TaskForge enforces a Node-only validation command policy:

- Allowed: `npm test`, `npm run typecheck`, `pnpm test`, `yarn test`, `node --test`, `npx vitest run`, `npx jest`, etc.
- Rejected: bare `npx tsc --noEmit` (unsafe working-directory assumptions), `deno test`, `deno check`, shell operators, bare paths.

Unsafe commands are rejected before they reach the worker or gate review.

## Drift checks

Run the local drift-check script to catch common documentation and policy drift:

```bash
npm run drift-check
```

This checks:
- No active Deno references in runtime/docs/tests.
- Event lists in `EVENTS.md` and `ARCHITECTURE-V2.md` match `src/events.ts`.
- Config example in `README.md` matches `task-forge.json`.

## See also

- `ARCHITECTURE-V2.md` — V2 architecture and design principles
- `EVENTS.md` — canonical event reference
- `README.md` — user-facing documentation
