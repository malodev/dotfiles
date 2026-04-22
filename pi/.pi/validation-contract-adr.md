# ADR: Typed Validation Contract for TaskForge

- Status: Accepted
- Date: 2026-04-18
- Decision scope: task schema, planner, test-designer, preflight, execution, gate review, status

## Decision summary

TaskForge standardizes on a single typed validation contract and keeps legacy fields only through an adapter-style compatibility layer.

```ts
interface TaskValidationContract {
  mode: "command" | "manual";
  command?: string;
  notes?: string;
  coverageThreshold?: number;
}
```

Authoritative rule:
- `task.validation` is the source of truth.
- `testCommand`, `acceptanceSignal`, and `coverageThreshold` are compatibility inputs/outputs only during migration.
- Contradictory combinations are rejected; they are not auto-corrected.

## Exact implementation targets

| Surface | Exact file targets |
|---|---|
| Task schema/state | `agent/extensions/task-forge/v2/types.ts`, `agent/extensions/task-forge/index.ts`, `agent/extensions/task-forge/v2/migrate.ts` |
| Planner | `agent/extensions/task-forge/agents/planner.md`, `agent/extensions/task-forge/index.ts` (`phasePlanMicro`, `phasePlan`, `coerceTask`) |
| Test-designer | `agent/extensions/task-forge/agents/test-designer.md`, `agent/extensions/task-forge/index.ts` (`phaseDesignTests`) |
| Preflight | `agent/extensions/task-forge/v2/preflight.ts`, `agent/extensions/task-forge/v2/engine.ts`, `agent/extensions/task-forge/v2/runner.ts` |
| Execution | `agent/extensions/task-forge/v2/validation.ts`, `agent/extensions/task-forge/v2/task-success.ts`, `agent/extensions/task-forge/v2/task-runner.ts`, `agent/extensions/task-forge/index.ts` |
| Gate review | `agent/extensions/task-forge/v2/gate-review.ts`, `agent/extensions/task-forge/v2/diagnostic-review.ts`, `agent/extensions/task-forge/v2/task-diagnostic.ts`, `agent/extensions/task-forge/index.ts` |
| Status/rendering | `agent/extensions/task-forge/v2/derive.ts`, `agent/extensions/task-forge/v2/events.ts`, `agent/extensions/task-forge/index.ts` |

## Final contract semantics

### Command mode
Required fields:
- `mode = "command"`
- `command` must be present after normalization

Allowed fields:
- `notes` optional
- `coverageThreshold` optional

Required behavior:
- preflight validates command shape/availability
- execution runs shell validation
- coverage parsing remains active when `coverageThreshold` is set
- gate review consumes validation output/framework/coverage

Rejected combinations:
- `mode: "command"` with missing or blank `command`
- `mode: "command"` with notes only and no command

### Manual mode
Required fields:
- `mode = "manual"`
- no additional field is mandatory

Allowed fields:
- `notes` optional but recommended for reviewer clarity

Required behavior:
- preflight skips executable-command checks
- execution does not invoke shell validation
- gate review is the acceptance mechanism, using worker output, artifacts, acceptance criteria, and optional `notes`
- status text should explain that manual review is expected

Rejected combinations:
- `mode: "manual"` with non-empty `command`
- `mode: "manual"` with `coverageThreshold`

### Compatibility/strictness policy

Chosen policy: **adapter-based migration with strict runtime semantics**.

This is explicitly **not** a breaking cutover and **not** a silent mixed-mode policy.

Rules:
1. If `validation` exists, use it exclusively.
2. If `validation` is absent, derive it from legacy fields in parsing/migration layers only.
3. Newly written planner/test-designer/state artifacts should write typed `validation`.
4. Invalid typed combinations fail deterministically during parsing/preflight.
5. Runtime logic must branch on `validation.mode`, not on heuristics or prose detection.

## Legacy-field migration decision

Chosen strategy: **adapter, then sunset**.

### Adapter read rules
1. `validation` present -> authoritative.
2. Else `testCommand` or command-like `acceptanceSignal` present -> derive command mode.
3. Else prose-only legacy acceptance guidance -> derive manual mode only in adapters/migration, not in runtime heuristics.

### Adapter write rules
- Planner/test-designer prompts and persisted artifacts should write typed `validation`.
- Legacy mirror fields may remain temporarily only where existing code paths or external consumers still read them.

### Sunset policy
- Phase 1: dual-read, typed-write
- Phase 2: remove legacy fields from prompts and internal branching
- Phase 3: remove legacy mirrors once compatibility consumers are confirmed gone

## Canonical repo validation commands

Current repository evidence supports Deno-first explicit file commands rather than package-manager scripts.

| Purpose | Canonical command | Decision |
|---|---|---|
| Typed contract/unit coverage | `deno test --no-check --sloppy-imports --allow-read agent/extensions/task-forge/v2/validation.contract.test.ts` | Canonical focused command until import/typecheck cleanup lands |
| Preflight mode branching coverage | `deno test --no-check --sloppy-imports --allow-read agent/extensions/task-forge/v2/preflight-validation-mode-branching.test.ts` | Canonical focused command |
| Validation integration coverage | `deno test --no-check --sloppy-imports --allow-read agent/extensions/task-forge/integration/validation-legacy-normalization.test.ts agent/extensions/task-forge/integration/planner-testdesigner-validation-mode.integration.test.ts agent/extensions/task-forge/integration/execution-manual-vs-command-validation.integration.test.ts` | Canonical multi-file integration command |
| Full strict Deno typechecked test invocation | `deno test ...` without `--no-check --sloppy-imports` is **not** currently green due to extensionless imports and generic typing errors in existing code | Treat as future cleanup target, not as current baseline |
| Lint/typecheck scripts | No repository-level `package.json` or `deno.json` command registry exists in the checked tree | Downstream tasks must keep commands explicit in task validation contracts |

## Additional lifecycle decisions

- Iterative execution remains command-validation only for now; manual iterative semantics are out of scope.
- Manual notes stay freeform and optional.
- Preflight heuristics such as manual-task guessing must not drive policy once typed validation is available.
- Missing-command behavior must be aligned so command mode fails consistently before execution instead of passing at runtime.

## Unresolved blockers / follow-up owners

| Blocker | Owner | Next action |
|---|---|---|
| Unknown external consumers of `.task-forge/03-tasks.json`, `.task-forge/03-test-spec.json`, or `.task-forge/state.json` may require longer dual-write compatibility | Maintainer / planner | Confirm consumer inventory before Phase 3 legacy removal |
| UX choice for a dedicated `manual_review` status vs existing statuses plus validation-mode messaging is not finalized | Maintainer / planner | Decide before status-label changes land so `derive.ts` and `/forge status` stay aligned |
| Manual reviewer guidance is currently freeform; future structured evidence fields are undecided | Maintainer / product direction | Keep `notes` freeform now; revisit only if reviewer quality issues appear |

## Consequences

Positive:
- one validation contract across planning, execution, and review
- manual validation becomes first-class
- incompatible task definitions fail early and clearly

Costs:
- migration logic remains necessary during transition
- prompt, state, and status surfaces all require coordinated updates
- downstream tasks must preserve adapter behavior until compatibility questions are closed
