# TaskForge Changelog

All notable changes to TaskForge are documented here.

---

## 2026-04-22

### Root-actionable blocker preference in `/forge status`

`/forge status` now prefers root actionable blockers over downstream dependency blockers when multiple tasks are blocked in a dependency chain.

**Behavior change:**
- Status projection now distinguishes between direct blockers (e.g., `plan_contract`, `validation_contract`, `runtime`) and dependency-only blockers
- The **primary blocker** is always the upstream root cause, not a downstream symptom
- **Downstream impact** is listed as secondary context for visibility

**Example:**
- `T5` has a direct `plan_contract` blocker (generated tests contradict task contract)
- `T6`, `T7`, `T8` are blocked only because they depend on `T5`
- `/forge status` now shows:
  - `blockers: T5, T6, T7, T8`
  - `primary blocker: T5`
  - `downstream impact: T6, T7, T8`
  - `next: /forge blocker T5 --resolve "..." then /forge execute`

Previously, status could misleadingly suggest resolving `T6` first even though `T6` was only blocked by `T5`.

**Deterministic ordering:**
- When multiple root blockers exist, selection follows priority order: `plan_contract` > `validation_contract` > `runtime` > `environment` > `dependency`
- Same-priority blockers are tie-broken by task ID for stable, reproducible status output

**Scope note — explicit non-goal:**
- **No execution semantic changes:** Task execution order, dependency resolution, and worker scheduling remain unchanged. This change affects only status presentation and next-step guidance.

---

## 2026-04-19

### Blocker remediation and operations documentation
- Added `docs/blockers/contract-aware-resolution.md`
- Added `docs/operations/runbook.md`
- Documented blocker categories and retry vs patch vs replan semantics
- Documented root-actionable blocker status behavior and durable patch-before-requeue expectations
- Added operator troubleshooting guidance for restart-recovery and event/snapshot inspection
- Preserved explicit non-goals:
  - no heuristic shell filtering
  - no weakened validation
- Recorded rollout guardrails, feature-flag strategy, and current known limitations/open questions

## 2026-04-11

### Initial architecture and implementation pass
- Created `PLAN.md` for the first TaskForge architecture draft
- Implemented initial multi-agent orchestration extension in `index.ts`
- Added early role definitions:
  - strategist
  - architect
  - coordinator

### Architecture revision to PLAN-1
- Adopted the stronger `PLAN-1.md` architecture
- Reworked TaskForge around:
  - Strategist
  - Planner
  - Approval Gate
  - Execution
  - Integration Review
- Moved from fixed role-model binding toward capability-tier routing
- Added richer task schema and state model

### Agent role redesign
- Replaced old role set with:
  - `strategist.md`
  - `planner.md`
  - `worker.md`
  - `worker-iterative.md`
  - `gate-reviewer.md`
  - `integration-reviewer.md`
- Removed obsolete split roles:
  - `architect.md`
  - `coordinator.md`

### Config support
- Added `task-forge.json` support
- Added project/global config handling
- Added tier-based role assignment config
- Added model override support

### Agent markdown files made live
- Updated `index.ts` to load agent definitions from `agents/*.md`
- Frontmatter now provides default metadata such as tools
- Agent body now serves as the runtime system prompt
- Split responsibility clearly between:
  - `agents/*.md` for prompts and tool defaults
  - `task-forge.json` for model routing and orchestration config

### Documentation
- Added `README.md`
- Added `ARCHITECTURE-REVIEW.md`
- Documented current architecture, roles, artifacts, and config behavior

### Test Designer architecture
- Added `agents/test-designer.md`
- Incorporated TDD architecture review observations
- Established grounded test-design policy:
  - contract tests
  - acceptance tests
  - integration tests
  - no invented internal APIs
- Added two-tier TDD model documentation:
  - pre-approval test design
  - implementation-time unit-level TDD

### Test Designer runtime integration
- Added `testDesigner` as a real runtime role
- Added Test Designer phase to orchestration flow
- Added generation of:
  - `03-test-spec.json`
  - `03-test-spec.md`
- Propagated test metadata into task context:
  - acceptance signal
  - coverage threshold
  - test spec refs

### Stronger gate review and diagnostics
- Added conditional strong gate review for test-heavy tasks
- Added `diagnosticReviewer` role
- Added diagnostic classification for persistent failures:
  - `implementation_error`
  - `test_spec_error`
  - `requirement_or_plan_error`
- Added automatic requeue on test-spec rewrite
- Added blocker generation for requirement/plan errors
- Added `diagnostic-reviewer.md`

### Validation and coverage improvements
- Added explicit validation tracking on tasks:
  - validation output
  - validation framework
  - last coverage
- Added acceptance signal normalization
- Added coverage-threshold enforcement
- Added framework-aware coverage parsing for common toolchains:
  - pytest / coverage.py / pytest-cov
  - jest / vitest / nyc / Istanbul
  - go test
  - cargo llvm-cov
  - tarpaulin
- Added conservative validation failure when threshold exists but coverage cannot be parsed

### Orchestrator-level TDD enforcement
- Added explicit iterative TDD phases:
  - red
  - green
  - refactor
  - complete
- Iterative tasks now track:
  - `tddPhase`
  - `redEstablishedAt`
  - `greenAchievedAt`
  - `refactorValidatedAt`
- Enforced red/green/refactor in the orchestrator, not just prompts
- Updated `worker-iterative.md` to align with orchestrator-controlled TDD

### Scope routing modes
- Added `scopeClassifier` role
- Added `agents/scope-classifier.md`
- Added orchestration modes:
  - `micro`
  - `standard`
  - `complex`
- Added routing artifact:
  - `00-routing.json`
- Added compact micro-mode planner path
- Added complex-mode checkpoint after requirements review

### Config lookup changes
- Expanded config search order to:
  1. `<cwd>/.pi/task-forge.json`
  2. `.pi/task-forge.json` in current-dir subtrees
  3. `~/.pi/agent/extensions/task-forge/task-forge.json`
- Added subtree search pruning for:
  - `.git`
  - `node_modules`
  - `.task-forge`

### Model policy updates
- Switched to OpenAI-first tier ordering
- Moved Anthropic to fallback-only
- Promoted:
  - `openai-codex/gpt-5.4` for reasoning
  - `openai-codex/gpt-5.3-codex` for coding and endurance
  - `openai-codex/gpt-5.1-codex-mini` and `gpt-5.3-codex-spark` for bulk
- Synced README and architecture review with live config

### New supporting files
- Added `CHANGELOG.md`

---

## Planned next improvements
- Deeper framework-specific validation adapters beyond regex-oriented parsing
- Broader diagnostic repair planning across related tasks
- Richer complex-mode checkpoint policy
- More detailed iterative TDD progress reporting
- Optional policy for skipping refactor on trivial iterative tasks
