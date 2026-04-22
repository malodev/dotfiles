# Contract-aware blocker resolution

This document describes the blocker categories, remediation modes, status behavior, and rollout guardrails for TaskForge's contract-aware blocker flow.

## Scope

This guidance matches the current V2 blocker model and resolution selector in:

- `agent/extensions/task-forge/v2/types.ts`
- `agent/extensions/task-forge/v2/blocker-classifier.ts`
- `agent/extensions/task-forge/v2/blocker-resolution-mode.ts`
- `agent/extensions/task-forge/v2/blocker-resolution.ts`
- `agent/extensions/task-forge/src/status/projection/root-actionable-blocker-selection.ts`

## Blocker categories

TaskForge persists blockers with a typed `category`.

### `environment`
Use when the failure is caused by the execution environment rather than a broken task/test contract.

Typical signals:
- timeout / transient network failure
- missing runtime or binary mismatch
- DNS / connection refused
- permission denied
- wrong working directory or unavailable service

Default remediation:
- **retry** after the environment is corrected

### `dependency`
Use when a task is blocked because an upstream task failed or is itself blocked.

Typical signal:
- blocker reason starts with `Blocked by failed dependency:`

Default remediation:
- **retry** only after the upstream root blocker is resolved
- operators should not patch the downstream task just because it is showing a dependency symptom

### `validation_contract`
Use when the task's validation definition is wrong.

Typical signals:
- acceptance/validation command is prose or non-executable
- manual review was encoded as a shell command
- validation contract does not match the intended command/manual mode

Default remediation:
- **patch task contract** when the task's own `validation` object is wrong
- **patch test spec** when the generated test spec is the wrong place to fix the contract
- plain retry is the exception, not the default

### `plan_contract`
Use when the generated plan/test artifacts disagree structurally with the intended work.

Typical signals:
- generated tests contradict the task contract
- planner output and test spec disagree
- the affected task or subtree needs regeneration

Default remediation:
- **replan task** for a localized contract error
- **replan subgraph** when the issue spans multiple dependent tasks or the blocker text indicates subtree/subgraph impact

### `runtime`
Use when execution failed for a real runtime reason that is not clearly an environment issue and not clearly a broken generated contract.

Default remediation:
- **retry** first, then escalate with diagnostics if repeated

### `unknown`
Fallback when evidence is insufficient.

Default remediation:
- **retry** conservatively, while improving diagnostics before further automation

## Resolution modes

TaskForge currently supports these remediation modes:

- `retry`
- `patch_task_contract`
- `patch_test_spec`
- `replan_task`
- `replan_subgraph`
- `manual_override`

### When to use `retry`
Use retry when the underlying task/test contract is still valid and the operator has corrected an external cause.

Good fits:
- environment/transient failures
- dependency blockers after the upstream blocker is fixed
- ordinary runtime flake
- explicit operator override text such as `force retry` / `retry only`

Do **not** use retry as a shortcut for a broken validation contract. That recreates the immediate re-block loop this feature exists to prevent.

### When to use `patch_task_contract`
Use when the task artifact itself needs a scoped, durable fix.

Current patch scope:
- allowlisted mutable field: `validation`

Examples:
- replace prose validation with an executable command-mode contract
- convert an incorrectly executable contract into `validation.mode = "manual"`

Patch rules:
- patch data must stay inside the allowlist
- validation must still pass typed contract validation
- TaskForge rejects out-of-bounds fields instead of silently accepting them

### When to use `patch_test_spec`
Use when the task is fine but the generated test-spec artifact contains the wrong validation contract.

Examples:
- the test spec references a stale command
- the acceptance signal in the generated spec contradicts the task validation contract

Behavior:
- the same allowlisted patch schema is applied
- the matching test-spec entry is updated durably before requeue

### When to use `replan_task`
Use when patching is too narrow and the single task should be regenerated.

Examples:
- task-specific plan/test mismatch
- a generated task description or validation contract must be rebuilt together

### When to use `replan_subgraph`
Use when the broken contract spans multiple dependent tasks.

Examples:
- planner/test-designer drift affects an entire subtree
- blocked task plus multiple downstream tasks show the same structural mismatch

### When to use `manual_override`
Reserved for operator-directed exceptions where automation should stand down and follow an explicit human decision.

Operational note:
- status renders this in the same broad direction as retry, not patch/replan

## Status behavior

`/forge status` uses the root-actionable blocker projection instead of blindly surfacing every dependency symptom as equally actionable.

What operators should expect:
- all unresolved blockers are listed
- the **primary blocker** is the first task to resolve
- dependency-only blockers are pushed into **downstream impact** context
- status shows a derived remediation direction:
  - `retry` for `retry` and `manual_override`
  - `patch/replan` for structural remediation modes

Example:
- `TF-05` has a `plan_contract` blocker
- `TF-06` and `TF-07` are blocked only because they depend on `TF-05`
- `/forge status` points to `TF-05` first and lists `TF-06`, `TF-07` as downstream impact

## Resolution lifecycle

When an operator resolves a blocker with `/forge blocker <task-id> --resolve "..."`:

1. TaskForge infers/selects a remediation mode from blocker category plus resolution text.
2. It writes `human_intervention_resolved`.
3. If structural remediation is required, it durably writes the patch/replan artifact first:
   - `task_contract_patched`, or
   - `test_spec_patched`, or
   - regenerated test-spec artifacts for replan flows
4. It then writes `task_requeued`.
5. The run returns to approval-required resume state.

Resulting state behavior:
- pending human intervention is cleared
- the blocked task is requeued as `pending`
- blocker entries for that task are removed from active unresolved status after requeue
- the run advertises resume readiness through approval/execute flow rather than silently continuing

## Observability hooks

Primary artifacts:
- `.task-forge/events.jsonl` — authoritative event log
- `.task-forge/state.json` — derived snapshot for inspection

Useful event names:
- `human_intervention_requested`
- `human_intervention_resolved`
- `task_contract_patched`
- `test_spec_patched`
- `task_requeued`

Useful fields:
- `blocker.category`
- `blocker.remediation.mode`
- `blocker.remediation.rationale`
- `blocker.remediation.durabilityCommitRef`
- `blocker.remediation.durabilityCommittedAt`

Suggested rollout metrics:
- immediate re-block rate after resolution
- remediation mode distribution
- root-blocker selection count in status output
- restart-recovery success rate for patch-before-requeue cases

## Rollout guardrails

### Recommended staged rollout
1. Ship behind a rollout gate for internal/canary use first.
2. Validate three paths in a sandbox run:
   - validation-contract patch
   - test-spec patch
   - restart between patch persistence and retry
3. Monitor immediate re-block rate and restart-recovery outcomes.
4. Expand to general use only after status guidance and durability traces are stable.

### Feature flag strategy
Recommended flag name:
- `contractAwareBlockerResolution`

Recommended gating points:
- blocker resolution mode selection
- durable patch/replan path before requeue
- root-actionable blocker rendering in status

Fallback behavior when disabled:
- preserve legacy retry-centric resolution behavior
- do not partially enable patching without status/observability updates

Current limitation:
- if your deployment has not yet wired a runtime flag, treat release/canary promotion as the rollout control and document that the code path is effectively always-on in that environment

## Non-goals and preserved safety boundaries

These are intentional non-goals and must remain true:

- **No heuristic shell filtering.** TaskForge should not try to "fix" invalid contracts by guessing which parts of prose look executable.
- **No weakened validation.** Manual validation must be represented explicitly as `validation.mode = "manual"`; real implementation tasks should still fail when command-mode validation is invalid or missing.
- **No free-form arbitrary task mutation.** Structural fixes are allowlisted and typed.
- **No dependency-symptom patching as a substitute for fixing the root blocker.**

## Known limitations and open questions

- `manual_override` exists in the type model but is intentionally narrow; teams should define who is allowed to use it and when.
- Replan flows currently depend on correctly supplied regenerated artifacts in the resolution path; operators should verify the replacement spec/task scope before requeue.
- A runtime feature flag is recommended as a rollout guardrail, but some environments may still rely on release-level gating until the toggle is wired.
- Documentation review should be reconciled with shipped behavior if TF-01..TF-08 semantics change further.
