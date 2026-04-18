# TaskForge Refactor Roadmap V2

_Last updated: 2026-04-16 (session 2)_

This is the **active working plan** for the TaskForge V2 rewrite.

It complements:
- `PLAN-1.md` — original target architecture and orchestration behavior
- `ARCHITECTURE-V2.md` — durable/event-sourced model and design principles
- `WORKLOG-V2.md` — durable memory of what has been done, decisions made, and problems resolved
- `CONTINUE-V2-PROMPT.md` — clean-session handoff prompt for a new agent
- `REGRESSION-CHECKLIST-V2.md` — required smoke/regression checks after meaningful refactor steps

If this roadmap and older notes disagree, **follow this roadmap for current implementation order**.

## Continuity contract

To make clean-session continuation possible, keep these files updated whenever meaningful progress is made:
- `REFACTOR-ROADMAP-V2.md` — where we are going
- `WORKLOG-V2.md` — what we have done and why
- `ARCHITECTURE-V2.md` — target architecture
- `CONTINUE-V2-PROMPT.md` — starter prompt for a new agent if the workflow materially changes
- `REGRESSION-CHECKLIST-V2.md` — regression gate for refactor safety

---

## Goal

Finish the migration from the current mixed v1/v2 bridge into a **native, durable, file-first TaskForge V2 execution architecture** while preserving the existing `/forge` UX.

Target outcome:
- `index.ts` becomes mostly command/session/UI glue
- orchestration decisions live under `v2/`
- execution lifecycle is durable and restart-safe
- human intervention, retries, diagnostics, and review handoff are explicit and deterministic
- remaining v1 bridge logic is either removed or reduced to thin adapters

---

## Current status

### High-level assessment

- **Execution-path refactor:** substantially advanced
- **Core durable model:** in place
- **Bridge shrink:** significant progress made
- **Full rewrite completion:** not done yet

### Rough completion estimate

- **Execution-path rewrite:** ~82%
- **Full extension rewrite:** ~60%

### Current active regression note

A real refactor regression was detected:
- `Extension "command:forge" error: loadConfig is not defined`

Cause:
- helpers depending on `config`/`state`/`loadConfig(...)` were accidentally moved outside the extension closure

Rule going forward:
- after meaningful refactor steps, run `REGRESSION-CHECKLIST-V2.md`
- do not consider a step complete until the regression checklist is run or explicitly skipped with a reason

---

## What is already extracted into `v2/`

### Durable state core
- `v2/types.ts`
- `v2/events.ts`
- `v2/derive.ts`
- `v2/storage.ts`
- `v2/engine.ts`
- `v2/migrate.ts`
- `v2/preflight.ts`

### Execution model / orchestration core
- `v2/execution.ts`
- `v2/executor.ts`
- `v2/runner.ts`

### Bridge and adapter surfaces
- `v2/bridge.ts`
- `v2/launcher.ts`
- `v2/review.ts`
- `v2/adapters.ts`

### Task lifecycle extraction
- `v2/task-executor.ts`
- `v2/task-failure.ts`
- `v2/task-diagnostic.ts`
- `v2/task-success.ts`

---

## What `index.ts` still owns

The following still materially live in `index.ts` and are the main remaining rewrite surface:

### Command/session shell
- slash command parsing and routing
- startup/shutdown/recovery hooks
- footer/status/session message behavior
- config loading and path resolution

### Planning flow
- phase orchestration for classify/analyze/plan/test design
- some artifact persistence and approval transitions

### Remaining execution-side logic
- task worker invocations:
  - `runSinglePassTask(...)`
  - `runIterativeTask(...)`
- some direct `withV2Engine(...)` persistence calls
- some artifact-writing details around task/test artifacts
- residual thin wrappers in `index.ts` that bridge closure-bound runtime state into extracted `v2/` helpers

---

## File-by-file target ownership

### `index.ts`
Should eventually own only:
- command handling
- pi UI/session integration
- high-level command entrypoints
- thin wiring into `v2/` services

### `v2/runner.ts`
Should own:
- execution-cycle progression
- begin/resume/abort execution transitions
- bridge-facing execution result surface

### `v2/bridge.ts`
Should own:
- generic application of runner outcomes
- bridge-safe control/result application

### `v2/task-executor.ts`
Should own:
- task lifecycle shell
- start/complete/fail attempt primitives

### `v2/task-success.ts`
Should own:
- successful task orchestration pipeline
- worker -> heartbeat -> validation -> gate sequence

### `v2/task-failure.ts`
Should own:
- failure decision tree
- retry/fail/block/diagnose branching rules
- failure state sync helpers

### `v2/task-diagnostic.ts`
Should own:
- diagnostic result application
- rewritten test spec application
- blocker conversion from diagnostic decisions

### `v2/review.ts`
Should own:
- integration review prompt assembly and handoff flow

### Newly extracted execution/bridge modules
- `v2/task-runner.ts`
- `v2/command-adapter.ts`
- `v2/supervisor.ts`

### Newly extracted reviewer/validator modules
- `v2/validation.ts`
- `v2/gate-review.ts`
- `v2/diagnostic-review.ts`

---

## Remaining milestones

## Milestone 1 — Extract reviewer/validator implementations ✅

### Scope
Move the concrete implementations of these out of `index.ts`:
- `runValidation(...)`
- validation framework detection / coverage parsing helpers
- `gateReviewTask(...)`
- `diagnoseTaskFailure(...)`

### Target files
- new: `v2/validation.ts`
- new: `v2/gate-review.ts`
- new: `v2/diagnostic-review.ts`
- update: `v2/adapters.ts`
- shrink: `index.ts`

### Done criteria
- `index.ts` no longer constructs validation/gate/diagnostic prompts directly
- framework/coverage parsing is not embedded in `index.ts`
- execution path consumes helper outputs from `v2/`

### Checkpoint result
- completed on 2026-04-16
- `index.ts` now delegates validation execution to `v2/validation.ts`
- gate-review prompt assembly/parsing now live in `v2/gate-review.ts`
- diagnostic-review prompt assembly/parsing now live in `v2/diagnostic-review.ts`
- remaining `index.ts` pieces are thin runtime wrappers only

### Suggested commit
- `refactor(task-forge): extract validation and review helpers`

---

## Milestone 2 — Extract worker run surfaces ✅

### Scope
Move these behind a dedicated task-runner/worker layer:
- `runSinglePassTask(...)`
- `runIterativeTask(...)`
- iterative TDD loop orchestration hooks

### Target files
- new: `v2/worker.ts` or `v2/task-runner.ts`
- maybe new: `v2/tdd.ts`
- update: `v2/adapters.ts`
- shrink: `index.ts`

### Done criteria
- `index.ts` no longer directly chooses between single-pass and iterative worker implementations
- iterative TDD loop is no longer embedded in `index.ts`
- task success path receives worker execution through a dedicated v2 surface

### Checkpoint result
- completed on 2026-04-16
- worker execution now flows through `v2/task-runner.ts`
- iterative TDD loop bookkeeping moved out of `index.ts`
- `index.ts` no longer owns concrete single-pass/iterative worker implementations

### Suggested commit
- `refactor(task-forge): extract worker execution pipeline`

---

## Milestone 3 — Collapse remaining task execution glue ✅

### Scope
Reduce `executeTask(...)` to a thin adapter around `v2` helpers.

### Target files
- `v2/task-executor.ts`
- `v2/task-success.ts`
- `v2/task-failure.ts`
- `v2/task-diagnostic.ts`
- `v2/adapters.ts`
- `index.ts`

### Done criteria
- `executeTask(...)` becomes mostly callback wiring and one or two high-level helper invocations
- repeated `withV2Engine(...)` calls around task lifecycle are reduced substantially
- task artifact writing is either helper-driven or isolated behind adapters

### Checkpoint result
- completed on 2026-04-16
- `executeTask(...)` now delegates to `v2/task-runner.ts`
- failure/diagnostic/retry flows remain helper-driven through dedicated V2 modules
- artifact persistence and engine mutations are passed as injected hooks instead of being interleaved with decision logic in `index.ts`

### Suggested commit
- `refactor(task-forge): reduce task execution bridge to thin adapter`

---

## Milestone 4 — Shrink command/session bridge further ✅

### Scope
Move repeated command/session plumbing into a dedicated adapter/service layer.

### Candidate extractions
- recurring reconcile/persist bundles
- runner/launcher/review/task hook construction
- status/session update helpers where appropriate

### Target files
- new: `v2/command-adapter.ts` or `v2/session-adapter.ts`
- update: `v2/adapters.ts`
- shrink: `index.ts`

### Done criteria
- `index.ts` stops defining many v2 callback bundles inline
- command handlers mostly call named service helpers rather than build orchestration glue objects in place

### Checkpoint result
- completed on 2026-04-16
- execution-loop control moved to `v2/command-adapter.ts`
- watchdog launching is now routed through a dedicated command adapter helper
- supervisor decision policy now lives in `v2/supervisor.ts`

### Suggested commit
- `refactor(task-forge): extract command and session adapters`

---

## Milestone 5 — Final bridge collapse and cleanup ✅

### Scope
Retire obsolete bridge-only helpers and remove clearly superseded v1 execution remnants.

### Candidate cleanup
- remove dead helpers no longer used by the v2 runner/task surfaces
- reduce duplicated persistence/state sync paths
- remove stale compatibility branches where authoritative v2 state is always available
- ensure docs match final module boundaries

### Done criteria
- execution path is clearly centered on `v2/runner.ts` + task modules
- `index.ts` is primarily command/session/UI integration
- no major execution decision trees remain inline in `index.ts`
- README and architecture docs reflect the actual code structure

### Checkpoint result
- completed on 2026-04-16
- dead adapter helpers were trimmed where extraction made them obsolete
- execution-path orchestration decisions now sit under `v2/` modules (`runner`, `task-runner`, `command-adapter`, `supervisor`, `validation`, review helpers)
- remaining inline code in `index.ts` is predominantly extension wiring, planning flow, and user/session behavior

### Suggested commit
- `refactor(task-forge): finalize v2 execution migration`

---

## Remaining work count

### Execution rewrite endgame
Implementation milestones are complete.

### Full rewrite endgame
Implementation milestones are complete; remaining work is regression validation, docs reconciliation, and any bug fixes discovered by live smoke tests.

---

## Working rules for the remaining refactor

### 1. Prefer extraction over patching
If a branch in `index.ts` is getting more complicated, extract a helper/module instead of deepening it.

### 2. Preserve `/forge` UX
Keep the command surface stable:
- `/forge <prd>`
- `/forge execute`
- `/forge resume`
- `/forge pause`
- `/forge abort`
- `/forge status`
- `/forge blocker ... --resolve ...`

### 3. Keep v2 authoritative
Whenever possible:
- facts go into v2 events
- derived state comes from v2 snapshots
- local state is mirrored, not authoritative

### 4. Prefer typed result surfaces
New helpers should return explicit typed outcomes rather than ad hoc booleans or multi-branch mutable side effects.

### 5. Commit in focused checkpoints
Use small, coherent Conventional Commits for each milestone or sub-milestone.

### 6. Run regression checks after meaningful refactors
Use `REGRESSION-CHECKLIST-V2.md` after changes that affect scope boundaries, command wiring, adapters, runner/task modules, or `index.ts` execution flow.

---

## Definition of done for the refactor

The refactor is considered complete when all of the following are true:

- execution orchestration decisions live under `v2/`
- task success/failure/review/diagnostic flows are helper-driven
- `index.ts` is mostly command/session/UI glue
- restart/resume/approval/human-intervention behavior remains durable and coherent
- no major contradictory status paths remain between in-memory and authoritative state
- docs accurately describe the final code structure

---

## Immediate next step

**Next working step:**
Run live `/forge` regression smoke checks in a safe workspace and fix any behavior gaps found during real command execution.

Implementation-side roadmap milestones are complete; the next meaningful step is runtime validation.
