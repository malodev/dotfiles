# TaskForge Roadmap PRD

## Executive summary

Two remaining friction points from the V2-only migration:

1. Blocker resolution is manual even when it's deterministic — patching validation or retrying a task should auto-clear human intervention.
2. The core lifecycle (fail → patch → retry → resume → execute) has no end-to-end test, causing regressions during development and forge runs.

## Core objectives

1. Eliminate the manual `/forge blocker T2 --resolve "..."` step when the system already has enough information to auto-clear the intervention.
2. Add a replay-backed lifecycle integration test covering the full blocker resolution flow.

## Functional requirements

### FR-1: Auto-clear on patch → retry

When a human-intervention-blocked task is patched (validation command fixed) and retried:

- **Must:** Clear `pendingHumanIntervention` on the run snapshot without requiring a manual `/forge blocker --resolve`.
- **Must:** Emit `human_intervention_resolved` event with the resolution context (patch content, reason).
- **Must:** Emit `task_requeued` event immediately after resolution.
- **Must:** After auto-resolution, `/forge execute` should be possible without additional manual steps.

### FR-2: Lifecycle integration test

- **Must:** Cover the full flow: task fails → human intervention raised → blocker created → validation patched → task retried → run becomes executable.
- **Must:** Use event replay to verify that the snapshot derived from events correctly reflects each state transition.
- **Must:** Exit 0 on success, exit 1 on any state mismatch.

### FR-3: Deterministic after restart

- **Must:** The auto-clear behavior must produce the same result after a pi restart (event replay is deterministic).

## Non-functional requirements

- No change to the `/forge` user-facing command surface.
- No change to the event schema — reuse existing `human_intervention_resolved` and `task_requeued` events.
- The integration test must run via `node --test --experimental-strip-types`.

## Constraints

- Node-based testing only (`node --test`).
- V2 event-sourced engine is authoritative.
- Do not introduce new event types — reuse existing ones.

## Success metrics

- `/forge blocker T2 --patch-validation "new-command"` followed by `/forge execute` works without manual `--resolve`.
- Integration test passes in CI.
- Drift checks still pass (`bash scripts/drift-check.sh`).
- All 320 existing tests still pass.

## Risks and dependencies

- The blocker command handler (`src/commands/blocker.ts`) and the transition policy (`src/transition-policy.ts`) both need changes for auto-clear.
- The execution flow in `index.ts` currently requires `pendingHumanIntervention` to be cleared before execution can resume — this gating logic needs to be audited for the auto-clear path.
