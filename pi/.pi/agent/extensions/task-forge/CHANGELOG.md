# TaskForge Changelog

All notable changes to TaskForge are documented here.

---

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
