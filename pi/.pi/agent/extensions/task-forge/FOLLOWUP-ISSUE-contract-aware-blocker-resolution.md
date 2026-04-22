# Follow-up Issue: Add contract-aware blocker resolution for invalid task/test contracts

## Title
Add contract-aware blocker resolution for invalid task/test contracts

## Summary
TaskForge can currently surface blockers and accept user resolutions, but for plan/test-contract problems the resolution is mostly advisory: the task is requeued without structurally updating the underlying task contract.

This means a task can immediately re-block if the real issue is still present in the generated task/test spec (for example, a prose acceptance command being retried as if it were executable).

## Problem
Current blocker resolution works well for:
- environment setup fixes
- user-provided clarification
- retry after transient issues

But it is insufficient for contract-level issues such as:
- invalid/non-executable acceptance commands
- plan/test-spec mismatch
- manual-validation tasks represented as executable validation
- stale/generated task assumptions that need regeneration

In these cases, `/forge blocker ... --resolve ...` requeues the same broken task contract, so the task can fail again immediately.

## Goal
Make blocker resolution contract-aware so plan/test-spec/validation-contract problems can trigger structural correction instead of a plain retry.

## Desired behavior
When the blocker reason is fundamentally about task/test contract validity, TaskForge should be able to do one of these instead of only requeueing unchanged work:
- patch the task validation contract
- patch the generated test spec
- regenerate the affected task or subtree
- re-enter a planning/diagnostic path that produces a corrected contract

## Example failure mode
Observed during smoke testing:
- task T5 was blocked because its acceptance command contained prose, not an executable command
- resolving the blocker with a good explanation requeued T5
- `/forge execute` retried T5 with the same invalid contract
- T5 re-blocked immediately
- downstream tasks were then blocked by dependency

This demonstrates that user resolution text was preserved, but the task contract was not changed.

## Proposed design
Introduce a typed blocker-resolution path.

### Example conceptual shape
```ts
type BlockerResolutionMode =
  | { kind: "retry" }
  | { kind: "patch_task_contract"; patch: unknown }
  | { kind: "patch_test_spec"; patch: unknown }
  | { kind: "replan_task"; taskId: string }
  | { kind: "replan_subgraph"; rootTaskId: string };
```

### Resolution flow
1. user resolves blocker with `/forge blocker ... --resolve ...`
2. TaskForge classifies the blocker type
3. if it is an environment/transient issue → normal requeue
4. if it is a contract issue → patch/regenerate before requeue

## Scope
### Blocker classification
Distinguish between:
- transient/environment blockers
- dependency blockers
- invalid validation contract blockers
- plan/test-spec mismatch blockers

### Resolution engine
Allow blocker resolution to:
- mutate task validation fields
- update test specs
- invoke targeted re-planning/diagnostic agents
- record structural changes durably before requeue

### Status UX
`/forge status` should prefer the root actionable blocker, not only downstream dependency blockers.

Example:
- if T6/T7/T8 are blocked because of T5,
- status should point the user to resolve T5 first.

## Acceptance criteria
- resolving a contract-level blocker does not simply requeue unchanged broken work
- invalid acceptance/test contracts can be patched or regenerated before retry
- downstream dependency blockers do not hide the real root blocker in `/forge status`
- blocker resolution remains durable and restart-safe
- no smoke-test-specific hacks are required

## Non-goals
- do not add heuristic shell filtering to paper over invalid task contracts
- do not weaken validation for real implementation tasks

## Suggested implementation plan
1. Add typed blocker categories to V2 state/diagnostics
2. Teach diagnostics/reviewer flow to emit contract-aware remediation actions
3. Add task/test-spec patching hooks to blocker resolution
4. Add targeted replan path for affected task/subgraph
5. Improve `/forge status` root-blocker selection
6. Add regression tests for immediate-reblock scenarios

## Context
This follow-up was identified during TaskForge V2 smoke testing after a task contract issue (prose acceptance command) was resolved textually, but the task was requeued without structural correction and immediately blocked again.
