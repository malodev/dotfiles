# AGENTS.md — TaskForge

> Context for AI coding agents working on this codebase.

## What this is

TaskForge is a **pi extension** for hierarchical multi-agent orchestration. It takes a PRD, analyzes it, produces a plan, decomposes into tasks, and coordinates worker agents until completion.

**Architecture:** V2-only event-sourced engine. `events.jsonl` is the sole source of truth. `state.json` is derived/debug-only.

## Quick commands

```bash
# All tests (320)
node --test --experimental-strip-types $(find src tests -name '*.test.ts' -type f)

# Drift checks (6)
bash scripts/drift-check.sh

# Typecheck single modules (not full project — tsc doesn't work project-wide)
node --experimental-strip-types -e "import './src/commands/plan.ts'"
```

## Critical invariants — never break these

1. **`events.jsonl` is append-only.** Never delete, reorder, or modify events. The log IS the database.
2. **`deriveStatus()` must be deterministic.** Same events → same status. Always. No randomness, no external state.
3. **`state.json` is derived.** Write it from snapshot, never hand-edit it to "fix" a run.
4. **`needs_human_intervention` is sticky.** Clear only via `human_intervention_resolved` event.
5. **`failed` never has `nextAction`.** deriveStatus ignores `nextAction` when status is failed.
6. **`awaiting_approval` never has running tasks.** hasRunning check takes priority.
7. **No Deno commands in validation.** `assertSafeValidationCommand` rejects Deno.
8. **No bare `tsc --noEmit` without `-p`.** `normalizeValidationCommand` strips it.
9. **Agent prompts (`agents/*.md`) must not instruct bare `tsc`.** Use `node --test --experimental-strip-types` directly.

## File map

```
index.ts                    # Pi extension shell — command routing, hooks, state sync
src/
  types.ts                  # RunSnapshot, RunStatus, TaskRuntimeState, ForgeTask, etc.
  events.ts                 # ForgeEvent union type + initSnapshot()
  derive.ts                 # applyEvent() + deriveStatus() — the state machine
  storage.ts                # createLayout, appendEvent, deriveSnapshot, loadSnapshot
  engine.ts                 # TaskForgeV2Engine — orchestration API
  migrate.ts                # Legacy V1 → V2 state import (migration-only)
  validation.ts             # normalizeValidationCommand, assertSafeValidationCommand,
                            # runTaskValidation, coverage parsing
  preflight.ts              # preflightAcceptanceCommand, runtime checks
  transition-policy.ts      # canExecute, canResume, canPause, canAbort, canResolveBlocker
  commands/                 # Pure V2 command services (no pi runtime dependency)
    plan.ts                 # Planning orchestrator (5 phases, micro/standard/complex)
    execute.ts              # /forge execute
    resume.ts               # /forge resume
    status.ts               # /forge status
    blocker.ts              # /forge blocker + subcommands
    pause.ts, abort.ts      # /forge pause, /forge abort
    cost.ts, models.ts, config.ts, help.ts
    contracts.ts            # CommandResult<T> shared contract
  execution.ts              # executionFacts, describeInterruptedExecution, schedulingActions
  executor.ts               # executeManagedTask (worker lifecycle)
  task-runner.ts            # Task runner loop (single-pass + iterative TDD)
  task-executor.ts          # beginTaskExecution, completeTaskExecution, failTaskExecutionAttempt
  task-success.ts           # runTaskValidation (post-worker validation)
  task-failure.ts           # Failure classification + retry logic
  task-diagnostic.ts        # Diagnostic review (root cause classification)
  runner.ts                 # TaskForgeV2Runner — advanceExecution, beginExecution
  supervisor.ts             # Watchdog + heartbeat escalation
  command-adapter.ts        # executeApprovedPlanLoop, launchExecutionBatch
  gate-review.ts            # Gate review prompt assembly + parsing
  diagnostic-review.ts      # Diagnostic review prompt assembly
  review.ts                 # Integration review
  launcher.ts               # Task batch launching with watchdogs
  planning-recovery.ts      # Interrupted planning resumption
  blockers-*.ts             # Blocker classification + resolution
agents/                     # Runtime agent prompts (used as system prompts)
docs/
  ROADMAP.md                # Active backlog
  CHANGELOG.md
  prds/roadmap.md           # Current PRD for next sprint
  internal/                 # Implementation notes
  operations/runbook.md     # Operator procedures
  superseded/               # Historical docs (17 files)
scripts/drift-check.sh      # 6 automated architecture checks
```

## State machine

The full state machine lives in `ARCHITECTURE-V2.md`. Key points:

```
idle → planning → awaiting_approval → executing → reviewing → completed
                       │                    │
                       ▼                    ▼
                     paused         needs_human_intervention
                       │                    │
                       ▼                    ▼
                   executing           executing (after resolution)
                                       │
                  run_failed ────────▶ failed
                  run_aborted ───────▶ aborted
```

**deriveStatus() resolution order** (in `src/derive.ts`):
1. aborted/completed/paused → return immediately
2. pendingHumanIntervention → needs_human_intervention
3. hasRunning → executing
4. reviewFile set → completed
5. nextAction set → awaiting_approval
6. allDone + phase ≥ 5 → reviewing
7. unresolved blockers → needs_human_intervention
8. ready/pending + phase ≥ 5 → executing
9. failed → failed
10. default → planning

## Working with the event log

Events are the only durable state. When adding a feature:
1. Define event types in `src/events.ts` (reuse existing if possible)
2. Add event handler in `src/derive.ts` → `applyEvent()`
3. Update `deriveStatus()` if the event affects run-level status
4. Ensure replay determinism — test with `replayEvents()`
5. Update `EVENTS.md` if adding new event types

## Don't

- Don't add new command authority to V1 paths (they're deleted)
- Don't mutate `state` directly without a corresponding V2 event
- Don't add `@ts-nocheck` to new files (existing exceptions are only for pi type gaps)
- Don't use Deno in tests or validation
- Don't add `tsc --noEmit` to agent prompts or validation commands
- Don't use worktree-based ant colonies for this repo — they can't see the main directory
