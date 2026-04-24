# Follow-up Issue: Add typed validation modes for docs/manual-review tasks

## Title
Add typed validation modes for docs/manual-review tasks

## Summary
TaskForge currently assumes executable validation for tasks that reach execution. This works well for implementation tasks with a real test or acceptance command, but it is awkward for documentation, configuration, and manual-review tasks where validation is often non-executable.

We should replace this implicit assumption with a typed validation contract so TaskForge can distinguish between:
- executable command validation
- manual/reviewer-only validation

## Problem
Current behavior can force docs/manual-review tasks into one of these bad outcomes:
- missing-acceptance-command blockers even when the task is valid as a manual/docs task
- planner/test-design output mixing executable commands with prose guidance
- user confusion about what kind of resolution is expected
- avoidable blocker churn in otherwise legitimate repo-grounded tasks

## Goal
Introduce explicit validation modes so TaskForge can cleanly support both implementation tasks and manual/docs/config tasks without relying on heuristics.

## Proposed design
Add a typed validation contract to task/test-spec surfaces.

### Example shape
```ts
interface TaskValidationContract {
  mode: "command" | "manual";
  command?: string;
  notes?: string;
}
```

### Semantics
- `mode: "command"`
  - execute `command`
  - parse result / coverage / framework as today
- `mode: "manual"`
  - do not run shell validation
  - use gate review + task output/artifact inspection for acceptance
  - allow `notes` to explain what reviewers should confirm

## Scope
### Planner / test-designer / task schema
- update prompts and JSON schema so executable validation and manual validation are distinct fields
- stop overloading `acceptanceSignal` / `testCommand` with prose guidance

### Preflight
- only require executable acceptance commands when `mode === "command"`
- for `mode === "manual"`, skip command preflight and provide clearer status output

### Execution / success path
- command mode: current validation flow
- manual mode: skip shell validation, proceed to gate review with task result + manual validation notes

### Status / UX
- `/forge status` should show the validation mode for blocked/manual tasks when relevant
- blocker messages should explain whether the task expects executable validation or manual review

## Acceptance criteria
- docs/config/manual-review tasks can execute without an invented shell command
- implementation tasks still use executable validation normally
- planner/test-designer outputs never require heuristic detection of prose-vs-command
- blocker guidance becomes clearer and more task-aware
- smoke tests can cover both command-validation and manual-validation tasks

## Non-goals
- do not add smoke-test-specific heuristics
- do not weaken validation for normal implementation tasks

## Suggested implementation plan
1. Add typed validation contract to V2 types
2. Update planner/test-designer prompts and parsing
3. Update preflight to branch on validation mode
4. Update task success path to skip shell validation for manual mode
5. Update gate review prompts to include manual validation notes
6. Add regression/smoke coverage for both modes

## Context
This follow-up was identified during TaskForge V2 smoke testing in a repo-grounded documentation task, where execution produced a legitimate blocker because the system still expected an executable acceptance command for a docs-only task.
