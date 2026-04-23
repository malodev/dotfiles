# Contract-aware blocker resolution runbook

This runbook is for operators handling TaskForge blocker resolution in live or test runs.

## Quick triage

### 1. Check authoritative state
Inspect:
- `.task-forge/state.json`
- `.task-forge/events.jsonl`

Treat `events.jsonl` as the source of truth and `state.json` as the derived snapshot.

### 2. Identify the root actionable blocker
Run `/forge status` and confirm:
- `primary blocker`
- `blocker category`
- `remediation direction`
- `downstream impact`

If several tasks are blocked, resolve the root blocker first. Do not start by patching a dependency symptom.

### 3. Map category to action
- `environment` / `runtime` / `unknown` → usually **retry** after correction
- `dependency` → resolve upstream blocker first, then **retry**
- `validation_contract` → **patch task contract** or **patch test spec**
- `plan_contract` → **replan task** or **replan subgraph**

## Standard operator workflow

### Retry path
Use when the contract is already correct and the failure was external or transient.

1. Correct the environment or upstream dependency issue.
2. Resolve the blocker:
   ```bash
   /forge blocker <task-id> --resolve "Environment fixed; retry only"
   ```
3. Resume execution:
   ```bash
   /forge execute
   ```

Expected evidence:
- `human_intervention_resolved`
- `task_requeued`

### Task-contract patch path
Use when the task validation contract itself is wrong.

Examples:
- prose acceptance command
- command-mode task that should be manual review

Resolution patterns:

Executable command fix:
```bash
/forge blocker <task-id> --resolve "Use executable checker invocation: `npx tsc --noEmit <target-files> && node --test --experimental-strip-types <target-test-files>`"
```

Manual review fix:
```bash
/forge blocker <task-id> --resolve "This is a manual validation task; no executable acceptance command is required. Reviewer should inspect the updated docs and confirm they are coherent."
```

Expected evidence:
- `human_intervention_resolved`
- `task_contract_patched`
- `task_requeued`

Required check:
- `task_contract_patched` must appear in `events.jsonl` **before** `task_requeued`

### Test-spec patch path
Use when the generated spec artifact is stale or wrong while the task intent is otherwise sound.

Structured patch example:
```bash
/forge blocker <task-id> --resolve 'Patch test spec JSON:
```json
{"validation":{"mode":"command","command":"pnpm test -- corrected-command"}}
```'
```

Expected evidence:
- `human_intervention_resolved`
- `test_spec_patched`
- `task_requeued`

Required check:
- `test_spec_patched` must appear before `task_requeued`
- the matching test-spec entry in `state.json` must show the corrected `validation`

### Replan path
Use when the mismatch is larger than a single field patch.

Task-level case:
- one task's generated contract or tests are structurally wrong

Subgraph case:
- multiple tasks were generated from a broken assumption

Operator expectation:
- regenerated artifacts must be persisted before the task is released for retry
- status should continue to point at the root blocker until the replan output is durable

## Restart-recovery troubleshooting

### Symptom: pi/session exited during blocker resolution
What to inspect:
- `.task-forge/events.jsonl`
- `.task-forge/state.json`

Healthy recovery shape:
- patch event exists (`task_contract_patched` or `test_spec_patched`)
- the patch event precedes `task_requeued`
- the derived snapshot after restart still contains the patched contract/spec

If the patch event exists and `task_requeued` does not:
- do **not** manually reapply a second patch yet
- reload status first and confirm whether the engine already resumed into approval-ready state
- if needed, resume with `/forge execute` only after verifying the artifact content in `state.json`

If `task_requeued` exists but the patch event does not:
- treat this as a durability bug or partial rollout regression
- stop automated retries for that task
- capture the event sequence and escalate

### Symptom: task immediately re-blocks after operator resolution
Likely causes:
- operator used retry when the real issue required patch/replan
- patch was malformed or outside the allowlist
- stale generated test spec was not updated
- blocker was resolved on a downstream dependency symptom instead of the root blocker

Checks:
1. Confirm blocker category in `state.json`.
2. Confirm the chosen remediation mode in blocker remediation metadata, if present.
3. Confirm patched `validation` in the task or test spec.
4. Confirm `/forge status` primary blocker changed or cleared as expected.

### Symptom: restart restored old blocker content
Checks:
- verify `events.jsonl` contains the patch event
- verify the patch event has a `durabilityCommitRef`
- derive whether `state.json` is stale versus the event log

Action:
- trust `events.jsonl`
- regenerate or reload the snapshot if necessary
- do not weaken validation just to get the task moving

## Log and metric references

### Event log references
Search for these event types in `.task-forge/events.jsonl`:
- `human_intervention_requested`
- `human_intervention_resolved`
- `task_contract_patched`
- `test_spec_patched`
- `task_requeued`

Useful correlation keys:
- `taskId`
- blocker `category`
- remediation `mode`
- `durabilityCommitRef`

### Snapshot references
Inspect in `.task-forge/state.json`:
- `blockers[]`
- `taskState[taskId].blocker`
- `taskState[taskId].resolutionInstruction`
- `tasks[].validation`
- `testSpecs[].validation`
- `pendingHumanIntervention`

### Metrics to monitor during rollout
At minimum, monitor:
- immediate re-block rate after human resolution
- remediation mode distribution
- root-actionable blocker selection count
- restart-recovery success rate

## Rollout procedure

### Recommended sequence
1. Enable the flow only for canary/internal runs.
2. Exercise these scenarios:
   - invalid validation command fixed via task-contract patch
   - stale generated spec fixed via test-spec patch
   - restart between patch persistence and retry
3. Confirm status output points to the root blocker, not only dependency symptoms.
4. Review event ordering for durability.
5. Expand rollout gradually.

### Feature flag strategy
Preferred runtime flag:
- `contractAwareBlockerResolution`

Enable together:
- resolution-mode selection
- structural remediation before requeue
- status root-blocker projection
- observability/metrics dashboards

Do not enable only the patching path without the status and observability pieces; that makes operator behavior harder to reason about.

If no runtime flag is available yet:
- use release gating/canary branches as the operational control
- document that the environment is effectively running with the feature enabled

## Escalation rules

Escalate to planner/maintainer review when:
- the patch needed is outside the allowlisted contract surface
- a single blocker reveals multi-task plan drift
- restart recovery shows `task_requeued` without a durable patch event
- repeated retries keep recreating the same blocker

## Non-goals to preserve during incident response

Do not paper over a bad contract by:
- heuristic shell filtering
- converting prose into guessed commands
- weakening typed validation rules
- mutating unrelated task fields just to get a retry through

The safe fix is to patch the typed contract, patch the typed test spec, or replan the affected task/subgraph.

## Known limitations / open questions

- Some environments may not yet expose a real runtime feature flag, so rollout may rely on release discipline.
- `manual_override` should remain rare and may need stricter policy/audit guidance.
- Replan responses are only as good as the regenerated artifacts supplied; operators must still inspect scope.
