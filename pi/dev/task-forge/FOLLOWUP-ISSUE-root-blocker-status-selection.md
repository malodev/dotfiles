# Follow-up Issue: Prefer root actionable blocker in `/forge status`

## Title
Prefer root actionable blocker in `/forge status`

## Summary
When multiple tasks are blocked, `/forge status` currently surfaces one blocker summary, but it can choose a downstream dependency blocker instead of the real root actionable blocker.

This creates misleading next-step guidance such as:
- `next: /forge blocker T6 --resolve "..." then /forge execute`

when T6 is only blocked because T5 is blocked.

## Problem
In dependency chains, downstream blocked tasks are often not directly actionable.

Example:
- T5 is blocked because of an invalid validation contract
- T6, T7, T8 are blocked because they depend on T5
- `/forge status` can surface T6 as the primary blocker
- user is then told to resolve the wrong task first

## Goal
Make `/forge status` prefer the root actionable blocker rather than a downstream dependency blocker.

## Desired behavior
If a task is blocked only because one of its dependencies is blocked or failed, status should prefer the upstream/root blocker.

Example desired output:
- blockers: `T5, T6, T7, T8`
- primary blocker: `T5`
- next: `/forge blocker T5 --resolve "..." then /forge execute`

## Suggested approach
### Root-blocker selection rules
Prefer blockers in this order:
1. pending human-intervention task
2. task blocked for direct contract/runtime/gate reasons
3. only if no direct blocker exists, fall back to dependency-blocked task

### Heuristic for dependency blockers
If blocker reason matches patterns like:
- `Blocked by failed dependency: ...`

then attempt to resolve the upstream blocked task and use that as the primary blocker shown in status.

## Scope
- status summary selection logic
- next-step guidance selection
- optional deeper blocker graph derivation in V2

## Acceptance criteria
- `/forge status` points users to the true root actionable blocker when one exists
- downstream dependency blockers do not overshadow upstream root blockers
- next-step guidance becomes more accurate in dependency chains

## Non-goals
- do not change task execution semantics
- do not introduce smoke-test-specific shortcuts

## Context
This follow-up was identified during TaskForge V2 smoke testing when `/forge status` suggested resolving T6 even though T6 was only blocked by dependency on T5, which was the actual root actionable blocker.
