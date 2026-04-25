# TaskForge

> **V2-only runtime** — V1 code deleted, event-sourced engine, 320 tests, 6/6 drift checks.
>
> Historical refactor log: `WORKLOG-V2.md` | Roadmap: `REFACTOR-ROADMAP-V2.md`

TaskForge is a pi extension for **hierarchical multi-agent orchestration**.

It takes a Product Requirement Document (PRD), analyzes it with the right kind of model, produces an implementation plan, decomposes that plan into tasks, and then coordinates worker agents until execution is complete.

Unlike a simple auto-router, TaskForge does **workflow routing**, not just prompt routing.

---

## What TaskForge does

TaskForge runs a structured pipeline:

0. **Scope Classifier** routes work into `micro`, `standard`, or `complex`
1. **Strategist** analyzes the PRD *(standard/complex)*
2. **Planner** produces architecture + task graph
3. **Test Designer** produces grounded pre-implementation test specs *(standard/complex)*
4. **Approval Gate** pauses before spending execution tokens
5. **Workers** execute tasks in dependency order
6. **Gate Reviewer** validates each task
7. **Integration Reviewer** reviews the whole result

This gives you:
- inspectable artifacts at every phase
- model selection by **role/capability tier**
- parallel execution for independent tasks
- blocker escalation back to the coordinator/user
- resumable state and execution logs

---

## Architecture

```text
User
  │
  └─ /forge prd.md
       │
       ▼
TaskForge Extension
  │
  ├─ Phase 0: Scope Classifier
  │    └─ 00-routing.json
  │
  ├─ Phase 1: Strategist
  │    └─ 01-requirements.md
  │
  ├─ Phase 2: Planner
  │    ├─ 02-plan.md
  │    ├─ 03-tasks.json
  │    ├─ 03-tasks.md
  │    └─ 03-cost-estimate.md
  │
  ├─ Phase 3: Test Designer
  │    ├─ 03-test-spec.json
  │    └─ 03-test-spec.md (optional)
  │
  ├─ Phase 4: Approval Gate
  │    └─ waits for /forge execute
  │
  ├─ Phase 5: Workers + Gate Reviewer
  │    ├─ tasks/TASK-001.md
  │    ├─ tasks/TASK-001.gate.json
  │    └─ tasks/TASK-XYZ.iterations.log (iterative tasks)
  │
  └─ Phase 6: Integration Reviewer
       └─ 04-review.md
```

### Design principles

- **Inspectability over magic**
  - every phase writes artifacts you can read
- **Plan before you burn tokens**
  - execution is gated by default
- **Context is the bottleneck**
  - tasks carry explicit context manifests
- **Feedback flows upward**
  - workers can raise blockers instead of improvising
- **Fail narrow, recover wide**
  - one task can fail without losing the whole run state
- **Model-agnostic orchestration**
  - roles map to capability tiers, not one hardcoded model

---

## Roles

TaskForge currently uses these runtime roles:

| Role | Purpose |
|---|---|
| `scopeClassifier` | Route work into micro / standard / complex |
| `strategist` | Analyze PRD and produce requirements artifact |
| `planner` | Produce architecture + task graph in one pass |
| `testDesigner` | Produce grounded pre-implementation test specs |
| `worker` | Execute bounded single-pass tasks |
| `workerIterative` | Execute compile/test/fix loop tasks |
| `gateReviewer` | Validate a single task result |
| `diagnosticReviewer` | Classify persistent test-related failures |
| `integrationReviewer` | Review the full implementation across tasks |

### Agent definition files

These files live in:

```text
~/.pi/agent/extensions/task-forge/agents/
```

- `scope-classifier.md`
- `strategist.md`
- `planner.md`
- `worker.md`
- `worker-iterative.md`
- `gate-reviewer.md`
- `diagnostic-reviewer.md`
- `integration-reviewer.md`
- `test-designer.md`

They are now **runtime inputs**, not just documentation.

TaskForge loads them and uses:
- **frontmatter** for default metadata like `tools`
- **body** as the actual system prompt

### Model selection

Agent markdown files define prompts and default tools.

Actual model choice comes from:

```text
.pi/task-forge.json
```

TaskForge resolves a model by:

```text
role -> capability tier -> ordered model list -> first available model
```

---

## Capability tiers

TaskForge uses four capability tiers:

| Tier | Purpose |
|---|---|
| `reasoning` | Deep analysis, ambiguity detection, PRD interpretation |
| `coding` | Architecture design, planning, integration review |
| `bulk` | Cheap, frequent, parallel single-pass execution |
| `endurance` | Feedback-loop coherence for iterative validation, refinement, and long-running correction loops |

Example default mapping:

| Role | Tier |
|---|---|
| `scopeClassifier` | `bulk` |
| `strategist` | `reasoning` |
| `planner` | `coding` |
| `testDesigner` | `coding` |
| `worker` | `bulk` |
| `workerIterative` | `endurance` |
| `gateReviewer` | `bulk` |
| `diagnosticReviewer` | `coding` |
| `integrationReviewer` | `coding` |

---

## Workflow modes

TaskForge now routes work into one of three orchestration modes before normal planning begins.

| Mode | Trigger | Behavior |
|---|---|---|
| `micro` | likely <= 3 tasks, single component, low ambiguity | skips Strategist and Test Designer, uses compact planner pass, then approval gate |
| `standard` | bounded but non-trivial work | full normal pipeline |
| `complex` | cross-cutting, ambiguous, architecture-sensitive work | inserts a mandatory checkpoint after requirements before planning continues |

The routing decision is written to:

```text
.task-forge/00-routing.json
```

## Workflow phases

## Phase 0 — Scope Classifier

**Input:** PRD + codebase file tree summary  
**Output:** `00-routing.json`

This phase estimates the orchestration mode and explains why.

In `complex` mode, TaskForge adds a human checkpoint after requirements before continuing planning.

---

## Phase 1 — Strategist

**Input:** PRD + codebase file tree summary  
**Output:** `01-requirements.md`

The strategist extracts:
- executive summary
- objectives
- user stories
- functional requirements
- non-functional requirements
- constraints
- success metrics
- risks
- ambiguities and open questions

This phase is intentionally analysis-only.

---

## Phase 2 — Planner

**Input:** requirements artifact + codebase file tree  
**Outputs:**
- `02-plan.md`
- `03-tasks.json`
- `03-tasks.md`
- `03-cost-estimate.md`

The planner does two things in one pass:

1. architecture / implementation planning
2. task decomposition

Each task can include:
- `task_mode`: `single-pass` or `iterative`
- `context_manifest`
- `output_manifest`
- `dependencies`
- `acceptance_criteria`
- `escalation_triggers`
- `turn_budget`
- `test_command`
- optional `measurable_targets`

---

## Phase 3 — Test Designer

**Input:** requirements + plan + tasks + codebase shape  
**Outputs:**
- `03-test-spec.json`
- optional `03-test-spec.md`

The Test Designer produces **grounded** pre-implementation tests only:
- contract tests
- acceptance tests
- integration tests
- structural smoke tests for explicitly committed interfaces

It must not invent internal APIs or function signatures that do not yet exist.

TaskForge propagates the resulting test metadata into task execution context so workers can see the intended acceptance signal before implementation.

---

## Phase 4 — Approval Gate

**Default behavior:** TaskForge stops here.

This is deliberate.

You review the plan artifacts before spending execution tokens.

Then either:
- run `/forge execute`
- edit the plan/tasks first
- abort the run

You can bypass the gate with:

```text
/forge prd.md --execute
```

---

## Phase 5 — Execution

Tasks are scheduled according to dependency order.

### Task modes

#### `single-pass`
Used for:
- bounded implementation tasks
- scaffolding
- straightforward edits
- simple feature slices

Executed by the `worker` role.

#### `iterative`
Used for:
- compile/test/fix loops
- optimization tasks
- tasks with measurable validation signals
- tasks that benefit from multiple correction cycles

Executed by the `workerIterative` role.

TaskForge now enforces orchestrator-level TDD phases for iterative tasks:
- **Red** must establish a failing validation signal
- **Green** must turn validation green
- **Refactor** must keep validation green

If refactor breaks green, TaskForge sends the task back to Green.

If `test_command` is set, TaskForge runs it after each iteration and feeds the result back into the loop.

If `acceptance_signal` is provided in prose form like:

```text
pytest tests/integration/test_auth.py exits 0
```

TaskForge normalizes that into a runnable command before validation.

### Gate review

After a task finishes, `gateReviewer` validates:
- acceptance criteria
- output manifest alignment
- obvious local correctness
- measurable target satisfaction for iterative tasks
- grounded alignment with generated test metadata when a test spec exists

For test-heavy or iterative tasks, TaskForge promotes gate review onto a stronger model tier while keeping the same gate-review role prompt.

Validation is coverage-aware when a `coverage_threshold` is present. TaskForge now uses lightweight framework-aware adapters before falling back to generic parsing.

For iterative tasks, orchestrator state tracks the TDD phase itself instead of relying only on prompt wording.

Currently recognized families include:
- pytest / coverage.py / pytest-cov
- jest / vitest / nyc / Istanbul-style summaries
- `go test` coverage output
- cargo llvm-cov / tarpaulin style Rust coverage output
- generic `Statements`, `Lines`, `Branches`, `Functions` summaries

The detected validation framework is recorded in task validation output.

If a coverage threshold exists but no coverage value can be parsed, validation fails conservatively.

If a test-related task still fails persistently, TaskForge invokes `diagnosticReviewer` to classify whether the root cause is:
- bad implementation
- bad test spec
- bad requirement/plan

A test-spec error can rewrite the per-task test spec and requeue the task automatically. A requirement/plan error becomes a structured blocker.

If gate review fails:
- the task is retried up to `maxRetries`
- then marked `failed` or `blocked`

---

## Phase 6 — Integration Review

**Input:** completed task outputs + requirements + plan  
**Output:** `04-review.md`

The integration reviewer focuses on:
- cross-component coherence
- correctness vs requirements
- security/performance risks
- testing gaps
- documentation gaps
- systemic issues, not local task details

---

## Blockers

A key feature of TaskForge is that agents do **not** have to blindly continue when the plan is wrong.

A worker or gate reviewer can raise a blocker when it discovers a plan-level issue.

Examples:
- the architecture in the plan conflicts with codebase reality
- a required dependency is missing
- a task is underspecified in a way that should not be guessed
- the planner chose the wrong interaction pattern or storage model

When that happens:
- the task becomes `blocked`
- the blocker is recorded in state
- execution pauses for the affected path
- you can resolve it explicitly

Resolve a blocker with:

```text
/forge blocker TASK-007 --resolve "Use SSE instead of polling and update downstream tasks accordingly"
```

Then continue with:

```text
/forge execute
```

---

## State and artifacts

TaskForge writes artifacts into:

```text
.task-forge/
```

### Core files

- `events.jsonl` — **authoritative** append-only event log (V2 source of truth)
- `state.json` — derived snapshot for UI/debugging (regenerated from events on every load)
- `00-routing.json`
- `01-requirements.md`
- `02-plan.md`
- `03-tasks.json`
- `03-tasks.md`
- `03-cost-estimate.md`
- `03-test-spec.json`
- `03-test-spec.md`
- `04-review.md`

### Task files

Inside:

```text
.task-forge/tasks/
```

You may see:
- `TASK-001.md` — worker result
- `TASK-001.gate.json` — gate review output
- `TASK-001.iterations.log` — iterative loop history

These files are useful for debugging and resuming runs.

### Exiting pi during execution

TaskForge performs a resumable interruption step on shutdown.

If pi exits while TaskForge is actively executing or reviewing:
- in-flight `running` tasks are converted back to `pending`
- orchestration status is moved to `paused`
- `nextAction` is set so `/forge execute` can resume safely
- interruption is captured as V2 events in `events.jsonl`

Restart replays `events.jsonl` to reconstruct state. Status after restart matches status before restart for the same event log.

---

## Configuration

TaskForge reads config using this search order:

1. `<cwd>/.pi/task-forge.json`
2. `.pi/task-forge.json` found in current-directory subtrees
3. `~/.pi/agent/extensions/task-forge/task-forge.json`

Subtree search currently skips common heavy directories like:
- `.git`
- `node_modules`
- `.task-forge`

Example:

```json
{
  "modelTiers": {
    "reasoning": [
      "openai-codex/gpt-5.5",
      "opencode-go/glm-5.1",
      "anthropic/claude-opus-4-7"
    ],
    "coding": [
      "openai-codex/gpt-5.3-codex",
      "opencode-go/kimi-k2.6",
      "anthropic/claude-sonnet-4-6"
    ],
    "bulk": [
      "opencode-go/kimi-k2.6",
      "openai-codex/gpt-5.3-codex",
      "anthropic/claude-sonnet-4-6"
    ],
    "endurance": [
      "openai-codex/gpt-5.3-codex",
      "opencode-go/glm-5.1",
      "anthropic/claude-sonnet-4-6"
    ]
  },
  "roleAssignment": {
    "scopeClassifier": "bulk",
    "strategist": "reasoning",
    "planner": "coding",
    "testDesigner": "coding",
    "worker": "bulk",
    "workerIterative": "endurance",
    "gateReviewer": "bulk",
    "diagnosticReviewer": "coding",
    "integrationReviewer": "coding"
  },
  "modelOverrides": {},
  "maxWorkers": 4,
  "maxRetries": 2,
  "defaultTurnBudget": 50,
  "maxTurnBudget": 200,
  "outputDir": ".task-forge",
  "autoExecute": false,
  "contextBudgetPercent": 70,
  "costLimitUsd": 10
}
```

> The authoritative runtime defaults for this workspace live in `agent/extensions/task-forge/task-forge.json`.

### Config fields

| Field | Meaning |
|---|---|
| `modelTiers` | ordered fallback lists per capability tier |
| `roleAssignment` | role → tier mapping |
| `modelOverrides` | pin a specific model for a role |
| `maxWorkers` | parallel worker slots |
| `maxRetries` | retries per task after failure |
| `defaultTurnBudget` | default iterative turn budget |
| `maxTurnBudget` | upper bound for iterative tasks |
| `outputDir` | artifact directory |
| `autoExecute` | skip approval gate automatically |
| `contextBudgetPercent` | reserved context budget threshold |
| `costLimitUsd` | warning threshold for estimated cost |

---

## V2 runtime architecture

TaskForge runs on a **V2-only event-sourced engine**.

- `events.jsonl` is the authoritative source of truth.
- `state.json` is derived/debug-only and regenerated on every load.
- All command decisions use V2 snapshots derived from event replay.
- Session memory is advisory only and never authoritative.

Key modules:

- `ARCHITECTURE-V2.md` — design principles and invariants
- `EVENTS.md` — canonical event reference
- `src/types.ts` — durable types
- `src/events.ts` — event constructors and type guards
- `src/derive.ts` — replay and snapshot derivation
- `src/storage.ts` — event append/load and snapshot write
- `src/preflight.ts` — runtime/preflight normalization
- `src/engine.ts` — orchestration API
- `src/migrate.ts` — one-way legacy state import (migration-only)

## Commands

### Start planning only

```text
/forge prd.md
```

Runs:
- strategist
- planner
- approval gate

Stops before execution.

### Full run immediately

```text
/forge prd.md --execute
```

Runs the whole workflow.
The command now starts execution asynchronously and returns control immediately so you can keep using `/forge status`, `/forge cost`, or `/forge abort` while the run is active.

### Execute an approved plan

```text
/forge execute
```

Starts execution in the background and returns immediately.

### Show status

```text
/forge status
```

### Pause execution

```text
/forge pause
```

### Resume execution

```text
/forge resume
```

Resumes execution in the background and returns immediately.

### Human-intervention behavior

TaskForge now treats several failure classes as immediate human-help blockers instead of blind retries, including:
- missing runtime tools/scripts (`playwright: not found`, exit 127)
- test path / working-directory mismatches (`No tests found`)
- dependency service reachability failures (`ECONNREFUSED`, `fetch failed`)
- CORS policy failures
- native binary / platform mismatches (`Exec format error`, `ERR_DLOPEN_FAILED`, wrong-platform `esbuild`/`better-sqlite3`)

When detected, TaskForge:
- blocks the task immediately
- pauses orchestration in a resumable state
- emits a persistent visible message with the reason, suggested human action, and next commands

TaskForge also emits a human-help message when a task appears stalled for an extended period during execution.

### Abort run

```text
/forge abort
```

### Show cost estimate

```text
/forge cost
```

### Show resolved models per role

```text
/forge models
```

### Show effective config

```text
/forge config
```

### Resolve blocker

```text
/forge blocker TASK-007 --resolve "Use Redis streams instead of polling"
```

### Help

```text
/forge help
```

---

## TDD architecture review

TaskForge now includes a wired **Test Designer** phase for grounded pre-implementation test specs.

The reviewed design is:
- pre-approval **grounded** contract / acceptance / integration test design
- worker-generated internal/unit failing tests inside iterative execution
- future diagnostic escalation when implementation, test spec, and requirement disagree

See:

```text
docs/history/ARCHITECTURE-REVIEW.md
```

for the historical architecture review.

## Current implementation notes

### Agent files are live

The files in `agents/*.md` are used at runtime.

TaskForge loads them and uses:
- frontmatter for default tools metadata
- file body as the role’s system prompt

### Model frontmatter is not authoritative

Even if an agent file has:

```yaml
model: anthropic/claude-sonnet-4-5
```

TaskForge still resolves the model primarily through:
- tier config
- role assignment
- model overrides

So today the source of truth is:
- **prompt + tools** → `agents/*.md`
- **model routing** → `.pi/task-forge.json`

### Worker execution model

TaskForge currently spawns subprocess pi runs with a minimal isolated runtime, roughly like:

```text
pi --no-session --no-extensions --no-skills --no-prompt-templates --no-themes --model ... --tools ... --system-prompt ... -p ...
```

So each worker has isolated context and does not recursively load your full interactive extension stack.

---

## Suggested usage pattern

1. Write or collect a PRD
2. Run:
   ```text
   /forge prd.md
   ```
3. Read:
   - `01-requirements.md`
   - `02-plan.md`
   - `03-tasks.md`
   - `03-cost-estimate.md`
4. If needed, edit `03-tasks.json`
5. Execute:
   ```text
   /forge execute
   ```
6. Watch status:
   ```text
   /forge status
   ```
7. Resolve blockers if needed
8. Read final review:
   - `04-review.md`

---

## Limitations / next steps

Current implementation is already useful, but still has room to grow.

Potential next improvements:
- project-local agent overrides
- stronger context-budget enforcement
- richer task splitting heuristics
- better cost estimation
- recovery from partially interrupted iterative tasks
- TUI widget for DAG execution state
- direct use of subagent framework instead of subprocess-only orchestration

---

## Summary

TaskForge is a multi-agent execution framework for PRD-to-implementation workflows.

It is designed to be:
- inspectable
- controllable
- resumable
- cheaper than naive high-end-model-everywhere orchestration
- safer than prompt-by-prompt model routing

If auto-router answers **“which model should handle this prompt?”**, TaskForge answers:

**“how should multiple agents, models, and validation loops work together to execute this plan?”**
