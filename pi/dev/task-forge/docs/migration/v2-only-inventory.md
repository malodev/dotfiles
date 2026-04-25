# TF-00 — V1 Freeze Inventory and V2-Only Migration Map

Verified against repository state on **2026-04-24**.

This document is the concrete inventory for V1 authority paths, compatibility bridges, mixed-state decisions, and command entry points.

---

## 1) Canonical V2 authority (confirmed in repo)

These are the runtime-authoritative V2 modules and should remain the source of truth.

### Event-sourced state core
- `v2/events.ts`
- `v2/derive.ts`
- `v2/storage.ts`
- `v2/engine.ts`
- `v2/types.ts`

### Execution and orchestration
- `v2/execution.ts`
- `v2/runner.ts`
- `v2/task-runner.ts`
- `v2/task-executor.ts`
- `v2/supervisor.ts`
- `v2/command-adapter.ts`
- `v2/review.ts`
- `v2/gate-review.ts`
- `v2/diagnostic-review.ts`
- `v2/planning-recovery.ts`

### Validation/preflight and blocker model
- `v2/validation.ts`
- `v2/preflight.ts`
- `v2/blocker-model.ts`
- `v2/blocker-resolution.ts`
- `v2/blocker-resolution-mode.ts`
- `v2/blocker-classifier.ts`

### V2 status projection in `src/`
- `src/commands/status/render-root-blocker.ts`
- `src/status/projection/root-actionable-blocker-selection.ts`
- `src/status/blocker-classification.ts`

---

## 2) Active V1 authority paths (current runtime dependencies)

All items below are active in `index.ts` and must be treated as frozen V1 paths.

| V1 path | Evidence | Decision |
|---|---|---|
| `ForgeState` runtime authority | `index.ts` (`let state: ForgeState \| null = null`) | **Delete after command flip** |
| V1 status renderer | `index.ts` (`statusLabel`) | **Delete after command flip** |
| V1 state synthesis from V2 | `index.ts` (`createV1StateFromV2`) | **Delete after command flip** |
| V1 status mapping bridge | `index.ts` (`mapV2StatusToV1`) | **Delete after command flip** |
| V1 sync from authoritative snapshot | `index.ts` (`applyAuthoritativeSnapshotToV1`) | **Delete after command flip** |
| V1 task list accessor | `index.ts` (`taskListFromAuthoritative`) | **Delete after command flip** |
| V1 execution facts accessor | `index.ts` (`executionFactsFromAuthoritative`) | **Delete after command flip** |
| Session restore from session entries / `state.json` | `index.ts` (`ctx.sessionManager.getEntries()`, fallback state file parse in `session_start`) | **Quarantine to legacy import-only path** |
| V1 blocker sorting helper usage | `index.ts` (`v1BlockerSortOrder(state.blockers)`), helper in `v1-status-helpers.ts` | **Delete after command flip** |
| V1 state persistence | `index.ts` (`persistState` writes `state.json` + `state.log`) | **Delete after command flip** |

PRD-listed Phase-0 deletion candidates are fully mapped above:
- `ForgeState` runtime dependency
- `createV1StateFromV2`
- `applyAuthoritativeSnapshotToV1`
- `taskListFromAuthoritative`
- V1 `statusLabel`
- `v1-status-helpers.ts`
- session-entry restore as authoritative path
- V1 blocker sorting runtime path
- V1 status rendering
- V1-derived task list helpers

---

## 3) Compatibility bridges and migration helpers

| File | Role today | Decision |
|---|---|---|
| `v2/migrate.ts` | Converts legacy V1 snapshot shape (`migrateV1StateToEvents`, `migrateV1StateToSnapshot`) | **Quarantine: import/migration only** |
| `index.ts` bootstrap callers (`ensureV2BootstrappedFromCurrentState`, `loadAuthoritativeSnapshot`) | Calls migration helpers when V1 snapshot detected | **Quarantine behavior (startup import only)** |
| `v2/bridge.ts` | Runner bridge contract for command adapter | **Keep temporarily; re-evaluate after command extraction** |
| `v2/adapters.ts` | Adapters between index shell and V2 runner/task APIs | **Keep temporarily; simplify post-flip** |
| `v1-status-helpers.ts` | V1 blocker sort heuristic | **Delete after V1 status path removal** |

---

## 4) Mixed-state decisions (V1 + V2 both influence behavior)

| Mixed decision | Evidence | Migration action |
|---|---|---|
| Status fallback mixes V2 snapshot and V1 state | `statusSummaryFromV2(..., localState?)`, `statusSummary()` fallback to V1 `state` | Move to V2-only status service |
| Command gating falls back to V1 `state.status` | `effectiveCommandStatus` | Use V2 snapshot status only |
| Interrupted execution fallback can use V1 running tasks | `describeInterruptedExecution` wrapper falls back to V1 `state.tasks` | Use V2 `describeInterruptedExecutionV2` only |
| Command paths mutate both V2 and V1 mirrors | `/forge blocker` updates V2 + local `state` | Remove local mirror mutations |
| Integration review task list can read V1 mirror | `createV1StateFromV2(authoritative).tasks : state.tasks` | Use V2 tasks/runtime only |
| Plan/execution flows mutate V1 state directly | `initState`, `phaseClassifyScope`, `phaseAnalyze`, `phasePlanMicro`, `phasePlan`, `phaseDesignTests`, `executeApprovedPlan` all write to `state` | Move to V2 command services |

---

## 5) Command entry points (confirmed actual locations)

All command entry logic is currently inline in `pi.registerCommand("forge", { handler })` in `index.ts`.

| Command | Current branch location | Deprecation marker added |
|---|---|---|
| `/forge status` | `index.ts` (`if (!sub \|\| sub === "status")`) | yes |
| `/forge help` | `index.ts` (`if (sub === "help")`) | — |
| `/forge config` | `index.ts` (`if (sub === "config")`) | — |
| `/forge cost` | `index.ts` (`if (sub === "cost")`) | yes |
| `/forge models` | `index.ts` (`if (sub === "models")`) | yes |
| `/forge pause` | `index.ts` (`if (sub === "pause")`) | yes |
| `/forge resume` | `index.ts` (`if (sub === "resume")`) | yes |
| `/forge abort` | `index.ts` (`if (sub === "abort")`) | yes |
| `/forge execute` | `index.ts` (`if (sub === "execute")`) | yes |
| `/forge blocker` | `index.ts` (`if (sub === "blocker")`) | yes |

**Repository reality check:** target `v2/commands/*.ts` command services do **not** exist yet (as expected pre-migration-phase implementation).

---

## 6) Deprecation markers added

### `index.ts` markers
- `// @deprecated V1 import — FROZEN` on `v1BlockerSortOrder` import
- `// @deprecated V1 status renderer — FROZEN` on `statusLabel`
- `// @deprecated V1 compatibility bridge — FROZEN` on `mapV2StatusToV1`
- `// @deprecated V1 synthesis bridge — FROZEN` on `createV1StateFromV2`
- `// @deprecated V1 sync bridge — FROZEN` on `applyAuthoritativeSnapshotToV1`
- `// @deprecated V1-derived task list accessor — FROZEN` on `taskListFromAuthoritative`
- `// @deprecated V1-derived execution facts bridge — FROZEN` on `executionFactsFromAuthoritative`
- `// @deprecated V1 mutable runtime state — FROZEN` on `let state: ForgeState | null = null`
- `// @deprecated Hybrid gating fallback — FROZEN` on `effectiveCommandStatus`
- `// @deprecated V1 fallback in interrupted-execution detection — FROZEN` on `describeInterruptedExecution`
- `// @deprecated V1 state persistence path — FROZEN` on `persistState`
- `// @deprecated V1 status fallback — FROZEN` on `statusSummary`
- `// @deprecated Session restore as V1 authority — FROZEN` on session restore block in `session_start`
- `// @deprecated V1 command authority path — FROZEN` on each command handler branch
- `// @deprecated V1 runtime planning path — FROZEN` on `initState`, `phaseClassifyScope`, `phaseAnalyze`, `phasePlanMicro`, `phasePlan`, `phaseDesignTests`, `runPlanningFlow`
- `// @deprecated V1 runtime execution path — FROZEN` on `executeApprovedPlan`, `phaseIntegrationReview`

### `v1-status-helpers.ts` markers
- `// @deprecated V1 runtime helper — FROZEN` file-level JSDoc on `v1BlockerSortOrder`

---

## 7) Deletion vs quarantine map

### Delete-now target set (frozen; no new feature work)
- `index.ts` V1 authority helpers/types used for runtime command authority:
  - `statusLabel`
  - `mapV2StatusToV1`
  - `createV1StateFromV2`
  - `applyAuthoritativeSnapshotToV1`
  - `taskListFromAuthoritative`
  - `executionFactsFromAuthoritative`
  - V1 `state: ForgeState` command-authority dependence
- `v1-status-helpers.ts`

### Quarantine-for-import-only
- `v2/migrate.ts` (legacy import/migration only)
- `index.ts` startup migration bootstrap logic that invokes `migrateV1StateToEvents` / `migrateV1StateToSnapshot`
- session restore from legacy session/state artifacts should remain only as one-way import path, not command authority

### Transitional (review after command extraction)
- `v2/bridge.ts`
- `v2/adapters.ts`

---

## 8) Linked follow-up tasks

| Task | Scope |
|---|---|
| TF-01 | V2 command service extraction (execute, resume, pause, abort, blocker, status) |
| TF-02 | V2-only `/forge execute` and execution loop |
| TF-03 | V2 planning command service extraction |
| TF-04 | V2-only `/forge blocker` |
| TF-05 | V2-only `/forge status` and V1 status renderer removal |
| TF-06 | V2-only `/forge pause` |
| TF-07 | V2-only `/forge resume` |
| TF-08 | V2-only `/forge abort` |
| TF-09 | V2-only `/forge cost` |
| TF-10 | V2-only `/forge models` |
| TF-11 | Legacy migration hardening (one-way import, V2 ownership after import) |

---

## 9) TF-00 acceptance check

- [x] PRD-listed V1 deletion/quarantine candidates mapped to owning files
- [x] All known V1 command-authority touchpoints listed in audit artifact
- [x] Deprecated bridge helpers visibly marked in `index.ts` and `v1-status-helpers.ts`
- [x] No new behavior added to deprecated bridge helpers or V1 runtime paths
- [x] Deletion/quarantine targets explicitly linked to planned follow-up tasks
- [x] Command entry points confirmed against actual repository code
- [x] Canonical V2 authority paths confirmed against existing files
- [x] No V1 feature behavior added in TF-00 (documentation/markers only)
