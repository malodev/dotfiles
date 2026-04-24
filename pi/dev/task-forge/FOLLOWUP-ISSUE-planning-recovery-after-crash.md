# Follow-up Issue: Add durable planning recovery after crash/restart

## Title
Add durable planning recovery after crash/restart

## Summary
TaskForge has explicit interruption recovery for execution, but planning phases do not currently recover in the same durable way after a pi crash, OS restart, or abrupt session termination.

This can leave `/forge status` showing a stale planning phase even though no planner/test-designer process is actually running anymore.

## Problem
Observed behavior after crash/restart:
- TaskForge status can still show `planning`
- phase may remain at `Scope Classification`, `PRD Analysis`, `Planning & Decomposition`, or `Test Design`
- no `active agent` is present
- no background planning process is actually advancing
- user is left without a clear resume path

Current behavior is better for execution because execution has explicit interruption recovery and durable requeue/pause semantics.

## Goal
Make planning recoverable and/or clearly restartable after interruption, with durable state that distinguishes:
- planning actively running
- planning interrupted and resumable
- planning interrupted and must be restarted

## Desired behavior
After crash/restart, TaskForge should do one of these cleanly:

### Option A — resumable planning
If a planning phase is safe to resume:
- mark planning as interrupted/resumable
- restore enough state to continue from the correct phase
- provide a clear next action

### Option B — restart-required planning
If planning cannot safely resume:
- mark state as interrupted/stale
- show a clear next step such as:
  - rerun `/forge <prd>`
  - or `/forge execute` only when `nextAction: continuePlanning` truly applies

## Scope
### Durable planning runtime state
Track planning activity explicitly, similar to execution runtime state, including:
- active planning agent role
- started-at timestamp
- phase start timestamp
- interrupted flag or planning-runtime marker

### Session startup reconciliation
On session start:
- detect stale planning-in-progress state with no live runtime
- classify it as resumable or restart-required
- avoid silently leaving status stuck at `planning`

### Status UX
`/forge status` should make stale planning obvious.

Example desired output:
- `planning appears interrupted after restart`
- `next: rerun /forge <prd>`

or, if resumable:
- `next action: continuePlanning`
- `/forge execute` can continue the planning checkpoint only when that is actually valid

## Acceptance criteria
- crash/restart does not leave planning looking live when nothing is running
- users get a clear, correct next step after interrupted planning
- resumable planning checkpoints are explicit and durable
- non-resumable planning states are clearly marked as stale/restart-required

## Non-goals
- do not add smoke-test-specific logic
- do not blur planning and execution recovery semantics without explicit state transitions

## Suggested implementation plan
1. Add durable planning-runtime metadata/state
2. Define which planning phases are resumable vs restart-required
3. Reconcile interrupted planning during session startup
4. Improve `/forge status` for stale/interrupted planning
5. Add regression coverage for crash/restart during planning

## Context
This follow-up was identified after a system crash during planning. On restart, `/forge status` still showed planning state, but no active agent/runtime was present and there was no clear user command to continue the planning phase safely.
