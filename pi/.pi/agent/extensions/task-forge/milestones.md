# TaskForge Milestones (Execution Plan)

This maps `TODO-now.md` to concrete PR-sized chunks.

## Milestone 1 — Unblockability & Status Transitions

### PR-1: Unified command transition guard
**Scope**
- Centralize transition checks used by `/forge execute`, `/forge resume`, `/forge blocker ...`
- Replace ad-hoc status checks with one state machine helper

**Files (expected)**
- `agent/extensions/task-forge/index.ts`
- `agent/extensions/task-forge/v2/derive.ts` (if needed for transition semantics)
- `agent/extensions/task-forge/v2/*.test.ts` (new transition tests)

**Acceptance**
- No dead-end states like `needs_human_intervention` + patched task + non-runnable command path.
- Same transition result regardless of command entrypoint.

---

### PR-2: Auto-resolve human intervention on actionable fixes
**Scope**
- When `--patch-validation` or `--retry` makes a human-blocked task runnable, emit `human_intervention_resolved` automatically.
- Preserve event audit chain.

**Files (expected)**
- `agent/extensions/task-forge/index.ts`
- `agent/extensions/task-forge/v2/events.ts`
- `agent/extensions/task-forge/v2/derive.ts`
- tests for blocker command flow

**Acceptance**
- `/forge blocker <id> --patch-validation ...` can transition run back to executable state without manual state surgery.

---

## Milestone 2 — Validation Command Safety

### PR-3: Deterministic TypeScript preflight checks
**Scope**
- Reject bare `npx tsc --noEmit` with explicit short guidance.
- Require either `-p/--project` or explicit TS file inputs.

**Files (expected)**
- `agent/extensions/task-forge/v2/preflight.ts`
- `agent/extensions/task-forge/v2/validation.ts`
- preflight/validation tests

**Acceptance**
- No full `tsc --help` dumps in normal user flow for this failure class.

---

### PR-4: Normalize command contracts at write-time
**Scope**
- Normalize planner/test-designer generated commands before persisting task contracts.
- Prevent stale invalid commands from entering `tasks_registered` events.

**Files (expected)**
- `agent/extensions/task-forge/index.ts` (plan/test-spec persistence points)
- `agent/extensions/task-forge/v2/validation.ts`
- contract patch tests

**Acceptance**
- Stored validation commands are always normalized and executable-shape compliant.

---

## Milestone 3 — Signal Quality / UX

### PR-5: Compact evidence output + verbose fallback
**Scope**
- Keep human-intervention messages short by default.
- Truncate massive stderr/help blocks and show actionable summary.
- Add verbose path (or log reference) for full detail.

**Files (expected)**
- `agent/extensions/task-forge/index.ts`
- status rendering tests

**Acceptance**
- Intervention message remains readable and action-oriented.

---

### PR-6: Blocker command UX improvements
**Scope**
- Add `--list --json` output for scriptable use.
- Improve blocker detail output consistency.

**Files (expected)**
- `agent/extensions/task-forge/index.ts`
- blocker command tests

**Acceptance**
- One command provides machine-readable blocker state.

---

## Milestone 4 — CI/Regression Hardening

### PR-7: CI policy guardrails
**Scope**
- Add CI checks to fail if `Deno.test`, `deno test`, or `deno check` appear in TaskForge runtime/docs/tests.

**Files (expected)**
- CI workflow/scripts under `.pi` repo tooling
- optional lint rule script

**Acceptance**
- Deno regressions are blocked at PR time.

---

### PR-8: Lifecycle and scheduling robustness tests
**Scope**
- Add end-to-end lifecycle test: fail -> patch -> retry -> execute.
- Add randomized DAG property tests for blocker cascade correctness.

**Files (expected)**
- `agent/extensions/task-forge/v2/*integration*.test.ts`
- `agent/extensions/task-forge/v2/execution*.test.ts`

**Acceptance**
- Regressions in recovery/scheduling are caught before merge.

---

## Suggested sequencing
1. PR-1, PR-2 (unlock flow reliability)
2. PR-3, PR-4 (prevent bad commands)
3. PR-5, PR-6 (better operator UX)
4. PR-7, PR-8 (long-term safety net)

## Optional issue labels
- `task-forge`
- `reliability`
- `state-machine`
- `validation`
- `ux`
- `ci`
- `tests`
