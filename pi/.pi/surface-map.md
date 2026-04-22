# Typed Validation Contract Surface Map

## Scope
This inventory maps the exact TaskForge modules that participate in the typed validation contract. It is the module-level reference for downstream implementation tasks.

Authoritative contract carriers:
- `agent/extensions/task-forge/v2/types.ts::TaskValidationContract`
- `agent/extensions/task-forge/v2/types.ts::ForgeTask.validation`
- `agent/extensions/task-forge/v2/types.ts::TestSpecEntry.validation`

Migration note:
- legacy fields (`testCommand`, `acceptanceSignal`, `coverageThreshold`) remain compatibility-only through adapter/migration paths

## Exact target map by lifecycle surface

| Surface | Owning modules | Exact file targets |
|---|---|---|
| Task schema/state | `v2/types`, extension bridge, migration adapter | `agent/extensions/task-forge/v2/types.ts`, `agent/extensions/task-forge/index.ts`, `agent/extensions/task-forge/v2/migrate.ts` |
| Planner | planner prompt, planner parse/hydration | `agent/extensions/task-forge/agents/planner.md`, `agent/extensions/task-forge/index.ts` |
| Test-designer | test-designer prompt, test-spec merge/hydration | `agent/extensions/task-forge/agents/test-designer.md`, `agent/extensions/task-forge/index.ts` |
| Preflight | preflight validator, engine blocker wiring, runner scheduler | `agent/extensions/task-forge/v2/preflight.ts`, `agent/extensions/task-forge/v2/engine.ts`, `agent/extensions/task-forge/v2/runner.ts` |
| Execution | validation executor, task success path, task runner, extension exec wiring | `agent/extensions/task-forge/v2/validation.ts`, `agent/extensions/task-forge/v2/task-success.ts`, `agent/extensions/task-forge/v2/task-runner.ts`, `agent/extensions/task-forge/index.ts` |
| Gate review / diagnostics | gate-review prompt, diagnostic review, diagnostic rewrite, extension review wiring | `agent/extensions/task-forge/v2/gate-review.ts`, `agent/extensions/task-forge/v2/diagnostic-review.ts`, `agent/extensions/task-forge/v2/task-diagnostic.ts`, `agent/extensions/task-forge/index.ts` |
| Status / rendering | derived status/event replay, CLI status formatter | `agent/extensions/task-forge/v2/derive.ts`, `agent/extensions/task-forge/v2/events.ts`, `agent/extensions/task-forge/index.ts` |

## 1) Planner surfaces — validation intent is first produced

### Prompt contract
- `agent/extensions/task-forge/agents/planner.md`
  - Defines the planner JSON output contract.
  - Now requires typed `validation` output, but still documents legacy `test_command` / `acceptance_signal` as deprecated do-not-use fields, so it remains a migration-sensitive surface.

### Planner invocation and parsing
- `agent/extensions/task-forge/index.ts`
  - `phasePlanMicro(...)`
  - `phasePlan(...)`
  - `extractJson(...)`
  - `coerceTask(...)`
  - These functions invoke the planner, parse returned JSON, and hydrate task objects.
  - `coercePlannerTask(...)` now treats `raw.validation` as authoritative through `normalizeGeneratedValidationContract(...)`, then dual-writes legacy mirrors via `materializeLegacyValidationFields(...)`:
    - `validation -> task.validation`
    - compatibility mirror: `validation.command -> task.acceptanceSignal`
    - compatibility mirror: `validation.coverageThreshold -> task.coverageThreshold`
    - rejects conflicting generated `test_command` / `acceptance_signal` / `coverage_threshold`

### Persisted planner artifacts
- `.task-forge/03-tasks.json`
- `.task-forge/03-tasks.md`
- `agent/extensions/task-forge/v2/engine.ts` via `markPlanWritten(...)` and `registerTasks(...)`
- `agent/extensions/task-forge/v2/events.ts` (`plan_written`, `tasks_registered`)
- `agent/extensions/task-forge/v2/derive.ts`
  - Planner output becomes durable run state through event replay.

## 2) Test-designer surfaces — validation intent is refined/overridden

### Prompt contract
- `agent/extensions/task-forge/agents/test-designer.md`
  - Defines per-task test spec output.
  - Now requires typed `validation` output and explicitly forbids placing manual guidance in legacy command-shaped fields.
  - Legacy `acceptance_signal` / `coverage_threshold` remain compatibility-sensitive because they are still mirrored in persisted artifacts.

### Test-designer invocation and task hydration
- `agent/extensions/task-forge/index.ts`
  - `phaseDesignTests(...)`
  - Parses `testSpecs` JSON and mutates task definitions.
  - `coerceTestDesignerSpec(...)` normalizes typed `validation` and dual-writes legacy mirrors.
  - Current merge behavior still copies compatibility mirrors into task state:
    - `spec.validation -> task.validation`
    - `spec.acceptance_signal -> task.acceptanceSignal`
    - `spec.coverage_threshold -> task.coverageThreshold`
    - `spec.testFiles -> task.testSpecRefs`

### Durable test-spec artifacts
- `.task-forge/03-test-spec.json`
- `.task-forge/03-test-spec.md`
- `agent/extensions/task-forge/v2/engine.ts` via `markTestSpecWritten(...)`
- `agent/extensions/task-forge/v2/events.ts` (`test_spec_written`)
- `agent/extensions/task-forge/v2/derive.ts`

## 3) Core task/state types — validation intent is stored and transported

### Primary type definitions
- `agent/extensions/task-forge/v2/types.ts`
  - `TaskValidationContract`
  - `ForgeTask`
  - `TestSpecEntry`
  - `TaskRuntimeState`
  - `RunSnapshot`
  - Typed `validation` now exists, but legacy mirror fields remain on `ForgeTask` / `TestSpecEntry` for adapter compatibility.

### V1 compatibility copy of task types
- `agent/extensions/task-forge/index.ts`
  - Local `ForgeTask`, `TestSpecEntry`, `ForgeState` mirror the typed `validation` field and retain legacy mirrors, so this remains a dual-read / dual-write boundary.

### Migration surfaces
- `agent/extensions/task-forge/v2/migrate.ts`
  - Migrates V1 state to V2 snapshot/events.
  - Already derives typed `validation` from legacy fields with `normalizeValidationContract(...)` and rewrites legacy mirrors with `materializeLegacyValidationFields(...)`.

## 4) Preflight surfaces — validation intent is checked before execution

### Preflight rules
- `agent/extensions/task-forge/v2/preflight.ts`
  - `preflightAcceptanceCommand(...)`
  - `normalizeFrontendContainerCommand(...)`
  - `classifyRuntimeFailure(...)`
  - `taskLooksLikeManualValidationCandidate(...)`
  - `missingAcceptanceSuggestion(...)`

### Key current behavior
- `preflightAcceptanceCommand(...)` now normalizes typed validation first via `normalizeValidationContract(...)`.
- `validation.mode === "manual"` explicitly passes preflight and emits a skip message.
- `validation.mode === "command"` still blocks if the executable command is absent or malformed.
- Remaining legacy/implicit reliance:
  - fallback normalization still reads `acceptanceSignal` / `testCommand` / `coverageThreshold`
  - `missingAcceptanceSuggestion(...)` still uses doc/manual-task heuristics to shape blocker copy when the contract is invalid

### Preflight orchestration entrypoint
- `agent/extensions/task-forge/v2/engine.ts`
  - `preflightTask(...)`
  - Converts preflight failure into:
    - `task_blocked`
    - `human_intervention_requested`

### Execution scheduler dependency
- `agent/extensions/task-forge/v2/runner.ts`
  - `advanceExecution(...)`
  - Calls `engine.preflightTask(...)` before launching work.

## 5) Execution surfaces — validation intent is run or enforced

### Validation execution engine
- `agent/extensions/task-forge/v2/validation.ts`
  - `normalizeValidationCommand(...)`
  - `normalizeValidationContract(...)`
  - `normalizeGeneratedValidationContract(...)`
  - `detectValidationFramework(...)`
  - `extractCoverage(...)`
  - `runTaskValidation(...)`
- Current execution source of truth:
  - `task.validation`, with fallback normalization from legacy fields only when typed data is absent
- Current behavior:
  - manual mode returns a passing "shell validation intentionally skipped" result
  - command mode requires a normalized executable command and throws if missing

### Task execution orchestration
- `agent/extensions/task-forge/v2/task-runner.ts`
  - `runSinglePassWorker(...)`
  - `runIterativeWorker(...)`
  - `runTaskWorker(...)`
  - `executeManagedTask(...)`
- Important semantics:
  - iterative mode still directly requires `task.testCommand || task.acceptanceSignal` in `runIterativeWorker(...)`, so this is one of the clearest remaining legacy-command dependencies
  - single-pass mode runs validation through the success path hooks

### Success path integration
- `agent/extensions/task-forge/v2/task-success.ts`
  - `executeTaskSuccessPath(...)`
  - Runs worker -> validation -> gate review
  - For non-iterative tasks, validation runs when `hooks.runValidation` is supplied

### Extension wiring
- `agent/extensions/task-forge/index.ts`
  - `runValidation(...)`
  - `executeTask(...)`
  - Wires shell execution through `pi.exec("bash", ["-lc", command])`

## 6) Failure diagnosis surfaces — validation intent is reinterpreted after failure

### Diagnostic review trigger
- `agent/extensions/task-forge/v2/diagnostic-review.ts`
  - `needsDiagnosticReview(...)`
  - `buildDiagnosticReviewPrompt(...)`
  - `runTaskDiagnosticReview(...)`
- Trigger currently depends on legacy validation fields or `testSpecRefs`; it has not yet been refactored to branch on typed `validation.mode`.

### Test-spec rewrite flow
- `agent/extensions/task-forge/v2/task-diagnostic.ts`
  - `applyDiagnosticTestSpecRewrite(...)`
  - Rewrites task acceptance data from diagnostic output.

### Failure handling logic
- `agent/extensions/task-forge/v2/task-failure.ts`
- `agent/extensions/task-forge/v2/task-runner.ts`
  - Failure path can rewrite test specs and requeue tasks.

## 7) Gate review surfaces — validation outcome is reviewed for acceptance

### Gate review contract and prompt
- `agent/extensions/task-forge/v2/gate-review.ts`
  - `requiresStrongGateReview(...)`
  - `buildGateReviewPrompt(...)`
  - `runTaskGateReview(...)`

### Current gate-review inputs
- acceptance criteria
- output manifest
- legacy command mirrors plus typed command fallback (`acceptanceSignal || testCommand || validation.command`)
- manual notes (`validation.notes`)
- coverage threshold / parsed coverage
- validation framework / validation output
- worker result

### Integration wiring
- `agent/extensions/task-forge/index.ts`
  - `gateReviewTask(...)`
  - `executeTask(...)` -> `markGateReview(...)`

### Post-task whole-run review
- `agent/extensions/task-forge/v2/review.ts`
  - `buildIntegrationReviewPrompt(...)`
  - `runIntegrationReview(...)`
- This is not task validation execution, but it is still a review surface that may need awareness of manual-validation semantics at run level.

## 8) Status and user-facing rendering surfaces — validation state is exposed

### Command output rendering
- `agent/extensions/task-forge/index.ts`
  - `statusLabel(...)`
  - `statusLabelFromV2(...)`
  - `statusSummaryFromV2(...)`
  - `statusSummary(...)`
  - `/forge status` handler in `pi.registerCommand("forge", ...)`

### State derivation
- `agent/extensions/task-forge/v2/derive.ts`
  - `deriveStatus(...)`
  - `applyEvent(...)`
- Current run/task statuses do not include a dedicated manual-review state; mode awareness is therefore carried mostly through formatter copy, not status enums.

### Persistent event/state surfaces rendered indirectly
- `agent/extensions/task-forge/v2/events.ts`
  - Event vocabulary for validation, blocking, and review
- `.task-forge/events.jsonl`
- `.task-forge/state.json`
- `.task-forge/state.log`
- These are inspectability/status surfaces consumed by humans and tooling.

## 9) Documentation surfaces that describe the current contract

- `agent/extensions/task-forge/README.md`
  - Documents planner/test-designer fields, execution semantics, and acceptance signal normalization.
- `agent/extensions/task-forge/FOLLOWUP-ISSUE-typed-validation-modes.md`
  - Problem statement and intended typed contract.
- `agent/extensions/task-forge/PLAN.md`, `PLAN-1.md`, `ARCHITECTURE-REVIEW.md`, `ARCHITECTURE-V2.md`
  - Background docs that still reference legacy validation assumptions.

## Lifecycle summary by required stage

| Lifecycle stage | Owning modules/functions | Concrete surfaces |
|---|---|---|
| Planner | prompt contract + planner parser (`phasePlanMicro`, `phasePlan`, `coerceTask`) | `agents/planner.md`, `index.ts::phasePlan*`, `index.ts::coerceTask` |
| Test-designer | prompt contract + test-spec parser (`phaseDesignTests`) | `agents/test-designer.md`, `index.ts::phaseDesignTests` |
| Preflight | command/manual brancher + scheduler (`preflightAcceptanceCommand`, `preflightTask`, `advanceExecution`) | `v2/preflight.ts`, `v2/engine.ts::preflightTask`, `v2/runner.ts::advanceExecution` |
| Execution | task runner + success path + validation executor (`runIterativeWorker`, `executeTaskSuccessPath`, `runTaskValidation`) | `v2/task-runner.ts`, `v2/task-success.ts`, `v2/validation.ts`, `index.ts::runValidation/executeTask` |
| Gate review | gate-review + integration review (`buildGateReviewPrompt`, `runTaskGateReview`, `runIntegrationReview`) | `v2/gate-review.ts`, `index.ts::gateReviewTask`, `v2/review.ts` |
| Status | CLI formatter + derived state (`statusLabel*`, `statusSummary*`, `deriveStatus`, event replay) | `index.ts::statusLabel*`, `index.ts::statusSummary*`, `v2/derive.ts`, `v2/events.ts` |

## Local inconsistencies already visible

1. **Preflight is stricter than runtime validation when command is missing.**
   - `v2/preflight.ts` blocks missing commands.
   - `v2/validation.ts::runTaskValidation(...)` treats missing command as pass.

2. **Manual-task handling is heuristic, not typed.**
   - `taskLooksLikeManualValidationCandidate(...)` only changes suggestions.

3. **Planner and test-designer use different legacy fields.**
   - planner emphasizes `test_command`
   - test-designer emphasizes `acceptance_signal`

4. **Gate review and diagnostic review are still keyed to legacy command-oriented signals.**

## Canonical validation commands visible in this repo

These are the concrete commands already used by repo tests and are the safest downstream defaults until a higher-level script wrapper exists.

| Purpose | Canonical command | Evidence |
|---|---|---|
| Contract/unit validation | `deno test --no-check --sloppy-imports --allow-read agent/extensions/task-forge/v2/validation.contract.test.ts` | Direct fixture command usage and successful local run |
| Preflight validation branching | `deno test --no-check --sloppy-imports --allow-read agent/extensions/task-forge/v2/preflight-validation-mode-branching.test.ts` | Direct fixture command usage and successful local run |
| Integration coverage for legacy/planner/execution flows | `deno test --no-check --sloppy-imports --allow-read agent/extensions/task-forge/integration/validation-legacy-normalization.test.ts agent/extensions/task-forge/integration/planner-testdesigner-validation-mode.integration.test.ts agent/extensions/task-forge/integration/execution-manual-vs-command-validation.integration.test.ts` | Direct fixture command usage and successful local run |
| Repo-level typecheck baseline | `deno test agent/extensions/task-forge/v2/validation.contract.test.ts` currently performs Deno type-check before execution, but fails today on extensionless local imports and generic typing issues | Observed local run failure; use as migration target, not current green baseline |
| Lint/typecheck follow-on target | No authoritative repo script exists (`package.json`/`deno.json` absent in current tree). Downstream work should standardize on explicit `deno check ...` / `deno lint ...` commands if typed validation needs canonical lint/typecheck hooks. | Repository inspection |

## Open questions that cannot be resolved from local code alone

1. Are there external consumers of `.task-forge/03-tasks.json`, `.task-forge/03-test-spec.json`, or `.task-forge/state.json` outside this repository that require a longer backward-compatibility window?
2. Is there any UI client besides `/forge status` that depends on current run/task state labels and would need a dedicated `manual_review`/similar state?
3. Are manual-review artifacts expected to be machine-readable in a stricter schema than freeform worker output plus reviewer notes?
