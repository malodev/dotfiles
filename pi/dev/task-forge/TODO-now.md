# TaskForge TODO (Now)

## Sprint-priority (next 1–2 sprints)

### 1) Reliability / unblockability
- [ ] Unify status gating (`execute` / `resume` / blocker flows) behind one transition validator.
- [ ] Auto-clear `pendingHumanIntervention` when blocker patch/retry makes task runnable.
- [ ] Add explicit event sequence for patch->resolve->requeue (`human_intervention_resolved`, `task_requeued`).

### 2) Validation command safety
- [x] Hard-fail on bare `npx tsc --noEmit` (no `-p`, no file args) during preflight.  
  *Done: `normalizeBareTypecheckThenNodeTestCommand` strips tsc from all `tsc && node --test` patterns lacking `-p`.*
- [x] Normalize command-mode validation at artifact write-time (planner/test-designer outputs).  
  *Done: agent prompts updated to generate `node --test` directly.*
- [ ] Add optional command allowlist policy mode in config.

### 3) User-facing signal quality
- [ ] Truncate noisy error evidence in intervention messages; keep full logs in artifacts.
- [ ] Add concise next-step suggestions for common failure signatures.
- [ ] Add `/forge blocker --list --json` for scriptable triage.

### 4) Test/CI guards
- [ ] CI check: fail on `Deno.test`, `deno test`, `deno check` in TaskForge paths.
- [ ] Add lifecycle integration test: fail -> patch -> retry -> resume -> execute.
- [ ] Add scheduling property tests for blocker cascade on randomized DAGs.

### 5) Architecture consistency
- [ ] Remove residual V1 bridging where possible; keep handlers V2-authoritative.
- [ ] Add versioned event contract doc (`EVENTS.md`) with invariants and migration notes.
