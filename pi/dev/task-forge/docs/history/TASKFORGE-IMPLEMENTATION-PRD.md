# TaskForge Implementation PRD (from milestones)

> Superseded by: `docs/history/TASKFORGE-ENHANCEMENT-PLAN.md`
>
> This file is kept as historical context for the earlier milestone wrapper PRD. Use the enhancement plan for future TaskForge improvement work.

## Context

This PRD turns `milestones.md` into executable implementation work for TaskForge v2.

Reference files:
- `milestones.md`
- `TODO-now.md`
- `ARCHITECTURE-V2.md`
- `README.md`
- `docs/operations/runbook.md`

TaskForge v2 is now event-sourced and should treat `events.jsonl` as the authoritative history, with `state.json` as a derived/debug snapshot. Recent operational issues showed that the architecture is sound, but several edges still let the system become hard to resume after a human-intervention or validation-contract fix.

## Problem statement

TaskForge can still enter confusing or blocked operational states when:

1. a task enters `needs_human_intervention`,
2. the user patches the task contract or retries it,
3. the task itself is now runnable,
4. but run-level status remains latched and `/forge execute` or `/forge resume` refuses to proceed.

A second problem is validation contract quality. Generated tasks can persist commands like bare `npx tsc --noEmit`, which is not deterministic unless a valid `tsconfig.json` exists at the working directory. When this fails, user-facing output can include huge compiler help text instead of a short actionable diagnosis.

A third problem is regression prevention. The project has explicitly moved to Node-based test execution, but older Deno-style commands/tests previously reappeared in generated or persisted contracts.

## Goal

Implement near-term TaskForge reliability improvements with safe, incremental changes and strong regression coverage.

The outcome should be that TaskForge is easier to resume, generated validation commands are safer, blocker operations are clearer, and regressions are caught by tests/CI.

## Design rationale

### Why unify transition handling?

Currently, `/forge execute`, `/forge resume`, and `/forge blocker` each reason about run status slightly differently. This creates dead-end states where one command says “not resumable” and another says “cannot execute from status needs_human_intervention.” A shared transition helper makes command behavior deterministic and testable.

### Why resolve human intervention explicitly?

`pendingHumanIntervention` is a run-level latch. Patching a task contract is not enough if the latch remains active. The event log should show:

```text
human_intervention_requested
... user patch / resolution ...
human_intervention_resolved
task_requeued
approval_required or approval_granted
```

This keeps recovery auditable and avoids hidden state mutation.

### Why validate command shape early?

Validation commands are part of the task contract. A command that only works from an implicit working directory or implicit TypeScript config is not deterministic. Detecting bad command shapes before worker execution avoids wasting model turns and avoids noisy human-intervention output.

### Why preserve Node-only validation?

TaskForge currently runs in a Node/pi environment. Test commands should use:

```bash
npx tsc -p tsconfig.json --noEmit
node --test --experimental-strip-types <targeted-test-files>
```

Deno should not be used as the JavaScript/TypeScript test engine in TaskForge runtime, generated contracts, docs, or tests.

## In-scope milestones

1. **PR-1** Unified command transition guard
2. **PR-2** Auto-resolve human intervention on actionable fixes
3. **PR-3** Deterministic TypeScript preflight checks
4. **PR-4** Normalize command contracts at write-time
5. **PR-5** Compact evidence output + verbose fallback
6. **PR-6** Blocker command UX improvements (`--list --json`)
7. **PR-7** CI policy guardrails (no Deno regression)
8. **PR-8** Lifecycle + scheduling robustness tests

## Out of scope

- New product features unrelated to TaskForge orchestration
- Provider/model strategy redesign beyond current config
- Large UI redesign of status rendering
- Replacing the event-sourced v2 runtime architecture
- Rewriting all historical planning docs

## Functional requirements

### FR-1 Transition reliability

- `/forge execute`, `/forge resume`, and `/forge blocker` operations must share one transition validator or transition policy module.
- The transition policy must be covered by tests.
- The system must not remain stuck when a task has been patched/requeued and no unresolved blocker remains.

### FR-2 Human intervention lifecycle

- If blocker remediation makes a task runnable, TaskForge must clear pending human-intervention state through explicit events.
- The event log must remain auditable.
- The implementation must avoid direct state-file mutation as the primary recovery mechanism.

### FR-3 Validation determinism

- Reject non-deterministic TypeScript command shapes, including bare `npx tsc --noEmit` with no `-p/--project` and no explicit file target.
- Prefer explicit file-targeted or project-targeted commands.
- Provide concise actionable error output instead of large compiler help dumps.

### FR-4 Contract normalization

- Normalize generated validation commands before persistence into tasks/specs/events.
- Prevent stale invalid commands from entering authoritative event state when possible.
- Preserve the original intent of generated contracts while making command execution deterministic.

### FR-5 Operator UX

- Human-intervention evidence must be concise by default.
- Full output must remain available in artifacts/logs.
- Add scriptable blocker listing via JSON.

### FR-6 Regression safety

- Add CI or local policy checks to prevent Deno test/check command regressions.
- Add lifecycle and scheduling tests for fail -> patch -> retry -> execute flow and blocker cascade behavior.

## Non-functional requirements

- **Determinism:** state transitions must be reproducible from the event log.
- **Resumability:** interrupted or human-gated runs must recover without manual JSON editing.
- **Backward safety:** no breaking changes to existing artifact layout (`.task-forge/`).
- **Observability:** status and logs should remain operator-friendly.
- **Small commits:** changes should be split by behavior, validation, UX, and tests where practical.

## Constraints

- Node-first validation/testing only:
  - `node --test --experimental-strip-types`
  - `npx tsc -p <tsconfig> --noEmit` (never bare `tsc --noEmit` without `-p`, even with explicit file args)
- Do not reintroduce Deno test/check commands in TaskForge runtime/docs/tests.
- Keep v2 event-sourced engine authoritative.
- `state.json` is a derived snapshot/debug artifact, not the source of truth.
- Do not mix unrelated extension changes into this implementation batch.

## Design requirements

### DR-1 Transition policy module

Introduce or identify one place responsible for deciding:
- whether a run can execute,
- whether a run can resume,
- whether a blocker resolution should clear human intervention,
- which event(s) should be emitted next.

This can live in `v2/` if it can be made mostly pure/testable, with `index.ts` using it for command wiring.

### DR-2 Command validation helpers

Validation command normalization should be centralized and tested. It should not be duplicated in planner/test-designer command handlers.

Expected checks:
- detect `tsc --noEmit` without project/file target,
- detect Deno command usage in generated contracts,
- detect command-shaped prose,
- preserve valid Node test commands.

### DR-3 Event-first recovery

Recovery flows should append events, not directly patch `state.json` as the primary mechanism.

Required event sequence examples should be added to tests and docs.

### DR-4 UX evidence formatter

Human-facing evidence formatting should summarize known noisy outputs, including:
- TypeScript compiler help,
- long stack traces,
- repeated test suite output,
- known missing-command errors.

Full output should be preserved in validation output/artifacts.

## Acceptance criteria

- **AC-1:** `/forge execute`, `/forge resume`, and `/forge blocker` use consistent transition behavior.
- **AC-2:** `--patch-validation` and `--retry` can resolve a human-intervention latch when the target task is actionable.
- **AC-3:** Bare `tsc --noEmit` fails fast with concise guidance before producing compiler help spam.
- **AC-4:** Persisted task/spec validation commands are normalized or rejected before becoming authoritative.
- **AC-5:** `/forge blocker --list --json` returns machine-readable blocker state.
- **AC-6:** CI/local guard fails if `Deno.test`, `deno test`, or `deno check` appears in TaskForge runtime/docs/tests.
- **AC-7:** New lifecycle tests cover fail -> patch -> retry -> execute recovery.
- **AC-8:** Scheduling tests cover dependency-blocker cascade behavior on non-trivial DAGs.
- **AC-9:** Existing TaskForge test suite remains green under Node test runner.

## Suggested execution order

1. PR-1 + PR-2: transition reliability and human-intervention recovery
2. PR-3 + PR-4: validation command safety and normalization
3. PR-5 + PR-6: operator UX and blocker JSON output
4. PR-7 + PR-8: regression/CI hardening

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Transition helper becomes too coupled to `index.ts` | Keep decision logic pure and command side effects at edges |
| Command normalization changes user-provided commands unexpectedly | Normalize only known unsafe shapes; otherwise reject with guidance |
| CI Deno guard blocks legitimate historical docs | Scope guard to TaskForge runtime/current docs/tests, or allow archived history directory |
| Event changes break replay compatibility | Add migration notes/tests and keep event additions backward-compatible |
| UX truncation hides important debugging data | Preserve full output in artifacts/logs and reference where to find it |

## Deliverables

- Updated TaskForge runtime code (`index.ts`, `v2/*` as needed)
- Updated docs/runbook where behavior changes
- New/updated tests and CI checks
- No unrelated extension changes in the same implementation batch

## Validation plan

Run targeted tests for changed modules, then full TaskForge suite:

```bash
node --test --experimental-strip-types 'agent/extensions/task-forge/**/*.test.ts' 'tests/**/*.test.ts'
```

Before merging, also run a grep/policy check to ensure no Deno test/check commands remain in active TaskForge paths.
