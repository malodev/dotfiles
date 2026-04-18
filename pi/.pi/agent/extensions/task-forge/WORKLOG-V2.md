# TaskForge V2 Worklog

_Last updated: 2026-04-16 (session 2)_

This file is the **working memory log** for the TaskForge V2 rewrite.

Use it to answer:
- what has already been done
- which design choices were made
- which problems were encountered
- how those problems were resolved
- what remains next

This complements:
- `REFACTOR-ROADMAP-V2.md` — active forward plan
- `ARCHITECTURE-V2.md` — target architecture and durable model
- `CONTINUE-V2-PROMPT.md` — clean-session handoff prompt for a new agent
- `REGRESSION-CHECKLIST-V2.md` — regression gate for refactor safety
- `CHANGELOG.md` — user-facing/history-oriented changes

If you need the current plan, read `REFACTOR-ROADMAP-V2.md`.
If you need the historical reasoning and resolved problems, read this file.

## Continuity contract

After any meaningful refactor step, update this file with:
- what changed
- why the change was made
- choices/constraints introduced or confirmed
- problems encountered
- how those problems were resolved
- what remains next

This file should stay good enough that a new agent can understand the rewrite history without previous chat context.

## Session close checklist

Before ending a meaningful refactor session:
- update `Latest checkpoint`
- record what changed
- record why it changed
- record choices made or confirmed
- record problems resolved and how they were resolved
- confirm the next planned checkpoint
- update `REFACTOR-ROADMAP-V2.md` if milestone status changed
- update `ARCHITECTURE-V2.md` only if the target structure or invariants changed
- update `CONTINUE-V2-PROMPT.md` if the expected handoff instructions changed
- run `REGRESSION-CHECKLIST-V2.md` or explicitly record why it was skipped

---

## Latest checkpoint

### Current checkpoint summary
- Durable V2 core is established and actively used.
- The implementation-side roadmap milestones are now complete.
- Worker execution, task execution orchestration, command execution-loop plumbing, and supervisor/watchdog policy have all been extracted into dedicated `v2/` modules.
- `index.ts` still owns extension wiring and planning flow, but it no longer embeds the main execution-path decision trees.
- The known scope regression (`loadConfig is not defined`) remains a standing refactor warning, and this checkpoint kept closure-bound runtime access inside the extension closure while moving orchestration logic out.

### Most recent extracted modules
- `v2/task-runner.ts`
  - single-pass worker execution
  - iterative TDD loop execution
  - task execution orchestration across success/failure/diagnostic flows
- `v2/command-adapter.ts`
  - execution-loop control for approved-plan execution
  - watchdog-backed batch launch helper
- `v2/supervisor.ts`
  - overdue-supervisor detection
  - warning/escalation decision policy

### What the last refactor steps changed
- moved single-pass and iterative worker implementations out of `index.ts`
- collapsed `executeTask(...)` into a thin adapter over `v2/task-runner.ts`
- moved approved-plan execution-loop orchestration into `v2/command-adapter.ts`
- moved watchdog/supervisor decision policy into `v2/supervisor.ts`
- trimmed dead adapter helpers that were no longer needed after the extraction
- added runtime model fallback in `spawnAgent(...)` so unsupported/quota/credit/account model failures fall through to the next configured candidate instead of hard-failing the role immediately
- filtered the noisy `Invalid thinking level ... :free` line out of nested agent command failure messages so real provider errors are clearer
- moved planning startup to a background path so `/forge <prd>` no longer monopolizes the command handler while analysis/planning is running
- added planning-time active agent visibility so `/forge status` can show which planner/classifier agent and model are currently in flight
- made nested planning agent timeouts retryable across model candidates instead of looking permanently stuck on one backend
- reduced scope-classifier attempt timeout so bad/unresponsive model backends fail over faster during planning startup
- confirmed a remaining structural issue: validation/test-designer output can still mix executable commands with prose guidance; this should be fixed at the schema/prompt-contract layer rather than with command-text heuristics
- advanced Milestones 2–5 from planned to complete

### Design choices made or confirmed
- closure-bound runtime effects (`pi`, config/state access, artifact IO, engine mutations) stay in `index.ts` as injected hooks, while execution decisions move into dependency-injected `v2/` services
- worker orchestration is easier to keep typed when the task runner owns the lifecycle sequencing and `index.ts` only supplies runtime capabilities
- supervisor escalation policy should be declarative and testable as a V2 decision module instead of remaining embedded in the extension shell

### Problems encountered and how they were resolved
- isolated TypeScript verification for the new command-adapter path still pulls in older pre-existing ambient type issues through existing V2 files (`storage.ts` / pi/node environment assumptions)
- bridge typing in `v2/bridge.ts` also needed tightening once the command adapter began using it more directly
- interactive smoke testing exposed a UX/runtime issue: `/forge <prd>` held the command handler until planning finished, which made later `/forge status` / `/forge help` look like they were never invoked while planning was active
- resolution:
  - constrained `v2/bridge.ts` / `v2/adapters.ts` generics to `ForgeTask`
  - verified the newly extracted pure modules with isolated `tsc`
  - changed planning startup to `startPlanningInBackground(...)` so planning is asynchronous like execution and follow-up slash commands remain usable during planning
- added durable `agent_start` / `agent_complete` / `agent_retry_model` / `agent_failed` state-log events and surfaced the current active agent in `/forge status`
  - recorded that full-extension/live smoke validation is still pending because this session did not use a safe runtime workspace

### Regression checklist status
- scope sanity check: passed by inspection; closure-dependent runtime calls remain inside `index.ts`
- command smoke tests:
  - `/forge status`: passed in `pi -p` against both an empty workspace and a synthetic paused V2 snapshot
  - `/forge abort`: passed against a synthetic paused V2 snapshot; authoritative `.task-forge/state.json` transitioned to `aborted`
  - `/forge help`, `/forge config`, `/forge cost`, and `/forge models`: now pass cleanly in `pi -p` after switching those informational commands to durable `pi.sendMessage(...)` output instead of `ctx.ui.notify(...)` only
  - `/forge pause`: invocation returned, but one-shot `pi -p` process shutdown immediately triggered interruption-recovery events, so this was not a clean validation signal for pause semantics
  - `/forge execute` and `/forge resume`: still not cleanly validated in this session because non-interactive one-shot execution immediately exits and is not a reliable harness for background execution behavior
- planning smoke test: still skipped; it needs a safe interactive/runtime-capable workspace with model access
- isolated TypeScript check: passed for `v2/task-runner.ts`, `v2/supervisor.ts`, `v2/validation.ts`, `v2/gate-review.ts`, and `v2/diagnostic-review.ts`
- broader command-adapter/bridge verification still inherits pre-existing environment/type issues from older files, so it was reviewed structurally rather than treated as a clean compiler gate

### What still remains most important
- run interactive `/forge execute` / `/forge resume` / planning smoke checks in a real session rather than `pi -p`
- fix any runtime regressions discovered during those interactive checks
- optionally continue consolidating duplicated planning/session types onto `v2/types.ts` if future cleanup work resumes

### Next planned checkpoint
Use an interactive pi session in a safe workspace to validate `/forge execute`, `/forge resume`, planning flow, and pause/abort behavior without one-shot process shutdown artifacts.

---

## Current state snapshot

### Rewrite status
- Durable V2 core exists and is in use.
- Execution-path refactor is substantially advanced.
- `index.ts` has been reduced significantly, but is still not a thin shell yet.
- Major execution decisions now live under `v2/`.
- The remaining work is mostly finishing the migration of the last concrete implementations out of `index.ts`.

### Rough completion estimate
- Execution-path rewrite: ~95%
- Full extension rewrite: ~85%

---

## Core architectural choices

### 1. V2 is file-first and event-sourced
**Choice:** make `.task-forge/events.jsonl` the source of truth and derive `state.json` from it.

**Why:** in-memory/session state had become contradictory and brittle.

**Effect:**
- authoritative status comes from durable state
- recovery is based on facts/events, not best-effort local mutation
- session memory is advisory only

---

### 2. Keep `/forge` UX stable while replacing internals
**Choice:** do not do a flag-day rewrite.

**Why:** preserve working UX and avoid breaking the extension while refactoring.

**Effect:**
- `/forge <prd>`
- `/forge execute`
- `/forge resume`
- `/forge pause`
- `/forge abort`
- `/forge status`
- `/forge blocker ... --resolve ...`

all remain, while internals gradually move to `v2/`.

---

### 3. Use a bridge strategy, but shrink it continuously
**Choice:** let `index.ts` survive as a bridge temporarily, but move decisions and lifecycle orchestration into `v2/` modules in small steps.

**Why:** safer migration path and easier checkpoint commits.

**Effect:**
- `index.ts` started as a large mixed coordinator
- now many pieces have been extracted into dedicated `v2/` modules
- remaining work is to finish the extraction rather than redesign from scratch again

---

### 4. Human intervention is first-class behavior
**Choice:** environment/runtime/preflight/gate problems should pause with a visible human-help message, not hang or retry blindly.

**Why:** repeated hanging, fake running states, and contradictory task/run states were a major source of brittleness.

**Effect:**
- blockers are durable
- human intervention requests are explicit
- repeated identical failures stop and ask for help
- environment failures do not get treated like normal retries

---

### 5. Execution decisions should be represented as typed results
**Choice:** prefer typed result surfaces and decision objects over scattered mutable branches.

**Why:** the old style made it hard to reason about what a phase/task was trying to do.

**Effect:**
- runner results
- action/control objects
- failure decisions
- diagnostic decisions
- bridge outcomes

now carry explicit meaning across modules.

---

### 6. Preserve original PRD context downstream
**Choice:** planner and test designer should receive the original PRD, not only summarized requirements.

**Why:** UI/design-system requirements were being lost when only derived summaries were passed on.

**Effect:** downstream phases preserve design-system and UI constraints more reliably.

---

### 7. OpenAI-first model policy
**Choice:** prefer OpenAI models first, Anthropic only as fallback.

**Why:** explicit user requirement.

**Effect:** model routing/config was updated to reflect OpenAI-first tier selection.

---

## Problems encountered and how they were resolved

## 1. Contradictory run state between UI/session memory and actual task state
**Problem:** powerline/footer/session state could say `executing` while `/forge status` said no active orchestration, or top-level state contradicted task facts.

**Root cause:** session-memory/local state had become more authoritative than durable file state.

**Resolution:**
- introduced authoritative snapshot loading from V2 state first
- bootstrapped V2 from existing V1 file state where needed
- made status/footer/session-start prefer durable V2/file-backed state
- kept session memory as fallback only

**Files involved:**
- `v2/storage.ts`
- `v2/derive.ts`
- `v2/migrate.ts`
- `index.ts`

---

## 2. Shutdown/restart left fake `running` or `executing` states behind
**Problem:** exiting pi during execution could leave orchestration apparently active but not actually runnable.

**Root cause:** running state lived too much in mutable runtime state.

**Resolution:**
- added durable pause/resume concepts in V2
- on interruption, requeue running tasks durably
- write `run_paused` / `task_requeued`-style state transitions
- recover from authoritative durable state on restart

**Files involved:**
- `v2/types.ts`
- `v2/events.ts`
- `v2/derive.ts`
- `v2/engine.ts`
- `index.ts`

---

## 3. Execution could stall silently
**Problem:** tasks could stop making progress but remain effectively “running”.

**Root cause:** weak supervision model and too much local watchdog behavior.

**Resolution:**
- added durable supervisor/watchdog state
- moved overdue detection into V2 execution model
- escalated first to warning, then to human-intervention-required state
- made watchdog truth authoritative in V2 rather than local timer state

**Files involved:**
- `v2/execution.ts`
- `v2/engine.ts`
- `index.ts`

---

## 4. Environment/runtime failures were treated like normal retries
**Problem:** missing Playwright, path mismatch, CORS failure, container/runtime mismatch, native module issues, etc. caused useless retries or hanging.

**Root cause:** failure handling did not distinguish implementation failure from infrastructure/runtime failure.

**Resolution:**
- added environment/runtime failure classification
- converted these to blocker/human-intervention flows
- surfaced persistent visible human-help messages

**Examples resolved:**
- `playwright: not found`
- `No tests found`
- CORS errors
- `ECONNREFUSED`
- `Exec format error`
- `ERR_DLOPEN_FAILED`

**Files involved:**
- `v2/preflight.ts`
- `index.ts`
- later extraction into `v2/task-failure.ts`

---

## 5. Test/acceptance command paths broke inside frontend container
**Problem:** commands like `frontend/tests/...` were wrong inside `docker compose exec frontend-dev` because the container was already in `/app`.

**Root cause:** host-relative path assumptions leaked into container execution.

**Resolution:**
- added preflight normalization for frontend container paths
- persisted normalized commands durably
- rewrote task definitions when normalization occurred

**Files involved:**
- `v2/preflight.ts`
- `index.ts`

---

## 6. UI/design system requirements were lost during planning
**Problem:** downstream planner/test designer behavior sometimes ignored important UI/design-system constraints.

**Root cause:** requirements summaries were lossy and original PRD context was not passed far enough downstream.

**Resolution:**
- updated strategist prompt to preserve UI/UX/design-system requirements explicitly
- passed original PRD into planning and test design phases
- updated planner/test-designer prompts accordingly

**Files involved:**
- `agents/strategist.md`
- `agents/planner.md`
- `agents/test-designer.md`
- `index.ts`

---

## 7. `/forge status` visibility was too weak or too transient
**Problem:** status was not reliably visible in session history.

**Resolution:**
- changed status output to send a persistent visible session message
- improved footer/powerline display using authoritative state

**Files involved:**
- `index.ts`

---

## 8. Timeout bug due to wrong units
**Problem:** subprocess timeouts used the wrong unit.

**Root cause:** `pi.exec(..., { timeout })` expected milliseconds, but code was passing seconds.

**Resolution:**
- introduced a `seconds()` helper
- converted affected execution paths to ms-based timeouts

**Files involved:**
- `index.ts`

---

## 9. Bridge complexity in `index.ts`
**Problem:** even after introducing V2, `index.ts` still directly coordinated scheduling, preflight, action-plan application, launch batching, watchdogs, review handoff, and task lifecycle details.

**Resolution:** incremental extraction into dedicated `v2/` modules.

This is the main refactor thread still underway.

---

## 10. Scope regression: `loadConfig is not defined`
**Problem:** the extension began failing with:
- `Extension "command:forge" error: loadConfig is not defined`

**Root cause:** several helpers that depended on closure-bound extension state were accidentally moved outside `export default function (pi) { ... }`, while `loadConfig`, `config`, and `state` still lived inside that closure.

Affected helper class:
- authoritative snapshot / command-state helpers
- V2 engine/runner bridge helpers
- other functions that still relied on closure-scoped extension state

**Resolution:**
- moved the affected helpers back inside the extension closure
- kept closure-dependent helpers co-located with `config`, `state`, and `loadConfig(...)`
- introduced `REGRESSION-CHECKLIST-V2.md` so future refactor steps run smoke checks after scope/module changes

**Rule confirmed:** closure-dependent helpers must either:
- remain inside the extension closure, or
- be fully refactored to accept required state explicitly instead of reaching into closure state

---

## What has been extracted so far

## Durable core
- `v2/types.ts`
- `v2/events.ts`
- `v2/derive.ts`
- `v2/storage.ts`
- `v2/engine.ts`
- `v2/migrate.ts`
- `v2/preflight.ts`

### What this solved
- authoritative durable state
- event replay/derivation
- migration from old state
- preflight/runtime normalization and classification

---

## Execution model and runner surface
- `v2/execution.ts`
- `v2/executor.ts`
- `v2/runner.ts`

### What this solved
- scheduling decisions
- execution decisions
- side-effect translation
- runner-facing execution-cycle API

---

## Bridge/application helpers
- `v2/bridge.ts`
- `v2/launcher.ts`
- `v2/review.ts`
- `v2/adapters.ts`

### What this solved
- applying runner results generically
- launching watchdog task batches
- integration review orchestration
- centralizing hook/adaptor contracts

---

## Task lifecycle extraction
- `v2/task-executor.ts`
- `v2/task-failure.ts`
- `v2/task-diagnostic.ts`
- `v2/task-success.ts`

### What this solved
- task start/complete/fail-attempt lifecycle shell
- failure bookkeeping and failure decision tree
- diagnostic rewrite/block application
- worker/validation/gate happy path orchestration

---

## Backfilled extraction log

## Phase A — Durable V2 foundation
### Added
- event-sourced state model and storage
- derivation logic
- migration/bootstrap from V1 file state

### Result
TaskForge gained a durable authoritative substrate instead of relying on session memory.

---

## Phase B — Durable execution state and supervision
### Added
- durable task lifecycle events
- run lifecycle events
- paused/resumed support
- overdue supervisor handling
- durable blocker/runtime fields

### Result
Execution became much more restart-safe and inspectable.

---

## Phase C — Native execution model extraction
### Added
- execution facts/decision model under `v2/execution.ts`
- execution side-effect layer under `v2/executor.ts`
- runner façade in `v2/runner.ts`

### Result
The execution loop stopped being entirely hand-coded in `index.ts`.

---

## Phase D — Bridge shrink
### Added
- bridge result application helper
- launcher helper
- adapter creators
- review helper

### Result
`index.ts` stopped directly owning several execution-cycle plumbing responsibilities.

---

## Phase E — Task lifecycle extraction
### Added
- task lifecycle helper
- failure helpers
- diagnostic helpers
- success-path helper

### Result
`executeTask(...)` became smaller and more decision-driven rather than lifecycle-boilerplate-driven.

---

## What still remains

The main remaining rewrite surface is now:

### Still in `index.ts`
- `runSinglePassTask(...)`
- `runIterativeTask(...)`
- `runValidation(...)`
- validation coverage/framework parsing helpers
- `gateReviewTask(...)`
- `diagnoseTaskFailure(...)`
- some direct `withV2Engine(...)` and artifact persistence glue
- planning flow code
- command/session wiring

### Meaning
The architecture is much better, but the concrete implementations of worker/validation/reviewer behavior still need their own `v2/` homes.

---

## Remaining major steps

### 1. Run live regression smoke tests
Verify `/forge` planning/execution commands behave correctly in a safe workspace.

### 2. Fix any runtime regressions discovered by smoke testing
Treat live command behavior as the remaining gate before calling the refactor fully validated.

---

## Working rule for future updates to this file
When meaningful refactor work is completed, append or update:
- what changed
- what decision was made
- what problem was resolved
- how it was resolved
- what remains next

This file should stay readable as the durable narrative memory of the rewrite.
