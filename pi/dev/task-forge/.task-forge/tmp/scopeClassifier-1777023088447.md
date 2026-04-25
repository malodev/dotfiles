# Goal
Classify this work as micro, standard, or complex.

# Return format
{ "mode": "micro|standard|complex", "estimatedTasks": number, "rationale": string, "signals": string[] }

# Existing codebase file tree
(none)

# PRD
# TaskForge V2-Only Migration Plan

> Supersedes: `TASKFORGE-ENHANCEMENT-PLAN.md` for migration strategy.
>
> Goal: remove the old V1 runtime path as quickly and safely as practical, making V2 the only authoritative runtime model.

## Required context for implementers

Before planning or implementing this migration, read these files:

### Canonical architecture and operator docs
- `ARCHITECTURE-V2.md`
- `README.md`
- `docs/operations/runbook.md`

### Core V2 runtime files
- `v2/events.ts`
- `v2/derive.ts`
- `v2/storage.ts`
- `v2/engine.ts`
- `v2/execution.ts`
- `v2/validation.ts`
- `v2/preflight.ts`

### Current extension shell
- `index.ts`

### Runtime configuration
- `task-forge.json`

### Optional historical context
- `TASKFORGE-ENHANCEMENT-PLAN.md`
- `TODO-now.md`
- `TODO-later.md`
- `milestones.md`

## Executive summary

TaskForge should complete its transition to the V2 event-sourced architecture.

The current hybrid design still contains V1-shaped runtime state, compatibility bridges, and command logic that can disagree with V2 derived snapshots. This causes stuck states and confusing UX.

The fastest clean direction is:

```text
/forge command -> V2 command service -> V2 events -> derived snapshot -> render output
```

`index.ts` should become a thin pi integration shell. V1 code should be removed from runtime and kept only as a one-time migration helper if needed.

---

## Core decision

TaskForge V2 is authoritative.

- `events.jsonl` is the source of truth.
- `state.json` is a derived/debug snapshot.
- Session memory is advisory only.
- V1 runtime state must not drive command decisions.
- V1 compatibility code should be removed or quarantined under migration-only modules.

---

## Current problem

The current implementation can still reason through multiple state views:

- V2 event log
- V2 derived snapshot
- V1-compatible `ForgeState`
- session-restored state
- mutable in-memory command state
- `state.json`

This creates contradictory command outcomes, such as:

```text
needs_human_intervention + patched task + no blockers
/forge execute -> cannot execute
/forge resume -> not resumable
```

This is primarily a hybrid-runtime problem, not a flaw in the V2 architecture.

---

## Migration principles

1. **Delete runtime V1, do not keep improving it.**
2. **Command decisions must read only V2 snapshots.**
3. **Command effects must append V2 events.**
4. **Derived state must come from replay, not manual mutation.**
5. **Migration from legacy state is allowed only at startup/import time.**
6. **`index.ts` should parse commands and render results, not own orchestration semantics.**

---

## Target architecture

```text
agent/extensions/task-forge/
  index.ts                         # thin pi extension shell
  task-forge.json                  # runtime config
  agents/*.md                      # runtime prompts/tools
  v2/
    commands/
      status.ts
      execute.ts
      resume.ts
      blocker.ts
      pause.ts
      abort.ts
      cost.ts
      models.ts
      config.ts
    transition-policy.ts
    events.ts
    derive.ts
    storage.ts
    engine.ts
    execution.ts
    validation.ts
    preflight.ts
    blocker-*.ts
    migrate.ts                     # legacy import only
```

---

## Phase 0 — Freeze V1 runtime immediately

### Goal

Stop adding behavior to V1-compatible runtime paths.

### Work items

- Mark V1 bridge helpers as deprecated internally.
- Stop using V1 state for new command decisions.
- Add comments/TODOs identifying deletion targets.

### Deletion candidates

- `ForgeState` runtime dependency in command handlers
- `createV1StateFromV2`
- `applyAuthoritativeSnapshotToV1`
- `taskListFromAuthoritative`
- V1 `statusLabel`
- `v1-status-helpers.ts`
- session-entry restore as authoritative path

### Acceptance criteria

- New work does not add behavior to V1 paths.
- All new command work is V2-first.

---

## Phase 1 — Add V2 command services

### Goal

Create V2-only command modules while keeping existing command handlers temporarily intact.

### Work items

Create:

```text
v2/commands/status.ts
v2/commands/execute.ts
v2/commands/resume.ts
v2/commands/blocker.ts
v2/commands/pause.ts
v2/commands/abort.ts
v2/commands/cost.ts
v2/commands/models.ts
v2/commands/config.ts
```

Each command service should:

- accept a V2 snapshot and config/input,
- return a structured command result,
- declare events to append,
- avoid direct UI concerns.

Example shape:

```ts
interface CommandResult {
  ok: boolean;
  level: "info" | "warning" | "success" | "error";
  message: string;
  events?: ForgeEvent[];
  snapshotHint?: RunSnapshot;
}
```

### Acceptance criteria

- V2 command services are unit-testable without pi runtime.
- Existing command handlers can call them without changing user-facing commands yet.

---

## Phase 2 — Add transition policy

### Goal

Centralize state transition semantics before flipping command handlers.

### Work items

Create:

```text
v2/transition-policy.ts
```

Responsibilities:

- `canExecute(snapshot)`
- `canResume(snapshot)`
- `canPause(snapshot)`
- `canAbort(snapshot)`
- `canResolveBlocker(snapshot, taskId)`
- `planRetryEvents(snapshot, taskId)`
- `planPatchValidationEvents(snapshot, taskId, command)`

### Acceptance criteria

- All status gating rules live in one place.
- Tests cover key states:
  - awaiting approval
  - executing with no running tasks
  - needs human intervention
  - patched human-intervention task
  - failed run
  - paused run
  - completed/aborted run

---

## Phase 3 — Flip `/forge status` to V2-only

### Goal

Make status rendering purely derived from V2 snapshot.

### Work items

- Replace any V1 status fallback except legacy migration import.
- Use V2 `statusSummaryFromV2` / root blocker rendering only.
- Remove V1 blocker sorting from runtime status path.

### Acceptance criteria

- `/forge status` does not require V1-shaped state.
- Status output is identical after restart from event replay.
- Tests cover root blocker output and no-blocker states.

---

## Phase 4 — Flip `/forge execute` and `/forge resume` to V2-only

### Goal

Eliminate stuck execution/resume states caused by V1/V2 mismatch.

### Work items

- `/forge execute` reads V2 snapshot only.
- `/forge resume` reads V2 snapshot only.
- Both use `transition-policy.ts`.
- Both append V2 events only.
- Execution loop uses V2 scheduling facts only.

### Acceptance criteria

- `needs_human_intervention` cannot be accidentally treated as both non-runnable and resumable.
- Valid blocker resolution can make execution available deterministically.
- No direct mutation of V1 state is needed.

---

## Phase 5 — Flip `/forge blocker` to V2-only

### Goal

Make blocker resolution event-first and eliminate state patching as primary behavior.

### Work items

Implement V2-only behavior for:

- `/forge blocker`
- `/forge blocker <id>`
- `/forge blocker <id> --resolve "..."`
- `/forge blocker <id> --retry`
- `/forge blocker <id> --force-unblock`
- `/forge blocker <id> --patch-validation "..."`
- `/forge blocker --list --json`

Events should represent all durable changes:

```text
task_contract_patched
human_intervention_resolved
task_requeued
approval_required / approval_granted
```

### Acceptance criteria

- Blocker commands never depend on V1 task state.
- Patching validation clears active human intervention when appropriate.
- Retrying an actionable human-gated task can move the run back to executable state.
- Dependency unblock cascade is event-backed and replayable.

---

## Phase 6 — Flip remaining commands to V2-only

### Commands

- `/forge pause`
- `/forge abort`
- `/forge cost`
- `/forge models`
- `/forge config`
- `/forge help`

### Acceptance criteria

- No command handler depends on V1 runtime state.
- `index.ts` mostly delegates to V2 command services.

---

## Phase 7 — Delete V1 runtime code

### Goal

Remove runtime V1 code and reduce mental model count to one.

### Remove or quarantine

- V1 status helpers
- V1 blocker sorting runtime path
- V1 in-memory task state as command authority
- V1 session restore path as authoritative source
- V1 status rendering
- V1-derived task list helpers

### Keep only if needed

- A legacy migration function that imports old `state.json` into V2 events/snapshot.
- Historical docs under `docs/history/`.

### Acceptance criteria

- Runtime code has no V1 command authority.
- Legacy state import is one-way and explicit.
- Docs say V2 is the only runtime architecture.

---

## Phase 8 — Harden validation and evidence handling

### Goal

Prevent repeat operational failures after V2-only migration.

### Work items

- Reject unsafe validation command shapes before execution.
- Enforce Node-only test command policy.
- Summarize noisy evidence in human-facing output.
- Preserve full logs in artifacts.

### Acceptance criteria

- Bare `npx tsc --noEmit` is rejected with concise guidance.
- No Deno test/check commands are accepted in active TaskForge paths.
- Long compiler help output is not pasted into user-facing intervention messages.

---

## Phase 9 — Documentation and drift control

### Work items

- Add `EVENTS.md`.
- Update README to state V2-only runtime.
- Move historical V1 docs to `docs/history/`.
- Add drift checks:
  - no Deno active references,
  - architecture event list matches `events.ts`,
  - config example does not drift from `task-forge.json`.

### Acceptance criteria

- Top-level docs describe only current V2 runtime.
- Historical docs are clearly marked historical.
- CI/local scripts catch common drift.

---

## Minimal fast path

If speed matters more than incremental safety, implement only these first:

1. `transition-policy.ts`
2. V2-only `/forge execute`
3. V2-only `/forge resume`
4. V2-only `/forge blocker`
5. V2-only `/forge status`
6. Delete V1 runtime helpers

Then harden validation and docs after.

---

## Testing strategy

### Must-have tests

- V2 replay reconstructs status after every command flow.
- execute/resume/blocker use same transition policy.
- human intervention resolution is event-backed.
- validation patch -> retry -> execute works.
- dependency blocker cascade is replayable.
- legacy state import works once, then V2 owns state.

### Regression scenarios

- `needs_human_intervention` + patched task + no blockers -> executable.
- `executing` with no running tasks and ready tasks -> execution can continue/recover.
- failed dependency gets requeued -> downstream dependency blockers clear.
- invalid validation command never reaches worker/gate review.

---

## Success criteria

TaskForge is considered V2-only when:

- All user commands make decisions from a V2 snapshot.
- All durable effects are V2 events.
- `state.json` is derived/debug only.
- Session memory is never authoritative.
- V1 runtime helpers are deleted or migration-only.
- Status after restart matches status before restart.
- Common blocker fixes do not require manual JSON editing.

---

## Non-goals

- Replacing the agent prompt system.
- Replacing model tier configuration.
- Adding a dashboard/UI.
- Fully automating plan rewrites without human confirmation.
- Supporting Deno as the TaskForge test engine.
