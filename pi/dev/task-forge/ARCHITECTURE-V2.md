# TaskForge Architecture V2

> Current working implementation plan: `REFACTOR-ROADMAP-V2.md`
> Historical refactor memory: `WORKLOG-V2.md`
> Clean-session handoff prompt: `CONTINUE-V2-PROMPT.md`

TaskForge runs on a **V2-only, file-first, event-sourced execution engine**.

V1 mutable orchestration paths have been removed from the runtime. `events.jsonl` is the only authoritative source of truth. `state.json` is derived/debug-only.

## Continuity contract

Update this file when the target architecture, module boundaries, or core invariants change.
Do not use it as a worklog; use `WORKLOG-V2.md` for that.

The goal is to make TaskForge:
- restart-safe
- reconciliation-based instead of patch-based
- explicit about human intervention
- resilient to container/runtime/preflight problems
- deterministic in top-level status derivation

---

## Why V1 is brittle

The current architecture mixes:
- orchestration state
- task state
- command handling
- persistence
- retry logic
- human intervention
- UI rendering
- session-memory restore

inside a single mutable runtime flow.

That creates several failure modes:
- top-level status diverges from task graph reality
- `state.json` can disagree with in-memory/session state
- blockers can disappear while blocked tasks remain
- execution can end in contradictory states like `failed + blocked + nextAction`
- runtime/preflight failures are detected too late
- recovery logic is bolt-on rather than intrinsic

V2 fixes this by separating **facts** from **derived state**.

---

## Design principles

### 1. Event log is the source of truth

TaskForge V2 writes an append-only event log:

```text
.task-forge/
  events.jsonl
  state.json
  locks/
  tasks/
  tmp/
```

- `events.jsonl` is authoritative
- `state.json` is a derived snapshot for UI/debugging
- in-memory state is only a cache of the derived snapshot
- session entries are advisory only, never authoritative

### 2. Top-level run state is derived

The run status is not directly mutated across many branches.

It is derived from:
- phase
- unresolved blockers
- running tasks
- failed terminal tasks
- approval gates
- human intervention state

### 3. Human intervention is first-class

V2 introduces a dedicated top-level state:

```text
needs_human_intervention
```

This is not encoded indirectly as `failed`, `blocked`, `paused`, and `nextAction` combinations.

### 4. Execution is supervised

Each running task has:
- start time
- heartbeat
- supervisor metadata
- stall detection
- deterministic teardown/requeue rules

### 5. Preflight happens before worker execution

Before a task is executed, TaskForge validates the runtime assumptions of the acceptance/test environment.

Examples:
- container exists and is running
- container working directory matches path assumptions
- script exists
- binary exists
- dependent service is reachable
- frontend/browser tests have valid CORS/network expectations

---

## V2 state model

### Run status

```ts
type RunStatus =
  | "idle"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "needs_human_intervention"
  | "reviewing"
  | "completed"
  | "aborted"
  | "failed";
```

### Task status

```ts
type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";
```

### Key distinction

- `blocked` = task cannot proceed until something external is resolved
- `failed` = task reached a terminal unrecoverable state under current policy
- `needs_human_intervention` = run-level state saying the engine intentionally stopped and is waiting for the user

---

## Event log

V2 writes one JSON event per line.

### Core event families

#### Run lifecycle
- `run_created`
- `run_restored`
- `run_aborted`
- `run_completed`
- `run_failed`

#### Planning lifecycle
- `phase_entered`
- `planning_phase_started`
- `planning_phase_completed`
- `planning_phase_interrupted`
- `routing_decided`
- `requirements_written`
- `plan_written`
- `test_spec_written`
- `tasks_registered`
- `approval_required`
- `approval_granted`

#### Task lifecycle
- `task_ready`
- `task_started`
- `task_heartbeat`
- `task_runtime_updated`
- `task_tdd_progress`
- `task_validation_passed`
- `task_validation_failed`
- `task_gate_reviewed`
- `task_completed`
- `task_failed`
- `task_blocked`
- `task_requeued`
- `task_contract_patched`
- `test_spec_patched`

#### Human intervention
- `human_intervention_requested`
- `human_intervention_resolved`

#### Run/execution control
- `run_paused`
- `run_resumed`

#### Review
- `integration_review_started`
- `integration_review_completed`

---

## Derived snapshot

`state.json` is derived from replaying `events.jsonl`.

### Snapshot responsibilities

The snapshot answers:
- what phase is the run in?
- what is the current run status?
- which tasks are pending/running/completed/blocked/failed?
- which blockers are unresolved?
- what action is expected from the user?
- what file artifacts exist?
- what is safe to resume?

### Reconciliation rule

On every load:
1. replay events
2. derive snapshot
3. reconcile stale runtime facts
4. write fresh `state.json`

This means if pi exits mid-run, restart does **not** reuse stale in-memory state.

---

## Status derivation rules

Pseudo-order:

1. if run aborted event exists after latest execution start → `aborted`
2. else if integration review completed successfully → `completed`
3. else if unresolved human intervention exists → `needs_human_intervention`
4. else if current phase requires approval and approval not granted → `awaiting_approval`
5. else if any task is running → `executing`
6. else if all non-skipped tasks completed and integration review pending → `reviewing`
7. else if there are ready/pending tasks and execution authorized → `executing`
8. else if any terminal unrecoverable task failure exists with no intervention path → `failed`
9. else → `planning`

This prevents contradictory combinations like:
- `failed` with `nextAction=executePlan`
- `failed` with only blocked tasks
- `awaiting_approval` while tasks are still running

---

## Task supervision model

Each running task gets a supervisor record:

```ts
interface TaskSupervisorState {
  taskId: string;
  startedAt: string;
  lastHeartbeatAt: string;
  watchdogDeadlineAt: string;
  runAttempt: number;
  pidHint?: number;
}
```

### Watchdog behavior

If a task exceeds heartbeat threshold:
- emit `human_intervention_requested`
- emit `task_blocked`
- transition run to `needs_human_intervention`
- never silently keep top-level run in `executing`

---

## Preflight engine

A task with validation/acceptance commands gets preflighted before worker execution.

### Preflight checks

#### Command normalization
- normalize `frontend/`-prefixed paths when command runs inside `frontend-dev`
- normalize repo-root vs container-root test paths
- prevent obvious `cd frontend` mistakes when already inside `/app`

#### Runtime checks
- container exists/running
- script exists in `package.json`
- binary exists in PATH or `node_modules/.bin`
- service DNS/name resolves
- service health endpoint is reachable if required

#### Error classes
V2 makes these first-class:
- `environment_missing_runtime`
- `environment_wrong_working_directory`
- `environment_dependency_unreachable`
- `environment_cors_misconfiguration`
- `environment_native_binary_mismatch`
- `environment_invalid_test_contract`

If preflight fails, the worker is **not launched**.

---

## Human intervention UX

When human help is required, TaskForge emits a durable visible message:

```text
[task-forge] Human intervention required
run: forge-...
task: T05 — Implement design tokens, layout shell, and shared UI primitives
reason: Acceptance test path is wrong for frontend-dev working directory
suggested action:
  docker compose exec frontend-dev npm run test -- src/components/ui/primitives.contract.test.tsx
next:
  /forge blocker T05 --resolve "..."
  /forge execute
```

### Guarantees

When this message appears:
- no tasks are left silently running
- the run can be resumed deterministically
- the blocker is represented in durable state

---

## V2 module split

```text
task-forge/
  index.ts                    # extension shell + closure-bound runtime wiring
  v2/
    types.ts                  # durable types
    events.ts                 # event constructors + event type guards
    derive.ts                 # replay + snapshot derivation
    storage.ts                # event append/load + snapshot write
    preflight.ts              # runtime/preflight normalization and checks
    validation.ts             # validation command normalization + coverage parsing + execution
    gate-review.ts            # gate-review prompt assembly + parsing
    diagnostic-review.ts      # diagnostic-review prompt assembly + parsing
    task-runner.ts            # worker execution + task success/failure orchestration
    command-adapter.ts        # execution-loop / command bridge helpers
    supervisor.ts             # watchdog + heartbeat escalation policy
    engine.ts                 # orchestration API
    migrate.ts                # optional v1 -> v2 snapshot/event migration
```

### Boundary rules

- `index.ts` handles pi command/UI integration plus closure-bound runtime wiring for `pi`, config/state, and agent spawning
- reviewer/validator prompt construction, parsing, validation heuristics, task execution orchestration, command execution-loop control, and supervisor policy should live under `v2/`
- `engine.ts` exposes pure orchestration operations like:
  - `createRun()`
  - `loadRun()`
  - `executeRun()`
  - `resolveBlocker()`
  - `abortRun()`
- `derive.ts` owns status derivation rules
- `storage.ts` owns disk persistence
- `preflight.ts` owns environment/runtime normalization

---

## Migration status

V2 is the **only active runtime**. V1 mutable orchestration loops and V1 command authority have been removed from runtime paths.

Migration phases:

- **Phase 1** ✅ — V2 engine, event model, and derivation logic created.
- **Phase 2** ✅ — `/forge status` derives from V2 snapshot only.
- **Phase 3** ✅ — `/forge blocker` and `/forge execute` use V2 engine.
- **Phase 4** ✅ — Task execution and supervision use V2.
- **Phase 5** ✅ — V1 mutable orchestration loop deleted; V1 helpers quarantined to `docs/history/` or migration-only modules.

Legacy state import is one-way and explicit via `v2/migrate.ts`.

---

## Success criteria

TaskForge V2 is successful when all of these are true:

1. quitting pi at any time does not corrupt resumability
2. top-level status is always consistent with task graph facts
3. environment/runtime/preflight problems stop early with clear human guidance
4. no hidden dependency on session-memory state exists
5. `/forge status` always reflects file-backed truth
6. blocked runs are resumable without hand-editing JSON

---

## Core V2 modules

The V2 runtime is built on:
1. durable types (`v2/types.ts`)
2. event definitions (`v2/events.ts`)
3. snapshot derivation (`v2/derive.ts`)
4. storage layer (`v2/storage.ts`)
5. preflight normalization primitives (`v2/preflight.ts`)

See `EVENTS.md` for the canonical event reference and `docs/operations/runbook.md` for operator guidance.
