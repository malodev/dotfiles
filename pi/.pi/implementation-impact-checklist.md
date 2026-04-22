# Implementation Impact Checklist

This checklist translates the finalized surface inventory and ADR into concrete follow-on implementation scope.

Chosen contract decisions carried into all follow-on work:
- authoritative field: `validation`
- migration policy: adapter-based dual-read / typed-write
- strictness policy: reject incompatible typed combinations
- required fields by mode: command mode requires `command`; manual mode requires only `mode`

## T2 — Schema/types foundation

- [ ] Add `validation` contract to `agent/extensions/task-forge/v2/types.ts::ForgeTask`
- [ ] Add `validation` contract to `agent/extensions/task-forge/v2/types.ts::TestSpecEntry` if test specs need first-class validation metadata
- [ ] Mirror the same shape in `agent/extensions/task-forge/index.ts` local task/test-spec types
- [ ] Update `agent/extensions/task-forge/v2/migrate.ts` to preserve or derive typed validation for migrated runs
- [ ] Decide whether legacy fields remain temporarily on `ForgeTask` during migration

## T3 — Planner and test-designer generation contracts

### Planner
- [ ] Update `agent/extensions/task-forge/agents/planner.md` to require `validation`
- [ ] Update `agent/extensions/task-forge/index.ts::phasePlanMicro(...)` prompt schema text
- [ ] Update `agent/extensions/task-forge/index.ts::phasePlan(...)` prompt schema text
- [ ] Update `agent/extensions/task-forge/index.ts::coerceTask(...)` to parse typed validation
- [ ] Ensure persisted `03-tasks.json` writes typed validation

### Test-designer
- [ ] Update `agent/extensions/task-forge/agents/test-designer.md` to emit `validation`
- [ ] Update `agent/extensions/task-forge/index.ts::phaseDesignTests(...)` prompt schema text
- [ ] Update `phaseDesignTests(...)` merge logic so test specs refine `task.validation`
- [ ] Ensure persisted `03-test-spec.json` writes typed validation

## T4 — Preflight branching

- [ ] Replace command-presence gating in `agent/extensions/task-forge/v2/preflight.ts::preflightAcceptanceCommand(...)` with mode-based branching
- [ ] Remove policy dependence on `taskLooksLikeManualValidationCandidate(...)` heuristics
- [ ] Keep command normalization only for `validation.mode === "command"`
- [ ] Update `agent/extensions/task-forge/v2/engine.ts::preflightTask(...)` blocker messaging to mention validation mode
- [ ] Confirm `agent/extensions/task-forge/v2/runner.ts::advanceExecution(...)` preserves manual-mode pass-through

## T5 — Execution and gate review

### Execution
- [ ] Update `agent/extensions/task-forge/v2/validation.ts::runTaskValidation(...)` to read `task.validation`
- [ ] Make missing command a hard failure only for command mode
- [ ] Skip shell validation for manual mode in `agent/extensions/task-forge/v2/task-success.ts::executeTaskSuccessPath(...)`
- [ ] Decide and encode iterative-task restriction in `agent/extensions/task-forge/v2/task-runner.ts::runIterativeWorker(...)`
- [ ] Update `agent/extensions/task-forge/index.ts::runValidation(...)` and `executeTask(...)` wiring

### Gate review
- [ ] Update `agent/extensions/task-forge/v2/gate-review.ts::buildGateReviewPrompt(...)` to include validation mode
- [ ] Include manual notes in gate-review prompt when present
- [ ] Make reviewer prompt state explicitly when shell validation was intentionally skipped
- [ ] Revisit `requiresStrongGateReview(...)` once manual mode exists

### Diagnostic review
- [ ] Update `agent/extensions/task-forge/v2/diagnostic-review.ts` to reason about typed validation instead of legacy command fields alone
- [ ] Update `agent/extensions/task-forge/v2/task-diagnostic.ts` rewrite logic for typed validation

## T6 — Status and blocker UX

- [ ] Update `agent/extensions/task-forge/index.ts::statusLabelFromV2(...)` if mode summary is shown there
- [ ] Update `agent/extensions/task-forge/index.ts::statusSummaryFromV2(...)` to display validation mode for relevant tasks/blockers
- [ ] Update legacy fallback `statusSummary(...)` path as needed
- [ ] Ensure blocker suggestions differentiate:
  - [ ] command contract errors
  - [ ] manual-review expected next steps
- [ ] Review `agent/extensions/task-forge/v2/derive.ts` for any need to expose manual-review semantics in derived status output

## Persisted event/state surfaces

- [ ] Review whether `agent/extensions/task-forge/v2/events.ts` needs new event payload fields for validation mode metadata
- [ ] Review whether existing `task_validation_passed` / `task_validation_failed` events are sufficient for manual mode
- [ ] Confirm `.task-forge/state.json`, `.task-forge/events.jsonl`, and task artifact files remain intelligible after migration

## Documentation updates

- [ ] Update `agent/extensions/task-forge/README.md` to document typed validation semantics
- [ ] Update architecture/reference docs that currently describe legacy `test_command` / prose `acceptance_signal` behavior
- [ ] Keep `agent/extensions/task-forge/FOLLOWUP-ISSUE-typed-validation-modes.md` aligned with final implementation semantics

## Regression targets implied by this analysis

- [ ] planner emits `validation.mode`
- [ ] test-designer emits `validation.mode`
- [ ] preflight blocks invalid command-mode tasks
- [ ] preflight allows valid manual-mode tasks with no command
- [ ] execution skips shell validation for manual mode
- [ ] gate review receives manual notes and mode context
- [ ] `/forge status` exposes mode-aware guidance
- [ ] backward-compat parsing works when only legacy fields exist

## Open questions to carry forward

- [ ] Confirm whether any external consumers require dual-write compatibility for legacy artifact fields
- [ ] Confirm whether a new explicit manual-review state label is desired or whether existing statuses plus validation-mode metadata are sufficient
- [ ] Confirm whether manual notes should stay freeform or later become structured reviewer instructions
