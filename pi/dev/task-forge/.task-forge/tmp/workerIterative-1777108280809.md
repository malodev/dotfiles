# Task
T12 — Build comprehensive replay and regression determinism suite

## Description
Add end-to-end replay-driven test coverage for all command flows and required regressions to prove deterministic behavior and V2-only authority after restart.

## Acceptance Criteria
- All must-have regression scenarios from requirements are codified and passing.
- Replay determinism validated across major command flows.
- Tests explicitly assert V2-only authority assumptions.

## Artifact Context
### 01-requirements.md
# 01-requirements.md

## Executive Summary

TaskForge must complete its migration to a V2-only runtime model based on event sourcing.

The product currently operates with a hybrid runtime that can consult multiple incompatible state representations, including V2 events, V2 derived snapshots, V1-compatible runtime state, session-restored state, mutable in-memory command state, and `state.json`. This creates contradictory command behavior, especially around execution, resume, and blocker resolution.

The intended end state is:

```text
/forge command -> V2 command service -> V2 events -> derived snapshot -> render output
```

TaskForge is for users and operators of the TaskForge extension who rely on `/forge` commands to execute plans, recover from blockers, resume interrupted work, inspect status, and manage runtime configuration.

This migration matters because V2 must become the only authoritative runtime architecture. Eliminating V1 command authority should reduce stuck states, improve replayability, make behavior deterministic after restart, simplify mental models for implementers, and prevent users from needing manual JSON edits to recover common blocker scenarios.

---

## Core Objectives

1. **Make V2 the only authoritative runtime model**
   - `events.jsonl` must be the source of truth.
   - `state.json` must be derived/debug-only.
   - Session memory must be advisory only.
   - V1 runtime state must not drive command decisions.

2. **Eliminate contradictory command outcomes caused by hybrid state**
   - `/forge execute`, `/forge resume`, `/forge blocker`, and `/forge status` must make decisions from V2 snapshots only.
   - Runtime behavior must be deterministic after replay and restart.

3. **Centralize transition and gating semantics**
   - Runtime state transitions must be governed by a dedicated V2 transition policy.
   - Execution, resume, blocker resolution, pause, and abort eligibility must share the same policy logic.

4. **Move command behavior into V2 command services**
   - Command services must be unit-testable without the pi runtime.
   - `index.ts` must become a thin extension shell that parses commands, delegates to V2 command services, appends events, and renders results.

5. **Remove or quarantine V1 runtime code**
   - V1 compatibility code must be deleted from runtime paths or moved into explicit one-time migration/import modules.
   - Historical V1 documentation must be clearly separated from current V2 documentation.

6. **Harden validation and operational evidence handling**
   - Unsafe validation command shapes must be rejected before execution.
   - Deno must not be accepted as an active TaskForge test/check engine.
   - Noisy evidence must be summarized for users while full logs remain preserved in artifacts.

7. **Improve documentation and drift control**
   - Documentation must describe V2 as the only current runtime architecture.
   - Event documentation, config examples, and architecture references must stay aligned with implementation.

---

## User Stories

### Primary Users

#### TaskForge Operator / End User

- As a TaskForge user, I want `/forge status` to reflect the V2 event log-derived state so that status remains accurate after restart.
- As a TaskForge user, I want `/forge execute` to determine executability from V2 state only so that I do not get stuck because of stale V1 state.
- As a TaskForge user, I want `/forge resume` to use the same transition rules as `/forge execute` so that recovery behavior is predictable.
- As a TaskForge user, I want `/forge blocker` commands to resolve, retry, patch, or unblock tasks through events so that fixes are durable and replayable.
- As a TaskForge user, I want common blocker fixes to work without manually editing JSON files so that I can recover safely through supported commands.
- As a TaskForge user, I want validation failures to produce concise actionable messages so that I can understand what to fix without reading noisy compiler output.
- As a TaskForge user, I want invalid validation commands to be rejected before execution so that TaskForge does not waste time or produce misleading gate reviews.

#### TaskForge Implementer / Maintainer

- As a TaskForge maintainer, I want command logic isolated into V2 command services so that each command can be unit tested without the pi runtime.
- As a TaskForge maintainer, I want all status gating rules centralized in `v2/transition-policy.ts` so that command behavior cannot drift across handlers.
- As a TaskForge maintainer, I want `index.ts` to avoid owning orchestration semantics so that the extension shell remains easy to reason about.
- As a TaskForge maintainer, I want V1 runtime helpers removed or quarantined so that future changes do not accidentally reintroduce hybrid authority.
- As a TaskForge maintainer, I want documentation and drift checks so that implementation, event definitions, and config examples remain aligned.

### Secondary Users

#### Future Migration / Support Engineer

- As a support engineer, I want legacy state import to be one-way and explicit so that old state can be migrated without keeping V1 alive at runtime.
- As a support engineer, I want historical V1 docs preserved under a clearly marked history location so that old behavior can be understood without confusing current architecture.
- As a support engineer, I want full logs preserved in artifacts while user-facing messages stay concise so that debugging remains possible without degrading UX.

#### Planner / Architecture Agent

- As a planning agent, I want a clear V2-only requirements baseline so that future design and implementation work does not preserve V1 as an active runtime path.
- As a planning agent, I want explicit ambiguity and risk callouts so that design decisions can be made deliberately rather than hidden inside implementation.

---

## Functional Requirements

### 1. V2 Runtime Authority

- **must** Treat `events.jsonl` as the source of truth for durable TaskForge runtime state.
- **must** Treat `state.json` as a derived/debug snapshot only.
- **must** Derive runtime snapshots from replay rather than manual mutation.
- **must** Ensure command decisions read only V2 snapshots.
- **must** Ensure command effects append V2 events.
- **must** Ensure session memory is never authoritative.
- **must** Remove V1 runtime state as command authority.
- **must** Allow migration from legacy state only at startup/import time.
- **should** Make the V2-only model explicit in top-level documentation.
- **could** Preserve historical V1 context under clearly marked historical documentation.

### 2. Thin Extension Shell

- **must** Refactor `index.ts` toward a thin pi integration shell.
- **must** Prevent `index.ts` from owning orchestration semantics.
- **must** Have `index.ts` parse commands, delegate behavior, append events as directed, and render command results.
- **should** Keep pi-runtime-specific concerns outside V2 command services.
- **should** Make command services callable by existing handlers during migration without changing user-facing command names.

### 3. V2 Command Services

- **must** Create V2 command modules for:
  - `v2/commands/status.ts`
  - `v2/commands/execute.ts`
  - `v2/commands/resume.ts`
  - `v2/commands/blocker.ts`
  - `v2/commands/pause.ts`
  - `v2/commands/abort.ts`
  - `v2/commands/cost.ts`
  - `v2/commands/models.ts`
  - `v2/commands/config.ts`
- **must** Ensure each command service accepts a V2 snapshot and relevant config/input.
- **must** Ensure each command service returns a structured command result.
- **must** Ensure each command service declares events to append.
- **must** Avoid direct UI/rendering concerns inside command services.
- **must** Make command services unit-testable without the pi runtime.
- **should** Use a common result shape similar to:

```ts
interface CommandResult {
  ok: boolean;
  level: "info" | "warning" | "success" | "error";
  message: string;
  events?: ForgeEvent[];
  snapshotHint?: RunSnapshot;
}
```

### 4. Transition Policy

- **must** Create `v2/transition-policy.ts`.
- **must** Centralize status gating and transition semantics in the transition policy.
- **must** Provide transition policy functions for:
  - `canExecute(snapshot)`
  - `canResume(snapshot)`
  - `canPause(snapshot)`
  - `canAbort(snapshot)`
  - `canResolveBlocker(snapshot, taskId)`
  - `planRetryEvents(snapshot, taskId)`
  - `planPatchValidationEvents(snapshot, taskId, command)`
- **must** Ensure `/forge execute`, `/forge resume`, and `/forge blocker` use the same transition policy.
- **must** Cover key states in tests:
  - awaiting approval
  - executing with no running tasks
  - needs human intervention
  - patched human-intervention task
  - failed run
  - paused run
  - completed run
  - aborted run
- **should** Make policy outputs structured enough for command services to generate deterministic results.

### 5. `/forge status`

- **must** Make `/forge status` derive output purely from the V2 snapshot.
- **must** Remove any V1 status fallback from the runtime path, except explicit legacy migration import if needed.
- **must** Use V2 status summary/root blocker rendering.
- **must** Remove V1 blocker sorting from runtime status behavior.
- **must** Ensure `/forge status` does not require V1-shaped state.
- **must** Ensure status output after restart from event replay matches status before restart.
- **must** Test root blocker output.
- **must** Test no-blocker states.
- **should** Preserve user-facing command behavior unless behavior was previously wrong due to hybrid state.

### 6. `/forge execute`

- **must** Make `/forge execute` read only the V2 snapshot.
- **must** Make `/forge execute` use `v2/transition-policy.ts`.
- **must** Make `/forge execute` append V2 events only.
- **must** Ensure the execution loop uses V2 scheduling facts only.
- **must** Ensure a `needs_human_intervention` state cannot be treated inconsistently as both non-runnable and resumable.
- **must** Ensure valid blocker resolution can make execution available deterministically.
- **must** Avoid direct mutation of V1 state.
- **should** Support recovery where an `executing` run has no running tasks but has ready tasks.

### 7. `/forge resume`

- **must** Make `/forge resume` read only the V2 snapshot.
- **must** Make `/forge resume` use `v2/transition-policy.ts`.
- **must** Make `/forge resume` append V2 events only.
- **must** Ensure resume behavior is consistent with execute behavior.
- **must** Avoid direct mutation of V1 state.
- **must** Prevent hybrid-state mismatch from blocking valid resume or execute paths.

### 8. `/forge blocker`

- **must** Implement V2-only behavior for:
  - `/forge blocker`
  - `/forge blocker <id>`
  - `/forge blocker <id> --resolve "..."`
  - `/forge blocker <id> --retry`
  - `/forge blocker <id> --force-unblock`
  - `/forge blocker <id> --patch-validation "..."`
  - `/forge blocker --list --json`
- **must** Represent durable blocker-related changes as V2 events.
- **must** Support events including, where applicable:
  - `task_contract_patched`
  - `human_intervention_resolved`
  - `task_requeued`
  - `approval_required`
  - `approval_granted`
- **must** Ensure blocker commands never depend on V1 task state.
- **must** Ensure patching validation clears active human intervention when appropriate.
- **must** Ensure retrying an actionable human-gated task can move the run back to executable state.
- **must** Ensure dependency unblock cascade is event-backed and replayable.
- **must** Support replayable resolution of failed dependencies and downstream dependency blockers.
- **should** Provide JSON list output that reflects the same V2-derived blocker state as human-readable output.

### 9. Remaining Commands

- **must** Flip the following commands to V2-only behavior:
  - `/forge pause`
  - `/forge abort`
  - `/forge cost`
  - `/forge models`
  - `/forge config`
  - `/forge help`
- **must** Ensure no command handler depends on V1 runtime state.
- **must** Ensure durable effects from these commands are represented by V2 events where they modify runtime state.
- **should** Keep read-only commands side-effect free unless explicit state changes are required.
- **should** Delegate command-specific logic from `index.ts` to V2 command services.

### 10. V1 Runtime Removal / Quarantine

- **must** Delete or quarantine runtime V1 code after V2 command paths are active.
- **must** Remove runtime dependencies on:
  - `ForgeState` in command handlers
  - `createV1StateFromV2`
  - `applyAuthoritativeSnapshotToV1`
  - `taskListFromAuthoritative`
  - V1 `statusLabel`
  - `v1-status-helpers.ts`
  - session-entry restore as an authoritative path
  - V1 blocker sorting runtime path
  - V1 status rendering
  - V1-derived task list helpers
- **must** Keep V1 code only if needed for one-way legacy migration/import.
- **must** Make legacy state import explicit and non-authoritative after import.
- **must** Ensure runtime code has no V1 command authority.
- **should** Add comments/TODOs early to identify deletion targets.
- **should** Mark V1 bridge helpers as deprecated internally during freeze.
- **could** Move historical V1 docs under `docs/history/`.

### 11. Legacy Migration

- **must** Support legacy import only if legacy state migration is required.
- **must** Ensure legacy import is one-way.
- **must** Ensure V2 owns state after legacy import.
- **must** Prevent imported legacy state from remaining an active runtime authority.
- **must** Test that legacy state import works once and then V2 owns state.
- **should** Place migration behavior in `v2/migrate.ts` or an equivalently explicit migration-only module.

### 12. Validation and Evidence Handling

- **must** Reject unsafe validation command shapes before execution.
- **must** Reject bare `npx tsc --noEmit` with concise guidance.
- **must** Enforce Node-only test command policy.
- **must** Reject Deno test/check commands in active TaskForge paths.
- **must** Prevent invalid validation commands from reaching worker/gate review.
- **must** Summarize noisy evidence in human-facing output.
- **must** Preserve full logs in artifacts.
- **must** Prevent long compiler help output from being pasted into user-facing intervention messages.
- **should** Provide actionable rejection messages that explain valid command shapes.
- **could** Add configurable allowlists for safe validation commands if compatible with the Node-only policy.

### 13. Documentation and Drift Control

- **must** Add `EVENTS.md`.
- **must** Update `README.md` to state V2-only runtime.
- **must** Move or clearly mark historical V1 docs under `docs/history/`.
- **must** Ensure top-level docs describe only current V2 runtime.
- **must** Add drift checks for:
  - no active Deno references
  - architecture event list matching `events.ts`
  - config example staying aligned with `task-forge.json`
- **must** Clearly mark historical docs as historical.
- **should** Update operator docs/runbook to reflect V2-only runtime behavior.
- **should** Ensure `ARCHITECTURE-V2.md`, `README.md`, and `docs/operations/runbook.md` do not contradict each other.

### 14. Testing Requirements

- **must** Test that V2 replay reconstructs status after every command flow.
- **must** Test that execute/resume/blocker use the same transition policy.
- **must** Test that human intervention resolution is event-backed.
- **must** Test validation patch -> retry -> execute flow.
- **must** Test dependency blocker cascade replayability.
- **must** Test legacy state import once, followed by V2 ownership.
- **must** Test regression scenario: `needs_human_intervention` + patched task + no blockers -> executable.
- **must** Test regression scenario: `executing` with no running tasks and ready tasks -> execution can continue/recover.
- **must** Test regression scenario: failed dependency gets requeued -> downstream dependency blockers clear.
- **must** Test regression scenario: invalid validation command never reaches worker/gate review.
- **should** Add unit tests for each V2 command service.
- **should** Add tests proving status before restart equals status after event replay.
- **should** Add tests proving no command requires V1-shaped runtime state.

---

## Non-Functional Requirements

### Performance

- **must** Keep command decision latency practical for interactive `/forge` usage.
- **must** Ensure V2 snapshot derivation and event replay are efficient enough for normal TaskForge runs.
- **should** Avoid unnecessary full replay in paths where a current derived snapshot is already available and trusted as derived/debug state.
- **should** Keep user-facing evidence summaries concise to avoid overwhelming command output.
- **could** Introduce replay or snapshot performance benchmarks if event logs become large.

### Security

- **must** Reject unsafe validation command shapes before execution.
- **must** Prevent unsupported Deno commands from being executed in active TaskForge paths.
- **must** Enforce Node-only test/check command policy.
- **must** Avoid executing raw or ambiguous validation commands that can produce misleading or unsafe behavior.
- **should** Preserve full logs in artifacts without exposing unnecessary sensitive content in user-facing messages.
- **should** Treat user-provided blocker resolution and validation patch text as input requiring validation before being turned into events or commands.

### Reliability

- **must** Ensure all durable effects are captured as V2 events.
- **must** Ensure derived state can be reconstructed from `events.jsonl`.
- **must** Ensure status after restart matches status before restart.
- **must** Ensure blocker fixes are replayable and do not require manual JSON editing.
- **must** Avoid direct runtime mutation of V1 or derived state as an authority source.
- **must** Make dependency unblock cascades event-backed and replayable.
- **should** Maintain deterministic command outcomes for identical snapshots and inputs.
- **should** Ensure migration from legacy state is idempotent or protected against accidental repeated imports.

### Scalability

- **must** Avoid adding new V1 compatibility layers that increase runtime state model count.
- **must** Keep command services modular enough to support future commands without modifying `index.ts` orchestration semantics.
- **should** Ensure event definitions and drift checks scale with additional event types.
- **should** Preserve a single mental model for future maintainers: V2 events -> derived snapshot -> command result/rendering.

### Accessibility

- **must** Keep human-facing output concise and understandable.
- **must** Avoid dumping long compiler help output into intervention messages.
- **should** Use clear status levels such as `info`, `warning`, `success`, and `error` in command results.
- **should** Ensure messages distinguish actionable states from informational states.
- **should** Provide JSON output for blocker listing through `/forge blocker --list --json` for machine-readable consumption.

### Compliance

- No explicit legal, regulatory, privacy, or industry compliance requirements are specified in the PRD.
- **must** Comply with the project’s stated runtime policy that Deno is not supported as the active TaskForge test engine.
- **should** Preserve auditability of runtime changes through the V2 event log.

---

## UI / UX Constraints and Design System Requirements

The PRD does not specify a graphical UI kit, component catalog, visual design system, typography scale, color palette, spacing system, or dashboard UI. It explicitly lists adding a dashboard/UI as a non-goal.

However, it does define command-line UX, rendering, interaction, and output requirements that must be treated as first-class product requirements.

### Hard UX Constraints

- **must** Preserve existing user-facing `/forge` command names while migrating runtime internals.
- **must** Render command results from V2-derived snapshots, not V1 state.
- **must** Keep V2 command services free of direct UI concerns.
- **must** Keep `index.ts` responsible for command parsing and rendering integration rather than business semantics.
- **must** Use structured command result fields sufficient for rendering:
  - `ok`
  - `level`
  - `message`
  - optional `events`
  - optional `snapshotHint`
- **must** Use result levels compatible with:
  - `info`
  - `warning`
  - `success`
  - `error`
- **must** Keep human-facing intervention messages concise.
- **must** Summarize noisy evidence instead of pasting long raw compiler output into user-facing messages.
- **must** Preserve full logs in artifacts for debugging.
- **must** Provide `/forge blocker --list --json` output for machine-readable blocker inspection.
- **must** Ensure `/forge status` output after restart is identical to output before restart when derived from the same events.
- **must** Ensure root blocker and no-blocker states are rendered correctly.
- **must** Reject unsupported validation command shapes with concise guidance.
- **must** Reject bare `npx tsc --noEmit` with concise guidance.
- **must** Reject Deno test/check commands in active TaskForge paths.

### Command Interaction Requirements

- `/forge execute`
  - **must** clearly communicate whether execution can proceed.
  - **must** avoid contradictory messaging around `needs_human_intervention`.

- `/forge resume`
  - **must** use the same underlying transition semantics as execute.
  - **must** avoid telling users a run is both non-executable and non-resumable due to hybrid state.

- `/forge blocker`
  - **must** support inspection, resolution, retry, force-unblock, validation patching, and JSON listing.
  - **must** communicate when patching validation clears active human intervention.
  - **must** communicate when retrying a task makes execution available.

- `/forge status`
  - **must** render from V2 snapshot only.
  - **must** represent root blockers consistently.
  - **must** correctly represent no-blocker states.

### Soft UX / Implementation Sequencing Notes

- **should** Keep user-facing command behavior stable while internal command handlers are flipped to V2-only.
- **should** Minimize visible disruption during incremental migration phases.
- **should** Improve clarity of blocker recovery messages as part of V2-only behavior.
- **could** Introduce richer structured rendering later, provided command services remain UI-agnostic.

### Explicit UI Non-Goals

- **must not** add a dashboard/UI as part of this migration.
- **must not** replace the agent prompt system as part of this migration.
- **must not** fully automate plan rewrites without human confirmation as part of this migration.

---

## Constraints and Assumptions

### Technical Constraints

- TaskForge must use the V2 event-sourced architecture as authoritative.
- `events.jsonl` is the durable source of truth.
- `state.json` is derived/debug-only.
- V2 snapshots must be derived from replay, not manual mutation.
- Command decisions must not consult V1 runtime state.
- Command effects must be represented as V2 events.
- Session memory must not become authoritative.
- `index.ts` must become a thin pi extension shell.
- V1 compatibility code may exist only as explicit migration-only code, if needed.
- Active TaskForge validation/test paths must be Node-only.
- Deno is not supported as the TaskForge test engine.
- Existing core V2 files are required implementation context:
  - `v2/events.ts`
  - `v2/derive.ts`
  - `v2/storage.ts`
  - `v2/engine.ts`
  - `v2/execution.ts`
  - `v2/validation.ts`
  - `v2/preflight.ts`
- Existing architecture/operator docs are required implementation context:
  - `ARCHITECTURE-V2.md`
  - `README.md`
  - `docs/operations/runbook.md`
- Existing runtime configuration is required implementation context:
  - `task-forge.json`

### Business Constraints

- The migration should remove V1 runtime paths as quickly and safely as practical.
- The fastest clean direction is preferred over continued hybrid compatibility.
- V1 should not continue receiving behavioral improvements.
- User-facing commands should remain recognizable and continue to support existing workflows.
- Common blocker fixes must not require manual JSON editing.
- Historical V1 context may be preserved, but current docs must describe V2-only runtime.

### Timeline / Sequencing Constraints

- V1 runtime paths should be frozen immediately.
- The PRD defines a phased migration from freeze through docs/drift hardening.
- A minimal fast path is permitted if speed is prioritized:
  1. `transition-policy.ts`
  2. V2-only `/forge execute`
  3. V2-only `/forge resume`
  4. V2-only `/forge blocker`
  5. V2-only `/forge status`
  6. Delete V1 runtime helpers
  7. Harden validation and docs after

### Operational Assumptions

- Assumption: Existing `/forge` commands are already exposed through `index.ts`.
- Assumption: Existing V2 architecture files contain enough primitives to support command services and replay-derived snapshots.
- Assumption: Current codebase contains V1 compatibility helpers named in the PRD.
- Assumption: Event append and snapshot derivation mechanisms already exist or can be extended from `v2/storage.ts`, `v2/events.ts`, and `v2/derive.ts`.
- Assumption: Unit and regression test infrastructure exists or can be added without changing product behavior.
- Assumption: The phrase “pi runtime” refers to the extension host/runtime integration layer around `index.ts`.
- Assumption: Existing codebase file tree was not provided in this requirements input, so conflicts with current implementation shape cannot be verified here.

---

## Success Metrics

### KPIs

- **100% of user commands make decisions from V2 snapshots**
  - Includes status, execute, resume, blocker, pause, abort, cost, models, config, and help.

- **100% of durable command effects are represented as V2 events**
  - No durable effect should rely on manual mutation of V1 state, `state.json`, or session memory.

- **0 runtime command dependencies on V1 authoritative state**
  - V1 helpers are deleted or migration-only.

- **Status replay consistency**
  - Status after restart must match status before restart for the same event log.

- **Blocker recovery success**
  - Common blocker fixes can be completed through `/forge blocker` commands without manual JSON editing.

- **Validation safety**
  - Invalid validation commands are rejected before worker/gate review.
  - Bare `npx tsc --noEmit` is rejected with concise guidance.
  - Deno test/check commands are rejected in active TaskForge paths.

- **Documentation alignment**
  - Top-level docs describe only V2 runtime.
  - Event documentation matches `events.ts`.
  - Config examples match `task-forge.json`.
  - Active docs contain no Deno test/check references.

### Acceptance Signals

- `/forge status` does not require V1-shaped state.
- `/forge execute` and `/forge resume` produce deterministic decisions from the same V2 transition policy.
- `needs_human_intervention` + patched task + no blockers becomes executable.
- `executing` with no running tasks and ready tasks can continue or recover.
- Failed dependency requeue clears downstream dependency blockers through replayable events.
- Dependency unblock cascade is event-backed and replayable.
- Legacy import works once, then V2 owns runtime state.
- `index.ts` mostly delegates to V2 command services.
- V1 command authority is absent from runtime code.
- Historical docs are clearly marked historical.
- CI/local drift checks catch common event/config/doc drift.

### Observable Outcomes

- Users no longer encounter contradictory messages such as:
  - execute cannot execute
  - resume not resumable
  - while patched human-intervention task has no blockers
- Restarting TaskForge does not change visible status for the same event log.
- Command services can be tested without pi runtime integration.
- Full diagnostic logs are available in artifacts while user-facing output remains concise.
- The codebase presents one runtime mental model: V2 events -> derived snapshot -> command result -> render output.

---

## Risks and Dependencies

### Technical Risks

- **Hybrid authority leakage**
  - Risk: Some command path may continue consulting V1-shaped state or session-restored state.
  - Impact: Contradictory behavior and stuck states can persist.
  - Mitigation: Tests proving no command requires V1-shaped runtime state; delete or quarantine V1 helpers.

- **Incomplete transition policy**
  - Risk: Transition semantics may remain duplicated or under-specified.
  - Impact: Execute/resume/blocker decisions can drift.
  - Mitigation: Centralize all gating in `v2/transition-policy.ts` and require regression tests.

- **Replay inconsistency**
  - Risk: Events may not fully capture all durable state changes.
  - Impact: Status after restart may differ from status before restart.
  - Mitigation: Replay reconstruction tests after every command flow.

- **Migration import ambiguity**
  - Risk: Legacy import may accidentally remain authoritative or run repeatedly.
  - Impact: V2 source-of-truth guarantees weaken.
  - Mitigation: Make migration one-way, explicit, and tested.

- **Validation hardening false positives**
  - Risk: Safe commands may be rejected if command-shape policy is too narrow.
  - Impact: Users may need to adjust workflows.
  - Mitigation: Provide concise guidance and clearly document allowed Node-only commands.

- **Evidence summarization loss**
  - Risk: Summaries may omit details needed for debugging.
  - Impact: Harder support/debugging.
  - Mitigation: Preserve full logs in artifacts.

### Product Risks

- **User workflow disruption**
  - Risk: V2-only command behavior may differ from hybrid-era behavior.
  - Impact: Users may perceive regressions.
  - Mitigation: Preserve command names and improve messages around changed behavior.

- **Unclear blocker semantics**
  - Risk: “Resolve,” “retry,” “force-unblock,” and “patch-validation” behavior may be interpreted differently by users and implementers.
  - Impact: Incorrect event planning or confusing outcomes.
  - Mitigation: Define transition policy and command result semantics explicitly.

- **Overcorrection toward deletion**
  - Risk: Deleting V1 helpers before migration support is sufficient may strand users with legacy state.
  - Impact: Existing users may lose recovery path.
  - Mitigation: Keep explicit one-way migration-only support if needed.

### Third-Party Dependency Risks

- **Node tooling dependency**
  - Risk: Validation hardening depends on Node tooling behavior and command conventions.
  - Impact: Changes in tools such as `npx` or TypeScript may affect validation guidance.
  - Mitigation: Test command-shape policy and document accepted forms.

- **pi runtime integration**
  - Risk: V2 command services must integrate cleanly with the existing pi extension shell.
  - Impact: Refactor could introduce integration bugs even if services are unit-tested.
  - Mitigation: Keep `index.ts` thin but covered by integration tests where possible.

- **File-based persistence**
  - Risk: Event log and derived snapshot storage behavior depends on existing storage implementation.
  - Impact: Append/replay bugs could corrupt runtime state.
  - Mitigation: Test append, replay, restart, and derived snapshot consistency.

### Organizational Risks

- **Documentation drift**
  - Risk: Historical V1 docs may continue to influence implementation.
  - Impact: Future changes may reintroduce V1 assumptions.
  - Mitigation: Move historical docs under `docs/history/` and add drift checks.

- **Incomplete context reading**
  - Risk: Implementers may skip required architecture/operator docs.
  - Impact: Design may conflict with V2 architecture.
  - Mitigation: Treat required context files as implementation prerequisites.

- **Scope creep**
  - Risk: Migration could expand into dashboards, prompt-system replacement, or model-tier redesign.
  - Impact: Slower migration and higher risk.
  - Mitigation: Enforce non-goals.

---

## Ambiguities and Open Questions

1. **Exact V2 snapshot shape**
   - What is the definitive `RunSnapshot` structure command services should consume?
   - Which fields are guaranteed by `v2/derive.ts`?

2. **Command result contract**
   - Is the example `CommandResult` shape mandatory, or can command-specific result payloads extend it?
   - Should command results include machine-readable codes in addition to `level` and `message`?

3. **Event taxonomy**
   - Are the listed blocker events already defined in `v2/events.ts`, or do new events need to be introduced?
   - What is the canonical event schema for `task_contract_patched`, `human_intervention_resolved`, `task_requeued`, `approval_required`, and `approval_granted`?

4. **Transition policy semantics**
   - What exact conditions define `canExecute`, `canResume`, `canPause`, and `canAbort`?
   - What distinguishes “resume” from “execute” after V2-only migration?
   - What should happen when a run is `executing` but has no running tasks and no ready tasks?

5. **Human intervention resolution**
   - When exactly is patching validation sufficient to clear active human intervention?
   - Does every validation patch require approval, or only specific patch types?
   - What makes a human-gated task “actionable”?

6. **Force-unblock semantics**
   - What durable events should `/forge blocker <id> --force-unblock` append?
   - What safety checks should prevent invalid force-unblock operations?

7. **Approval flow**
   - How should `approval_required` and `approval_granted` interact with retry, validation patching, and execution?
   - Are approvals task-scoped, run-scoped, or command-scoped?

8. **Dependency unblock cascade**
   - What is the exact algorithm for cascading dependency blocker resolution?
   - Which events should represent downstream unblock effects?
   - Should cascades be planned as multiple explicit events or derived from upstream event state?

9. **Legacy migration trigger**
   - When should legacy import run?
   - How should the system detect legacy state that has already been imported?
   - What should happen if both legacy state and V2 events exist?

10. **State file behavior**
    - When and how should `state.json` be regenerated?
    - Should command handlers ever read `state.json`, or only the derived snapshot from replay/storage APIs?

11. **Session memory**
    - What session data remains useful as advisory context?
    - How should the system prevent session memory from influencing authoritative command decisions?

12. **Validation command policy**
    - What exact Node validation commands are allowed?
    - Why is bare `npx tsc --noEmit` unsafe in this context, and what replacement guidance should be shown?
    - Should package-manager-specific commands such as `npm test`, `npm run typecheck`, `pnpm test`, or `yarn test` be allowed?

13. **Deno drift checks**
    - Should all Deno references be banned, or only active runtime/test/check references?
    - Are historical docs allowed to mention Deno if clearly marked historical?

14. **Documentation ownership**
    - Which file is canonical for event definitions: `events.ts`, `EVENTS.md`, or `ARCHITECTURE-V2.md`?
    - What drift check should fail when these disagree?

15. **Testing infrastructure**
    - What test framework should be used?
    - Are existing tests available, or must a new test harness be introduced?
    - Should replay tests operate through command services only, or through the full `index.ts` integration layer?

16. **Existing codebase conflicts**
    - The provided existing codebase file tree is listed as “none,” so current file locations and helper names could not be verified from the prompt.
    - Do the named files and helpers exist exactly as listed?
    - Are there additional V1 runtime paths not named in the PRD?

17. **Minimal fast path decision**
    - Should implementation follow the full phased migration or the minimal fast path?
    - Who decides when speed outweighs incremental safety?

18. **Non-goal boundaries**
    - Does “not replacing model tier configuration” mean `/forge models` should remain behaviorally identical except for V2 command-service delegation?
    - Does “not replacing the agent prompt system” restrict changes to prompt-related artifacts under `agents/*.md`?

19. **Error handling**
    - How should command services represent partial failure after event planning but before append?
    - What should happen if event append succeeds but rendering fails?
    - Should command results support recoverable vs terminal error classification?

20. **Concurrency**
    - Are concurrent `/forge` commands possible?
    - If yes, what locking or optimistic concurrency behavior is required for `events.jsonl` appends and snapshot derivation?

## Test Spec
{
  "taskId": "T12",
  "testFiles": [
    {
      "path": "tests/integration/replay-regression-suite.test.ts",
      "type": "integration",
      "targets": [
        "v2/derive.ts",
        "v2/storage.ts",
        "v2/transition-policy.ts",
        "v2/commands/execute.ts",
        "v2/commands/resume.ts",
        "v2/commands/blocker.ts",
        "v2/commands/status.ts"
      ],
      "fixtures_required": [
        "temp_dir"
      ],
      "derived_from": [
        "requirement.FR-14",
        "requirement.FR-14.regression: patched human intervention -> executable",
        "requirement.FR-14.regression: executing with no running tasks and ready tasks -> recovery",
        "requirement.FR-14.regression: failed dependency requeue clears downstream blockers",
        "requirement.FR-14.regression: invalid validation command never reaches worker/gate review"
      ]
    }
  ],
  "validation": {
    "mode": "command",
    "command": "npx tsc --noEmit tests/integration/replay-regression-suite.test.ts && node --test --experimental-strip-types tests/integration/replay-regression-suite.test.ts"
  },
  "acceptance_signal": "npx tsc --noEmit tests/integration/replay-regression-suite.test.ts && node --test --experimental-strip-types tests/integration/replay-regression-suite.test.ts",
  "ambiguities": [
    "The dependency cascade auto-unblock behavior is not yet implemented in v2/derive.ts, so the 'failed dependency requeue clears downstream dependency blockers' test fails as expected. The implementation must add cascade resolution logic to make this test pass."
  ]
}

## Codebase Files
### v2/events.ts
import type { Blocker, ForgeTask, NextAction, RunPhase, RunSnapshot, TaskRuntimeState, TestSpecEntry, TddPhase } from "./types.ts";

export type ForgeEvent =
  | { type: "run_created"; at: string; orchestrationId: string; prdFile: string }
  | { type: "run_restored"; at: string; orchestrationId: string; reason: string }
  | { type: "phase_entered"; at: string; phase: RunPhase; label: string }
  | { type: "planning_phase_started"; at: string; role: import("./types.ts").Role; phase: RunPhase; phaseLabel: string }
  | { type: "planning_phase_completed"; at: string; role: import("./types.ts").Role; phase: RunPhase }
  | { type: "planning_phase_interrupted"; at: string; role: import("./types.ts").Role | null; phase: RunPhase }
  | { type: "routing_decided"; at: string; mode: "micro" | "standard" | "complex"; rationale?: string }
  | { type: "approval_required"; at: string; nextAction: NextAction; label: string }
  | { type: "approval_granted"; at: string; nextAction?: NextAction }
  | { type: "run_paused"; at: string; label: string; nextAction: NextAction; reason?: string }
  | { type: "run_resumed"; at: string; reason?: string }
  | { type: "requirements_written"; at: string; file: string }
  | { type: "plan_written"; at: string; planFile: string; tasksFile?: string; tasksMarkdownFile?: string; costFile?: string }
  | { type: "test_spec_written"; at: string; file: string; markdownFile?: string; specs: TestSpecEntry[] }
  | { type: "tasks_registered"; at: string; tasks: ForgeTask[] }
  | { type: "task_ready"; at: string; taskId: string }
  | { type: "task_started"; at: string; taskId: string; runAttempt: number; model?: string; pidHint?: number; watchdogDeadlineAt?: string }
  | { type: "task_heartbeat"; at: string; taskId: string; watchdogDeadlineAt?: string }
  | { type: "task_runtime_updated"; at: string; taskId: string; retries?: number; error?: string | null; failureSignature?: string | null; stallWarnedAt?: string | null; diagnostic?: { classification: string; notes: string; blockerCategory?: import("./types.ts").BlockerCategory; remediationMode?: import("./types.ts").BlockerResolutionMode } | null; diagnosticCount?: number | null }
  | { type: "task_tdd_progress"; at: string; taskId: string; phase: TddPhase; iterationCount?: number; redEstablishedAt?: string; greenAchievedAt?: string; refactorValidatedAt?: string }
  | { type: "task_validation_failed"; at: string; taskId: string; error: string; output?: string; framework?: string }
  | { type: "task_validation_passed"; at: string; taskId: string; output?: string; framework?: string; coverage?: number }
  | { type: "task_blocked"; at: string; taskId: string; blocker: Blocker }
  | { type: "task_contract_patched"; at: string; taskId: string; patch: import("./blocker-resolution.ts").BlockerResolutionPatch; durabilityCommitRef: string }
  | { type: "test_spec_patched"; at: string; taskId: string; patch: import("./blocker-resolution.ts").BlockerResolutionPatch; durabilityCommitRef: string }
  | { type: "task_requeued"; at: string; taskId: string; reason: string; resolutionInstruction?: string }
  | { type: "task_gate_reviewed"; at: string; taskId: string; passed: boolean; notes: string }
  | { type: "task_completed"; at: string; taskId: string; result?: string }
  | { type: "task_failed"; at: string; taskId: string; error: string }
  | { type: "human_intervention_requested"; at: string; taskId: string; reason: string; suggestion: string }
  | { type: "human_intervention_resolved"; at: string; taskId: string; resolution: string; resolutionMode?: import("./types.ts").BlockerResolutionMode }
  | { type: "integration_review_started"; at: string }
  | { type: "integration_review_completed"; at: string; reviewFile: string }
  | { type: "run_aborted"; at: string; reason: string }
  | { type: "run_completed"; at: string }
  | { type: "run_failed"; at: string; reason: string };

export function isTaskTerminal(state: TaskRuntimeState | undefined) {
  return state ? ["completed", "blocked", "failed", "skipped"].includes(state.status) : false;
}

export function initSnapshot(orchestrationId: string, prdFile: string, at: string): RunSnapshot {
  return {
    schemaVersion: 4,
    orchestrationId,
    status: "planning",
    currentPhase: 0,
    phaseLabel: "Scope Classification",
    prdFile,
    resolvedModels: {},
    cost: {},
    tasks: [],
    taskState: {},
    blockers: [],
    supervisors: {},
    timestamps: {
      started: at,
      lastUpdated: at,
    },
  };
}


### v2/derive.ts
// @ts-nocheck
import type { Blocker, BlockerCategory, PlanningRuntimeState, RunSnapshot, RunStatus, TaskRuntimeState } from "./types.ts";
import type { ForgeEvent } from "./events.ts";
import { initSnapshot } from "./events.ts";
import { createBlocker, createRemediationRecord, normalizeBlocker } from "./blocker-model.ts";
import { selectBlockerResolutionMode } from "./blocker-resolution-mode.ts";
import { applyBlockerResolutionPatch, applyTestSpecResolutionPatch } from "./blocker-resolution.ts";

function ensureTaskState(snapshot: RunSnapshot, taskId: string): TaskRuntimeState {
  if (!snapshot.taskState[taskId]) {
    snapshot.taskState[taskId] = {
      taskId,
      status: "pending",
      retries: 0,
      runAttempt: 0,
    };
  }
  return snapshot.taskState[taskId];
}

function deriveStatus(snapshot: RunSnapshot): RunStatus {
  const states = Object.values(snapshot.taskState);
  const hasRunning = states.some((task) => task.status === "running");
  const hasReadyOrPending = states.some((task) => task.status === "ready" || task.status === "pending");
  const hasFailed = states.some((task) => task.status === "failed");
  const unresolvedBlockers = snapshot.blockers.filter((blocker) => !blocker.resolvedAt);
  const allDone = states.length > 0 && states.every((task) => ["completed", "skipped"].includes(task.status));

  if (snapshot.status === "aborted") return "aborted";
  if (snapshot.status === "completed") return "completed";
  if (snapshot.status === "paused") return "paused";
  if (snapshot.pendingHumanIntervention) return "needs_human_intervention";
  if (hasRunning) return "executing";
  if (snapshot.reviewFile) return "completed";
  if (snapshot.nextAction) return "awaiting_approval";
  if (allDone && snapshot.currentPhase >= 5) return "reviewing";
  if (unresolvedBlockers.length > 0) return "needs_human_intervention";
  if (hasReadyOrPending && snapshot.currentPhase >= 5) return "executing";
  if (snapshot.status === "failed" || hasFailed) return "failed";
  return "planning";
}

function clearPlanningRuntimeIfExecuting(snapshot: RunSnapshot): void {
  if (snapshot.currentPhase >= 5) {
    snapshot.planningRuntime = undefined;
  }
}

function ensurePlanningRuntime(snapshot: RunSnapshot, at: string, phase: PlanningRuntimeState["phase"]): PlanningRuntimeState {
  if (!snapshot.planningRuntime) {
    snapshot.planningRuntime = {
      activeRole: null,
      startedAt: at,
      phaseStartedAt: at,
      phase,
      interrupted: false,
    };
  }
  return snapshot.planningRuntime;
}

export function applyEvent(snapshot: RunSnapshot, event: ForgeEvent): RunSnapshot {
  snapshot.timestamps.lastUpdated = event.at;

  switch (event.type) {
    case "run_created":
      return initSnapshot(event.orchestrationId, event.prdFile, event.at);
    case "run_restored":
      return snapshot;
    case "phase_entered":
      snapshot.currentPhase = event.phase;
      snapshot.phaseLabel = event.label;
      clearPlanningRuntimeIfExecuting(snapshot);
      return snapshot;
    case "planning_phase_started": {
      const runtime = ensurePlanningRuntime(snapshot, event.at, event.phase);
      snapshot.phaseLabel = event.phaseLabel;
      runtime.activeRole = event.role;
      runtime.phase = event.phase;
      runtime.phaseStartedAt = event.at;
      runtime.interrupted = false;
      delete runtime.interruptedAt;
      return snapshot;
    }
    case "planning_phase_completed": {
      const runtime = ensurePlanningRuntime(snapshot, event.at, event.phase);
      runtime.activeRole = null;
      runtime.phase = event.phase;
      runtime.interrupted = false;
      delete runtime.interruptedAt;
      clearPlanningRuntimeIfExecuting(snapshot);
      return snapshot;
    }
    case "planning_phase_interrupted": {
      const runtime = ensurePlanningRuntime(snapshot, event.at, event.phase);
      runtime.activeRole = event.role;
      runtime.phase = event.phase;
      runtime.interrupted = true;
      runtime.interruptedAt = event.at;
      return snapshot;
    }
    case "routing_decided":
      snapshot.orchestrationMode = event.mode;
      snapshot.routingRationale = event.rationale;
      return snapshot;
    case "approval_required":
      snapshot.nextAction = event.nextAction;
      snapshot.phaseLabel = event.label;
      return snapshot;
    case "approval_granted":
      snapshot.nextAction = event.nextAction;
      return snapshot;
    case "run_paused":
      snapshot.status = "paused";
      snapshot.phaseLabel = event.label;
      snapshot.nextAction = event.nextAction;
      return snapshot;
    case "run_resumed":
      snapshot.status = "planning";
      snapshot.nextAction = undefined;
      return snapshot;
    case "requirements_written":
      snapshot.requirementsFile = event.file;
      return snapshot;
    case "plan_written":
      snapshot.planFile = event.planFile;
      snapshot.tasksFile = event.tasksFile;
      snapshot.tasksMarkdownFile = event.tasksMarkdownFile;
      snapshot.costFile = event.costFile;
      return snapshot;
    case "test_spec_written": {
      snapshot.testSpecFile = event.file;
      snapshot.testSpecMarkdownFile = event.markdownFile;

      const existingSpecs = snapshot.testSpecs ?? [];
      if (existingSpecs.length === 0) {
        snapshot.testSpecs = event.specs;
        return snapshot;
      }

      const merged = existingSpecs.map((entry) => event.specs.find((candidate) => candidate.taskId === entry.taskId) ?? entry);
      const additions = event.specs.filter((entry) => !existingSpecs.some((existing) => existing.taskId === entry.taskId));
      snapshot.testSpecs = [...merged, ...additions];
      return snapshot;
    }
    case "tasks_registered":
      snapshot.tasks = event.tasks;
      for (const task of event.tasks) ensureTaskState(snapshot, task.id);
      return snapshot;
    case "task_ready": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.status = "ready";
      return snapshot;
    }
    case "task_started": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.status = "running";
      task.startedAt = event.at;
      task.runAttempt = event.runAttempt;
      task.resolvedModel = event.model;
      task.lastHeartbeatAt = event.at;
      delete task.blocker;
      delete task.error;
      delete task.gateReview;
      delete task.stallWarnedAt;
      snapshot.supervisors[event.taskId] = {
        taskId: event.taskId,
        startedAt: event.at,
        lastHeartbeatAt: event.at,
        watchdogDeadlineAt: event.watchdogDeadlineAt ?? event.at,
        runAttempt: event.runAttempt,
        pidHint: event.pidHint,
      };
      return snapshot;
    }
    case "task_heartbeat": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.lastHeartbeatAt = event.at;
      if (snapshot.supervisors[event.taskId]) {
        snapshot.supervisors[event.taskId].lastHeartbeatAt = event.at;
        snapshot.supervisors[event.taskId].watchdogDeadlineAt = event.watchdogDeadlineAt ?? snapshot.supervisors[event.taskId].watchdogDeadlineAt;
      }
      return snapshot;
    }
    case "task_runtime_updated": {
      const task = ensureTaskState(snapshot, event.taskId);
      if (typeof event.retries === "number") task.retries = event.retries;
      if ("error" in event) {
        if (event.error == null) delete task.error;
        else task.error = event.error;
      }
      if ("failureSignature" in event) {
        if (event.failureSignature == null) delete task.failureSignature;
        else task.failureSignature = event.failureSignature;
      }
      if ("stallWarnedAt" in event) {
        if (event.stallWarnedAt == null) delete task.stallWarnedAt;
        else task.stallWarnedAt = event.stallWarnedAt;
      }
      if ("diagnostic" in event) {
        if (event.diagnostic == null) delete task.diagnostic;
        else task.diagnostic = event.diagnostic;
      }
      if ("diagnosticCount" in event) {
        if (event.diagnosticCount == null) delete task.diagnosticCount;
        else task.diagnosticCount = event.diagnosticCount;
      }
      return snapshot;
    }
    case "task_tdd_progress": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.tddPhase = event.phase;
      task.iterationCount = event.iterationCount ?? task.iterationCount;
      task.redEstablishedAt = event.redEstablishedAt ?? task.redEstablishedAt;
      task.greenAchievedAt = event.greenAchievedAt ?? task.greenAchievedAt;
      task.refactorValidatedAt = event.refactorValidatedAt ?? task.refactorValidatedAt;
      return snapshot;
    }
    case "task_validation_failed": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.error = event.error;
      task.validationOutput = event.output;
      task.validationFramework = event.framework;
      return snapshot;
    }
    case "task_validation_passed": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.validationOutput = event.output;
      task.validationFramework = event.framework;
      task.lastCoverage = event.coverage;
      return snapshot;
    }
    case "task_blocked": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.status = "blocked";
      task.blocker = normalizeBlocker(event.blocker);
      delete snapshot.supervisors[event.taskId];
      snapshot.blockers = [...snapshot.blockers.filter((b) => b.taskId !== event.taskId), task.blocker];
      return snapshot;
    }
    case "task_contract_patched": {
      const task = snapshot.tasks.find((entry) => entry.id === event.taskId);
      if (!task) {
        return snapshot;
      }

      const applied = applyBlockerResolutionPatch(event.taskId, task, snapshot.testSpecs, event.patch);
      snapshot.testSpecs = applied.testSpecs;

      const runtimeTask = snapshot.taskState[event.taskId];
      if (runtimeTask?.blocker?.remediation) {
        runtimeTask.blocker.remediation.durabilityCommitRef = event.durabilityCommitRef;
        runtimeTask.blocker.remediation.durabilityCommittedAt = event.at;
      }

      snapshot.blockers = snapshot.blockers.map((blocker) => {
        if (blocker.taskId !== event.taskId || !blocker.remediation) return blocker;
        return {
          ...blocker,
          remediation: {
            ...blocker.remediation,
            durabilityCommitRef: event.durabilityCommitRef,
            durabilityCommittedAt: event.at,
          },
        };
      });
      return snapshot;
    }
    case "test_spec_patched": {
      snapshot.testSpecs = applyTestSpecResolutionPatch(event.taskId, snapshot.testSpecs, event.patch);

      const runtimeTask = snapshot.taskState[event.taskId];
      if (runtimeTask?.blocker?.remediation) {
        runtimeTask.blocker.remediation.durabilityCommitRef = event.durabilityCommitRef;
        runtimeTask.blocker.remediation.durabilityCommittedAt = event.at;
      }

      snapshot.blockers = snapshot.blockers.map((blocker) => {
        if (blocker.taskId !== event.taskId || !blocker.remediation) return blocker;
        return {
          ...blocker,
          remediation: {
            ...blocker.remediation,
            durabilityCommitRef: event.durabilityCommitRef,
            durabilityCommittedAt: event.at,
          },
        };
      });
      return snapshot;
    }
    case "task_requeued": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.status = "pending";
      task.error = event.reason;
      if (event.resolutionInstruction) {
        task.resolutionInstruction = event.resolutionInstruction;
      }
      delete task.blocker;
      delete task.gateReview;
      delete task.stallWarnedAt;
      delete snapshot.supervisors[event.taskId];
      snapshot.blockers = snapshot.blockers.filter((b) => b.taskId !== event.taskId);
      return snapshot;
    }
    case "task_gate_reviewed": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.gateReview = { passed: event.passed, notes: event.notes 

### v2/storage.ts
// @ts-nocheck
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ForgeEvent } from "./events.ts";
import type { RunSnapshot } from "./types.ts";
import { replayEvents } from "./derive.ts";
import { migrateSnapshotBlockers } from "./blocker-model.ts";
import { migrateSnapshot } from "./migrate.ts";

export interface V2StorageLayout {
  baseDir: string;
  eventsFile: string;
  snapshotFile: string;
}

export function createLayout(cwd: string, outputDir = ".task-forge"): V2StorageLayout {
  const baseDir = resolve(cwd, outputDir);
  return {
    baseDir,
    eventsFile: resolve(baseDir, "events.jsonl"),
    snapshotFile: resolve(baseDir, "state.json"),
  };
}

export async function ensureLayout(layout: V2StorageLayout) {
  await mkdir(layout.baseDir, { recursive: true });
}

export async function appendEvent(layout: V2StorageLayout, event: ForgeEvent) {
  await ensureLayout(layout);
  await appendFile(layout.eventsFile, `${JSON.stringify(event)}\n`, "utf-8");
}

export async function readEvents(layout: V2StorageLayout): Promise<ForgeEvent[]> {
  if (!existsSync(layout.eventsFile)) return [];
  const raw = await readFile(layout.eventsFile, "utf-8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ForgeEvent);
}

export async function deriveSnapshot(layout: V2StorageLayout): Promise<RunSnapshot | null> {
  const events = await readEvents(layout);
  return replayEvents(events);
}

export async function writeSnapshot(layout: V2StorageLayout, snapshot: RunSnapshot) {
  await ensureLayout(layout);
  const migrated = migrateSnapshotBlockers(migrateSnapshot(snapshot));
  await writeFile(layout.snapshotFile, JSON.stringify(migrated, null, 2), "utf-8");
}

export async function loadSnapshot(layout: V2StorageLayout): Promise<RunSnapshot | null> {
  if (!existsSync(layout.snapshotFile)) return null;
  const raw = JSON.parse(await readFile(layout.snapshotFile, "utf-8")) as RunSnapshot;
  return migrateSnapshotBlockers(migrateSnapshot(raw));
}


### index.ts
/**
 * TaskForge — hierarchical multi-agent orchestration for PRD-driven execution.
 *
 * Adopted from PLAN-1.md:
 * - Strategist → Planner → Approval Gate → Execution → Integration Review
 * - Capability-tier model resolution with fallbacks
 * - Single-pass + iterative worker modes
 * - Gate review per task
 * - Blocker escalation and resume paths
 * - state.json + state.log artifacts for inspectability
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { Box, Text } from "@mariozechner/pi-tui";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appendEvent as appendV2Event, createLayout, deriveSnapshot as deriveV2Snapshot, loadSnapshot as loadV2Snapshot, readEvents as readV2Events, writeSnapshot as writeV2Snapshot } from "./v2/storage";
import { migrateV1StateToEvents, migrateV1StateToSnapshot } from "./v2/migrate";
import { TaskForgeV2Engine } from "./v2/engine";
import { createTaskForgeBeginTaskExecutionHooks, createTaskForgeCompleteTaskExecutionHooks, createTaskForgeIntegrationReviewHooks, createTaskForgeRunnerAdvanceHooks, createTaskForgeTaskFailureHooks } from "./v2/adapters";
import { executeApprovedPlanLoop, launchExecutionBatch } from "./v2/command-adapter";
import { runIntegrationReview } from "./v2/review";
import { runTaskDiagnosticReview, needsDiagnosticReview } from "./v2/diagnostic-review";
import { applyBlockerResolutionPatch, deriveBlockerResolutionPatch } from "./v2/blocker-resolution";
import { runTaskGateReview } from "./v2/gate-review";
import { beginTaskExecution, completeTaskExecution, failTaskExecutionAttempt } from "./v2/task-executor";
import { executeManagedTask } from "./v2/task-runner";
import { decideSupervisorActions } from "./v2/supervisor";
import { materializeLegacyValidationFields, normalizeGeneratedValidationContract, normalizeValidationCommand, normalizeValidationContract, runTaskValidation } from "./v2/validation";
import { computeSchedulingActions, dependenciesResolved as dependenciesResolvedV2, describeInterruptedExecution as describeInterruptedExecutionV2, executionFacts as executionFactsV2, failedDependencies as failedDependenciesV2, overdueSupervisors as overdueSupervisorsV2 } from "./v2/execution";
import { describeInterruptedPlanning, determineResumptionPhase } from "./v2/planning-recovery";
import { TaskForgeV2Runner } from "./v2/runner";
import type { RunSnapshot as V2RunSnapshot, RunStatus as V2RunStatus } from "./v2/types";
import { renderRootActionableBlockerStatus } from "./src/commands/status/render-root-blocker.ts";


// V2 command services — thin shell delegates to these for transition logic and event planning.
import { execute as executeCommandService } from "./v2/commands/execute";
import { status as statusCommandService } from "./v2/commands/status";
import { resume as resumeCommandService } from "./v2/commands/resume";
import { listBlockers as listBlockersCommandService, resolveBlocker as resolveBlockerCommandService, retryTask as retryTaskCommandService, patchValidation as patchValidationCommandService } from "./v2/commands/blocker";
import { pause as pauseCommandService } from "./v2/commands/pause";
import { abort as abortCommandService } from "./v2/commands/abort";
import { cost as costCommandService } from "./v2/commands/cost";
import { models as modelsCommandService } from "./v2/commands/models";
import { config as configCommandService } from "./v2/commands/config";
import { help as helpCommandService } from "./v2/commands/help";
import type { ForgeEvent } from "./v2/events";
import type { CommandResult } from "./v2/commands/contracts";

type ModelTier = "reasoning" | "coding" | "bulk" | "endurance";
type Role =
  | "scopeClassifier"
  | "strategist"
  | "planner"
  | "testDesigner"
  | "worker"
  | "workerIterative"
  | "gateReviewer"
  | "diagnosticReviewer"
  | "integrationReviewer";
type ForgeStatus =
  | "idle"
  | "analyzing"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "reviewing"
  | "completed"
  | "paused"
  | "aborted"
  | "blocked"
  | "failed";
type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";
type TaskMode = "single-pass" | "iterative";
type TddPhase = "red" | "green" | "refactor" | "complete";
type ValidationMode = "command" | "manual";

interface TaskValidationContract {
  mode: ValidationMode;
  command?: string;
  notes?: string;
  coverageThreshold?: number;
}

interface CostEstimate {
  totalInputTokens?: number;
  totalOutputTokens?: number;
  iterativeBudgetTokens?: number;
  estimatedUsd?: number;
}

interface ContextManifest {
  artifacts?: string[];
  codebaseFiles?: string[];
  dependencyOutputs?: string[];
}

interface Blocker {
  taskId: string;
  reason: string;
  suggestion: string;
  blockedTasks: string[];
  resolvedBy?: string;
  resolvedAt?: string;
}

interface ForgeTask {
  id: string;
  title: string;
  description: string;
  complexity: "S" | "M" | "L";
  taskMode: TaskMode;
  contextManifest: ContextManifest;
  outputManifest: string[];
  dependencies: string[];
  acceptanceCriteria: string[];
  escalationTriggers: string[];
  measurableTargets?: Record<string, number | boolean | string>;
  turnBudget?: number;
  validation: TaskValidationContract;
  testCommand?: string;
  acceptanceSignal?: string;
  coverageThreshold?: number;
  testSpecRefs?: string[];
  status: TaskStatus;
  retries: number;
  resolvedModel?: string;
  result?: string;
  gateReview?: { passed: boolean; notes: string };
  blocker?: Blocker;
  error?: string;
  validationOutput?: string;
  validationFramework?: string;
  lastCoverage?: number;
  tddPhase?: TddPhase;
  redEstablishedAt?: string;
  greenAchievedAt?: string;
  refactorValidatedAt?: string;
  diagnostic?: { classification: string; notes: string };
  diagnosticCount?: number;
  startedAt?: string;
  completedAt?: string;
  iterationCount?: number;
  resolutionInstruction?: string;
  failureSignature?: string;
  stallWarnedAt?: string;
}

interface TestSpecEntry {
  taskId: string;
  testFiles?: Array<{
    path: string;
    type?: string;
    targets?: string[];
    fixtures_required?: string[];
    derived_from?: string[];
  }>;
  validation: TaskValidationContract;
  acceptance_signal?: string;
  coverage_threshold?: number;
  ambiguities?: string[];
}

interface ForgeState {
  orchestrationId: string;
  status: ForgeStatus;
  currentPhase: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  phaseLabel: string;
  orchestrationMode?: "micro" | "standard" | "complex";
  nextAction?: "continuePlanning" | "executePlan";
  routingRationale?: string;
  prdFile?: string;
  resolvedModels: Partial<Record<Role, string>>;
  requirementsFile?: string;
  planFile?: string;
  tasksFile?: string;
  tasksMarkdownFile?: string;
  costFile?: string;
  testSpecFile?: string;
  testSpecMarkdownFile?: string;
  reviewFile?: string;
  cost: CostEstimate;
  blockers: Blocker[];
  tasks: ForgeTask[];
  testSpecs?: TestSpecEntry[];
  activeAgent?: {
    role: Role;
    model: string;
    startedAt: string;
    attempt?: number;
    totalCandidates?: number;
  };
  timestamps: {
    started: string;
    lastUpdated: string;
    completed?: string;
  };
}

interface TaskForgeConfig {
  modelTiers: Record<ModelTier, string[]>;
  roleAssignment: Record<Role, ModelTier>;
  modelOverrides: Partial<Record<Role, string>>;
  maxWorkers: number;
  maxRetries: number;
  defaultTurnBudget: number;
  maxTurnBudget: number;
  outputDir: string;
  autoExecute: boolean;
  contextBudgetPercent: number;
  costLimitUsd: number;
}

interface AgentDefinition {
  name: string;
  description?: string;
  tools: string;
  model?: string;
  systemPrompt: string;
}

const DEFAULT_CONFIG: TaskForgeConfig = {
  // Model tiers are intentionally empty — the real config lives in task-forge.json.
  // If no config file is found, loadConfig() will throw since there are no usable models.
  // This prevents silent fallback to stale or plan-incompatible model lists.
  modelTiers: {
    reasoning: [],
    coding: [],
    bulk: [],
    endurance: [],
  },
  roleAssignment: {
    scopeClassifier: "bulk",
    strategist: "reasoning",
    planner: "coding",
    testDesigner: "coding",
    worker: "bulk",
    workerIterative: "endurance",
    gateReviewer: "bulk",
    diagnosticReviewer: "coding",
    integrationReviewer: "coding",
  },
  modelOverrides: {},
  maxWorkers: 4,
  maxRetries: 2,
  defaultTurnBudget: 50,
  maxTurnBudget: 200,
  outputDir: ".task-forge",
  autoExecute: false,
  contextBudgetPercent: 70,
  costLimitUsd: 10,
};

const STATE_ENTRY_TYPE = "task-forge-state";
const TASK_STALL_WARNING_MS = seconds(20 * 60);

export function coercePlannerTask(raw: any, index: number): ForgeTask {
  const taskMode: TaskMode = raw.task_mode === "iterative" ? "iterative" : "single-pass";
  const complexity = raw.complexity === "L" || raw.complexity === "S" ? raw.complexity : "M";
  const { validation } = normalizeGeneratedValidationContract({
    source: "planner",
    validation: raw.validation,
    testCommand: raw.test_command,
    acceptanceSignal: raw.acceptance_signal,
    coverageThreshold: raw.coverage_threshold,
  });
  const legacyValidation = materializeLegacyValidationFields(validation);

  return {
    id: raw.id || `TASK-${String(index + 1).padStart(3, "0")}`,
    title: raw.title || `Task ${index + 1}`,
    description: raw.description || "",
    complexity,
    taskMode,
    contextManifest: {
      artifacts: raw.context_manifest?.artifacts ?? ["01-requirements.md", "02-plan.md"],
      codebaseFiles: raw.context_manifest?.codebase_files ?? [],
      dependencyOutputs: raw.context_manifest?.dependency_outputs ?? [],
    },
    outputManifest: raw.output_manifest ?? [],
    dependencies: raw.dependencies ?? [],
    acceptanceCriteria: raw.acceptance_criteria ?? [],
    escalationTriggers: raw.escalation_triggers ?? [],
    measurableTargets: raw.measurable_targets,
    turnBudget: Math.min(Math.max(Number(raw.turn_budget ?? DEFAULT_CONFIG.defaultTurnBudget), 1), DEFAULT_CONFIG.maxTurnBudget),
    validation,
    testCommand: legacyValidation.testCommand,
    acceptanceSignal: legacyValidation.acceptanceSignal,
    coverageThreshold: legacyValidation.coverageThreshold,
    testSpecRefs: raw.test_spec_refs ?? [],
    status: "pending",
    retries: 0,
  };
}

export function coerceTestDesignerSpec(raw: any): TestSpecEntry {
  const { validation } = normalizeGeneratedValidationContract({
    source: "test-designer",
    validation: raw.validation,
    acceptanceSignal: raw.acceptance_signal,
    coverageThreshold: raw.coverage_threshold,
  });
  const legacyValidation = materializeLegacyValidationFields(validation);

  return {
    taskId: String(raw.taskId ?? ""),
    testFiles: Array.isArray(raw.testFiles) ? raw.testFiles : [],
    validation,
    acceptance_signal: legacyValidation.acceptanceSignal,
    coverage_threshold: legacyValidation.coverageThreshold,
    ambiguities: Array.isArray(raw.ambiguities) ? raw.ambiguities : [],
  };
}
const TASK_STALL_ESCALATION_MS = TASK_STALL_WARNING_MS;
const TASK_SUPERVISOR_SWEEP_MS = Math.min(TASK_STALL_WARNING_MS, seconds(60));
const SUBCOMMANDS = [
  "execute",
  "status",
  "blocker",
  "pause",
  "resume",
  "abort",
  "cost",
  "models",
  "config",
  "help",
] as const;

function nowIso() {
  return new Date().toISOString();
}

function genId() {
  return `forge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function seconds(value: number) {
  return value * 1000;
}

function statusIcon(status: ForgeStatus | V2RunStatus | "needs_human_intervention") {
  switch (status) {
    case "idle": return "💤";
    case "analyzing": return "🔍";
    case "planning": return "📋";
    case "awaiting_approval": return "⏳";
    case "executing": return "⚙️";
    ca

## Iteration
1/6

## TDD Phase
red

## Phase Instructions
You are in RED. Your goal is to establish a failing test or failing validation signal. Do not aim for passing validation yet. If validation passes, the red phase has failed and you must correct the test setup.

## Validation Command
node --test --experimental-strip-types tests/integration/replay-regression-suite.test.ts