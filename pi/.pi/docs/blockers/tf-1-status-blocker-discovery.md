# TF-1 Discovery — `/forge status` blocker selection flow + fixture matrix

## 1) Current `/forge status` blocker-selection flow

### Command entrypoints
1. `agent/extensions/task-forge/index.ts`
   - `statusSummary(ctx?)`
   - If authoritative V2 snapshot exists: `statusSummaryFromV2(snapshot, state)`
   - Else fallback to legacy V1 summary formatting.

### V2 path (primary current behavior)
2. `statusSummaryFromV2(...)` appends status blocker block by calling:
   - `renderRootActionableBlockerStatus(snapshot)` in `agent/extensions/task-forge/src/commands/status/render-root-blocker.ts`
3. Presenter calls selector/projection:
   - `projectRootActionableBlocker(snapshot)` in `agent/extensions/task-forge/src/status/projection/root-actionable-blocker-selection.ts`
4. Selector behavior (today):
   - builds unresolved blocker list (`snapshot.blockers` + optional `pendingHumanIntervention.taskId`)
   - detects dependency blockers via category `dependency` OR reason prefix `Blocked by failed dependency:`
   - resolves candidate root using task DAG (`tasks[].dependencies`) and dependency task status (`taskState[dep].status`)
   - ranks actionable roots by:
     1) downstream impact size (desc)
     2) category priority (`validation_contract`, `plan_contract`, `runtime`, `environment`, `unknown`, `dependency`)
     3) task id (lexicographic)
   - renders:
     - full blocker list
     - `primary blocker: ...`
     - `downstream impact: ...`
     - `next: /forge blocker <primary> --resolve "..." then /forge execute`

### Legacy V1 fallback behavior
5. `statusSummary(...)` fallback in `index.ts` uses `v1BlockerSortOrder(...)` from `agent/extensions/task-forge/v1-status-helpers.ts`.
   - heuristic-only sort: reasons starting with `Blocked by failed dependency:` go last
   - no explicit primary blocker selection
   - no explicit next-guidance tied to a primary blocker

---

## 2) Dependency metadata vs reason-text availability

### Structured metadata available
- `tasks[].dependencies` (`agent/extensions/task-forge/v2/types.ts`) — canonical DAG edge data.
- `taskState[taskId].status` — failed/blocked dependency state.
- `blockers[].category` — typed blocker category.
- `blockers[].blockedTasks` — set-like impact list (not guaranteed as explicit edge direction).

### Reason-text-only input
- `blockers[].reason` sometimes embeds upstream refs, typically:
  - `Blocked by failed dependency: TF-05`
- current resolver does **not** parse task IDs from arbitrary reason text; it only prefix-checks for dependency classification.

Implication: robust root resolution prefers DAG metadata; reason text is currently a weak signal.

---

## 3) Fixture matrix (executable-oriented)

> Format: `taskState/status + blockers + dependencies -> expected primary + next guidance target`

| Fixture ID | Graph / Input shape | Key blocker reasons/categories | Expected primary blocker | Expected `next` target | Current behavior note |
|---|---|---|---|---|---|
| F1-direct-root | `T5` only blocked root | `T5` category `plan_contract` (direct) | `T5` | `T5` | Pass |
| F2-prd-chain | `T5 -> T6,T7,T8`; `T6..T8` blocked via `T5` | `T5` direct (`plan_contract`), `T6..T8` dependency (`Blocked by failed dependency: T5`) | `T5` | `T5` | **PRD example**; expected pass on V2 selector |
| F3-multi-hop | `T5 -> T6 -> T7 -> T8` | `T5` direct root, downstream dependency blockers | `T5` | `T5` | Pass when DAG metadata present |
| F4-ambiguous-reason | DAG present, dependency blocker reason malformed (`"blocked due upstream issue"`) but category=`dependency` | dependency category still identifies downstream as non-root | upstream root (e.g. `T5`) | `T5` | Pass if root blocker exists in unresolved blockers |
| F5-reason-only-no-dag (failing) | Downstream blocker references upstream in reason text, but task dependencies missing/incomplete | e.g. `T6` reason mentions `T5` but no DAG edge available | `T5` (desired) | `T5` (desired) | **Fail** today: resolver cannot parse arbitrary reason text for root id |
| F6-root-failed-no-blocker-record (failing dependency chain) | `T5` is `failed` in taskState but has no unresolved blocker entry; `T6..T8` are dependency-blocked via `T5` | downstream dependency blockers only | `T5` (desired actionable root) | `T5` (desired) | **Fail** today: primary falls back to first downstream unresolved blocker (e.g. `T6`) |

### Compact JSON fixture sketch (for later tests)
```json
[
  {
    "id": "F2-prd-chain",
    "tasks": ["T5", "T6", "T7", "T8"],
    "dependencies": {"T6": ["T5"], "T7": ["T5"], "T8": ["T5"]},
    "blocked": ["T5", "T6", "T7", "T8"],
    "blockers": {
      "T5": {"category": "plan_contract", "reason": "Generated tests contradict task contract"},
      "T6": {"category": "dependency", "reason": "Blocked by failed dependency: T5"},
      "T7": {"category": "dependency", "reason": "Blocked by failed dependency: T5"},
      "T8": {"category": "dependency", "reason": "Blocked by failed dependency: T5"}
    },
    "expect": {"primary": "T5", "nextGuidanceTask": "T5"}
  }
]
```

---

## 4) Implementation touch points for TF-2/TF-3/TF-4

### Classifier insertion points
- `agent/extensions/task-forge/v2/blocker-classifier.ts`
  - `classifyBlockerEvidence(...)`
- Upstream blocker creation signals:
  - `agent/extensions/task-forge/v2/execution.ts` (`createDependencyBlocker(...)`)

### Resolver insertion points
- `agent/extensions/task-forge/src/status/projection/root-actionable-blocker-selection.ts`
  - `isDependencyBlocker(...)`
  - `findRootBlockerTaskId(...)`
  - place to add reason-id parsing fallback when DAG metadata missing

### Selector insertion points
- same module, in root ranking and primary fallback:
  - `actionableRoots` derivation
  - `sortedRoots` ranking rules
  - `primaryBlocker` fallback chain

### Presenter integration points
- `agent/extensions/task-forge/src/commands/status/render-root-blocker.ts`
  - primary blocker line, downstream impact line, next guidance formatting
- `agent/extensions/task-forge/index.ts`
  - `statusSummaryFromV2(...)` inclusion
  - legacy `statusSummary(...)` fallback behavior (v1 path) remains separate and heuristic

---

## 5) Key discovery conclusions

1. Canonical status blocker selection path is now modularized (projection selector + renderer), so TF-2/TF-3/TF-4 can be implemented without broad command-handler rewrite.
2. Root resolution is metadata-first (task DAG/status), with limited reason-string semantics.
3. At least two dependency-chain gaps remain when metadata is incomplete (`F5`, `F6`), including a concrete failing scenario where desired primary is upstream `T5` but current primary can be downstream `T6`.
4. PRD chain example `T5,T6,T7,T8` is directly representable and expected to produce primary `T5` with next guidance targeting `T5`.
