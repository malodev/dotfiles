# Auto-Clear Lifecycle Audit

> **Goal:** Map exact insertion points for auto-clearing `pendingHumanIntervention` when blocker patch/retry resolves the underlying issue, without requiring manual `/forge blocker --resolve`.

## Current flow (manual)

```
task fails → human_intervention_requested → pendingHumanIntervention set
→ user runs /forge blocker --resolve → human_intervention_resolved
→ user runs /forge execute → execution resumes
```

## Target flow (auto-clear)

```
task fails → human_intervention_requested → pendingHumanIntervention set
→ user runs /forge blocker --patch-validation "cmd" → patch applied
→ pendingHumanIntervention auto-cleared → human_intervention_resolved + task_requeued
→ user runs /forge execute → execution resumes (no manual --resolve step)
```

## Touchpoints

### 1. `src/commands/blocker.ts`

**`patchValidation(snapshot, input)`**
- After appending `task_contract_patched` event
- Add: check if task has `pendingHumanIntervention` → emit `human_intervention_resolved` + `task_requeued`

**`retryTask(snapshot, input)`**
- After appending `task_requeued` event
- Add: check if task has `pendingHumanIntervention` → emit `human_intervention_resolved`

**`resolveBlocker(snapshot, input)`**
- Existing behavior: manual resolution — keep as-is for manual cases
- No auto-clear changes needed here

### 2. `src/derivation/derive.ts`

**`deriveStatus(snapshot)`**
- Line ~35: `if (snapshot.pendingHumanIntervention) return "needs_human_intervention"`
- No change needed — status derivation is correct. After `human_intervention_resolved` event is emitted, `pendingHumanIntervention` is cleared by the event handler.

### 3. `src/events.ts`

**Existing events (reuse, no schema changes):**
- `human_intervention_resolved: { taskId, resolution, resolutionMode? }`
- `task_requeued: { taskId, reason, resolutionInstruction? }`

**No new event types needed.**

### 4. `src/transition-policy.ts`

**`canExecute(snapshot)`**
- Currently checks `snapshot.pendingHumanIntervention`
- No change needed — function checks snapshot state which is derived from events

### 5. `index.ts` — Command handlers

**`handleBlockerCommand` (~line 1928)**
- Currently requires explicit `--resolve` for human intervention
- Add auto-clear for `--patch-validation` and `--retry` subcommands:
  - After applying the V2 command events
  - Check `v2Task?.runtime.pendingHumanIntervention`
  - If present and patch/retry succeeded, emit resolution events

### 6. Deterministic ordering

```
task_contract_patched (or task_requeued)
→ human_intervention_resolved (auto)
→ task_requeued
```

### 7. Canonical reason string

```
"Auto-resolved: blocker patch/retry makes task executable"
```

Used consistently in both `human_intervention_resolved.resolution` and `task_requeued.reason`.

## Test plan

Integration test (`tests/integration/auto-clear-lifecycle.test.ts`):

1. Create run with a failing command-validation task
2. Task fails → `human_intervention_requested` → `pendingHumanIntervention` set
3. Patch validation → `task_contract_patched` → auto-clear → `human_intervention_resolved` + `task_requeued`
4. Verify snapshot: `pendingHumanIntervention` is null, status is `executing` or `awaiting_approval`
5. Replay events → verify same snapshot state
6. Replay after simulated restart → verify same

## Non-goals

- Auto-clear for manual resolution (`--resolve`) — manual stays manual
- Auto-clear on `--force-unblock` — this forcibly changes state, keep separate
- Schema changes — all existing event types reused
