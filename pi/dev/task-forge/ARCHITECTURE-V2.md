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

## V2 State Machine

TaskForge's run-level state is derived from events by `deriveStatus()` in `src/derive.ts`.
Every state transition is deterministic — replaying the same event log always produces the same status.

### States

```
                    ┌──────────────┐
                    │     idle     │ (no run exists)
                    └──────┬───────┘
                           │ run_created
                           ▼
                    ┌──────────────┐
              ┌────│   planning   │◄────────────── run_resumed
              │    └──────┬───────┘
              │           │ approval_required
              │           ▼
              │    ┌──────────────────┐
              │    │ awaiting_approval│◄── run_paused
              │    └────────┬─────────┘
              │           │ approval_granted
              │           ▼
              │    ┌──────────────┐     human_intervention_requested
              │    │  executing   │──────────────────────┐
              │    └──┬───┬───┬──┘                      │
              │       │   │   │    run_paused           ▼
              │       │   │   └──────────────┐  ┌───────────────────────┐
              │       │   │                  │  │needs_human_intervention│
              │       │   │   all tasks done│  └───────────┬───────────┘
              │       │   │   (phase >= 5)  │              │ intervention_resolved
              │       │   │        │        │              │ + task_requeued
              │       │   │        ▼        ▼              │
              │       │   │  ┌──────────┐ ┌──────────┐    │
              │       │   │  │ reviewing│ │  paused   │◄───┘
              │       │   │  └────┬─────┘ └────┬─────┘
              │       │   │       │            │ run_resumed
              │       │   │       ▼            │
              │       │   │  ┌───────────┐     │
              │       │   │  │ completed │     │
              │       │   │  └───────────┘     │
              │       │   │                    │
              │       │   │  run_failed        │
              │       │   └──────────┐         │
              │       │              ▼         │
              │       │        ┌──────────┐    │
              │       │        │  failed  │    │
              │       │        └──────────┘    │
              │       │                        │
              │       │  run_aborted           │
              │       └──────────┐             │
              │                  ▼             │
              │            ┌──────────┐        │
              └────────────│ aborted  │◄───────┘
                           └──────────┘
```

### State definitions

| State | Meaning | Entry events |
|-------|---------|-------------|
| `idle` | No run | (initial) |
| `planning` | Active planning phase 0–3 | `run_created`, `run_resumed` |
| `awaiting_approval` | Planning complete, waiting for user | `approval_required` with `nextAction` set |
| `executing` | Tasks running (phase ≥ 5) | `task_started`, ready/pending tasks in phase ≥ 5 |
| `reviewing` | Integration review (phase 6) | All tasks done, phase ≥ 5, no `reviewFile` |
| `completed` | Run finished | `integration_review_completed`, or `reviewFile` set |
| `paused` | User/system paused | `run_paused` |
| `aborted` | User aborted | `run_aborted` |
| `failed` | Terminal failure | `run_failed`, or any task `failed` with no intervention path |
| `needs_human_intervention` | Human help required | `human_intervention_requested`, or unresolved blockers |

### deriveStatus() resolution order

```ts
// src/derive.ts — exact priority, first match wins
1. if snapshot.status === "aborted"           → aborted
2. if snapshot.status === "completed"         → completed
3. if snapshot.status === "paused"            → paused
4. if snapshot.pendingHumanIntervention       → needs_human_intervention
5. if any task is running                     → executing
6. if snapshot.reviewFile exists              → completed
7. if snapshot.nextAction is set              → awaiting_approval
8. if all tasks done && phase >= 5            → reviewing
9. if unresolved blockers > 0                 → needs_human_intervention
10. if ready/pending tasks && phase >= 5      → executing
11. if snapshot.status === "failed"           → failed
12. if any task failed                        → failed
13. default                                   → planning
```

### Key invariants

- **`failed` never has `nextAction`** — deriveStatus ignores `nextAction` when status is `failed`
- **`awaiting_approval` never has running tasks** — `hasRunning` check (step 5) takes priority
- **`needs_human_intervention` is sticky** — persists until `human_intervention_resolved` or task requeue
- **`paused` preserves `nextAction`** — so resume knows whether to continue planning or execution
- **`status` field on snapshot is advisory only** — deriveStatus recomputes it on every load

### Task state transitions

```
pending ──▶ ready ──▶ running ──▶ completed
   │         │          │
   │         │          ├──▶ blocked ──▶ (resolved) ──▶ pending (requeued)
   │         │          │
   │         │          └──▶ failed
   │         │
   └─────────┴── (dependency blocked → stays pending)
```

| Transition | Event |
|-----------|-------|
| pending → ready | `task_ready` |
| ready → running | `task_started` |
| running → completed | `task_completed` |
| running → blocked | `task_blocked` |
| running → failed | `task_failed` |
| blocked → pending | `task_requeued` (+ `human_intervention_resolved` for intervention cases) |

### Restart determinism

After pi restart:
1. Load `events.jsonl`
2. Replay all events into a fresh `RunSnapshot`
3. `deriveStatus()` produces the same status as before restart
4. No in-memory state needed — `taskState`, `supervisors`, `blockers` are all derived from events

Interrupted planning and execution are explicitly represented:
- `planning_phase_interrupted` → `snapshot.planningRuntime.interrupted = true`
- `run_paused` with `nextAction` → resumable execution
- `task_started` without matching `task_completed` → task was `running` at shutdown, requeued on restart

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
  src/
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
    migrate.ts                # one-way legacy state import (migration-only)
    commands/                 # pure V2 command services
      status.ts
      execute.ts
      resume.ts
      blocker.ts
      pause.ts
      abort.ts
      cost.ts
      models.ts
      config.ts
      plan.ts                 # V2 planning orchestrator
    transition-policy.ts      # centralized state gating
```

### Boundary rules

- `index.ts` handles pi command/UI integration plus closure-bound runtime wiring for `pi`, config/state, and agent spawning
- reviewer/validator prompt construction, parsing, validation heuristics, task execution orchestration, command execution-loop control, and supervisor policy should live under `src/`
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

Legacy state import is one-way and explicit via `src/migrate.ts`.

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
1. durable types (`src/types.ts`)
2. event definitions (`src/events.ts`)
3. snapshot derivation (`src/derive.ts`)
4. storage layer (`src/storage.ts`)
5. preflight normalization primitives (`src/preflight.ts`)

See `EVENTS.md` for the canonical event reference and `docs/operations/runbook.md` for operator guidance.
