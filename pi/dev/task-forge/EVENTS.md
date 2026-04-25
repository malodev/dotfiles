# TaskForge Events

> **Canonical event reference for TaskForge V2.**
>
> The append-only event log (`events.jsonl`) is the **authoritative source of truth**.
> `state.json` is a derived snapshot for UI/debugging only.
> All runtime state must be reconstructible by replaying these events.
>
> Source of record: `src/events.ts`

## Event families

### Run lifecycle

| Event | Description |
|---|---|
| `run_created` | Initial run creation |
| `run_restored` | Run restored from legacy state or after restart |
| `run_aborted` | Run explicitly aborted by user |
| `run_completed` | Run completed successfully |
| `run_failed` | Run reached a terminal failed state |

### Planning lifecycle

| Event | Description |
|---|---|
| `phase_entered` | Orchestration entered a new phase |
| `planning_phase_started` | A planning phase started |
| `planning_phase_completed` | A planning phase completed |
| `planning_phase_interrupted` | A planning phase was interrupted |
| `routing_decided` | Scope routing decision made (micro/standard/complex) |
| `requirements_written` | Requirements artifact written |
| `plan_written` | Plan artifact written |
| `test_spec_written` | Test spec artifact written |
| `tasks_registered` | Tasks registered from plan |
| `approval_required` | Approval gate reached |
| `approval_granted` | Approval granted to proceed |

### Task lifecycle

| Event | Description |
|---|---|
| `task_ready` | Task is ready to execute |
| `task_started` | Task execution started |
| `task_heartbeat` | Task supervisor heartbeat |
| `task_runtime_updated` | Task runtime state updated (retries, errors, diagnostics) |
| `task_tdd_progress` | TDD phase progress update |
| `task_validation_passed` | Task validation passed |
| `task_validation_failed` | Task validation failed |
| `task_gate_reviewed` | Gate review completed |
| `task_completed` | Task completed successfully |
| `task_failed` | Task failed terminally |
| `task_blocked` | Task blocked by a blocker |
| `task_requeued` | Task requeued after resolution |
| `task_contract_patched` | Task contract patched during blocker resolution |
| `test_spec_patched` | Test spec patched during blocker resolution |

### Human intervention

| Event | Description |
|---|---|
| `human_intervention_requested` | Human help requested |
| `human_intervention_resolved` | Human intervention resolved |

### Run/execution control

| Event | Description |
|---|---|
| `run_paused` | Run paused by user or system |
| `run_resumed` | Run resumed |

### Review

| Event | Description |
|---|---|
| `integration_review_started` | Integration review started |
| `integration_review_completed` | Integration review completed |

## Event schemas

### Run lifecycle

#### `run_created`
```ts
{ type: "run_created"; at: string; orchestrationId: string; prdFile: string }
```

#### `run_restored`
```ts
{ type: "run_restored"; at: string; orchestrationId: string; reason: string }
```

#### `run_aborted`
```ts
{ type: "run_aborted"; at: string; reason: string }
```

#### `run_completed`
```ts
{ type: "run_completed"; at: string }
```

#### `run_failed`
```ts
{ type: "run_failed"; at: string; reason: string }
```

### Planning lifecycle

#### `phase_entered`
```ts
{ type: "phase_entered"; at: string; phase: RunPhase; label: string }
```

#### `planning_phase_started`
```ts
{ type: "planning_phase_started"; at: string; role: Role; phase: RunPhase; phaseLabel: string }
```

#### `planning_phase_completed`
```ts
{ type: "planning_phase_completed"; at: string; role: Role; phase: RunPhase }
```

#### `planning_phase_interrupted`
```ts
{ type: "planning_phase_interrupted"; at: string; role: Role | null; phase: RunPhase }
```

#### `routing_decided`
```ts
{ type: "routing_decided"; at: string; mode: "micro" | "standard" | "complex"; rationale?: string }
```

#### `approval_required`
```ts
{ type: "approval_required"; at: string; nextAction: NextAction; label: string }
```

#### `approval_granted`
```ts
{ type: "approval_granted"; at: string; nextAction?: NextAction }
```

#### `requirements_written`
```ts
{ type: "requirements_written"; at: string; file: string }
```

#### `plan_written`
```ts
{ type: "plan_written"; at: string; planFile: string; tasksFile?: string; tasksMarkdownFile?: string; costFile?: string }
```

#### `test_spec_written`
```ts
{ type: "test_spec_written"; at: string; file: string; markdownFile?: string; specs: TestSpecEntry[] }
```

#### `tasks_registered`
```ts
{ type: "tasks_registered"; at: string; tasks: ForgeTask[] }
```

### Task lifecycle

#### `task_ready`
```ts
{ type: "task_ready"; at: string; taskId: string }
```

#### `task_started`
```ts
{ type: "task_started"; at: string; taskId: string; runAttempt: number; model?: string; pidHint?: number; watchdogDeadlineAt?: string }
```

#### `task_heartbeat`
```ts
{ type: "task_heartbeat"; at: string; taskId: string; watchdogDeadlineAt?: string }
```

#### `task_runtime_updated`
```ts
{
  type: "task_runtime_updated";
  at: string;
  taskId: string;
  retries?: number;
  error?: string | null;
  failureSignature?: string | null;
  stallWarnedAt?: string | null;
  diagnostic?: {
    classification: string;
    notes: string;
    blockerCategory?: BlockerCategory;
    remediationMode?: BlockerResolutionMode;
  } | null;
  diagnosticCount?: number | null;
}
```

#### `task_tdd_progress`
```ts
{
  type: "task_tdd_progress";
  at: string;
  taskId: string;
  phase: TddPhase;
  iterationCount?: number;
  redEstablishedAt?: string;
  greenAchievedAt?: string;
  refactorValidatedAt?: string;
}
```

#### `task_validation_failed`
```ts
{ type: "task_validation_failed"; at: string; taskId: string; error: string; output?: string; framework?: string }
```

#### `task_validation_passed`
```ts
{ type: "task_validation_passed"; at: string; taskId: string; output?: string; framework?: string; coverage?: number }
```

#### `task_gate_reviewed`
```ts
{ type: "task_gate_reviewed"; at: string; taskId: string; passed: boolean; notes: string }
```

#### `task_completed`
```ts
{ type: "task_completed"; at: string; taskId: string; result?: string }
```

#### `task_failed`
```ts
{ type: "task_failed"; at: string; taskId: string; error: string }
```

#### `task_blocked`
```ts
{ type: "task_blocked"; at: string; taskId: string; blocker: Blocker }
```

#### `task_requeued`
```ts
{ type: "task_requeued"; at: string; taskId: string; reason: string; resolutionInstruction?: string }
```

#### `task_contract_patched`
```ts
{ type: "task_contract_patched"; at: string; taskId: string; patch: BlockerResolutionPatch; durabilityCommitRef: string }
```

#### `test_spec_patched`
```ts
{ type: "test_spec_patched"; at: string; taskId: string; patch: BlockerResolutionPatch; durabilityCommitRef: string }
```

### Human intervention

#### `human_intervention_requested`
```ts
{ type: "human_intervention_requested"; at: string; taskId: string; reason: string; suggestion: string }
```

#### `human_intervention_resolved`
```ts
{ type: "human_intervention_resolved"; at: string; taskId: string; resolution: string; resolutionMode?: BlockerResolutionMode }
```

### Run/execution control

#### `run_paused`
```ts
{ type: "run_paused"; at: string; label: string; nextAction: NextAction; reason?: string }
```

#### `run_resumed`
```ts
{ type: "run_resumed"; at: string; reason?: string }
```

### Review

#### `integration_review_started`
```ts
{ type: "integration_review_started"; at: string }
```

#### `integration_review_completed`
```ts
{ type: "integration_review_completed"; at: string; reviewFile: string }
```

## Snapshot derivation

Events are replayed in order to produce a `RunSnapshot`. See `src/derive.ts` for the derivation logic and `ARCHITECTURE-V2.md` for the status derivation rules.

## Invariants

- Event order is total and immutable.
- No event is ever modified or deleted.
- All durable state changes must be represented as events.
- `state.json` is regenerated from replay; it must never be manually mutated as an authority source.
