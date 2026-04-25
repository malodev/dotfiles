# TaskForge TODO (Later)

## Medium-term improvements

### 1) UX / operations
- [ ] Add blocker ID/flag autocompletion in `/forge blocker`.
- [ ] Add status compact/verbose modes (`/forge status --verbose`).
- [ ] Add machine-readable status output (`/forge status --json`).

### 2) Cost and policy controls
- [ ] Add per-phase/per-role spend guardrails (not only global `costLimitUsd`).
- [ ] Add adaptive retry policy by failure class (runtime vs contract vs dependency).

### 3) Contract ergonomics
- [ ] Add output-manifest mismatch assistant (suggest/auto-fix with confirmation).
- [ ] Add stronger schema validation for generated test specs before persistence.

### 4) Documentation hygiene
- [x] Archive historical plans (`PLAN.md`, `PLAN-1.md`, etc.) under `docs/history/`.
- [ ] Keep top-level docs minimal: architecture, runbook, config, event contract.
- [ ] Generate README config examples from actual config schema to avoid drift.

### 5) Optional platform enhancements
- [ ] Expose status/events stream for dashboard integration.
- [ ] Add resumable checkpoint metrics (mean recovery time, blocker resolution latency).
