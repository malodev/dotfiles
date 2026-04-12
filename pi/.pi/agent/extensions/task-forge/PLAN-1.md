# TaskForge — Hierarchical Multi-Agent Orchestration Plan (v3)

## Overview

TaskForge is a pi extension that orchestrates multiple specialized AI agents to transform Product Requirement Documents (PRDs) into working implementations. Unlike the auto-router (which selects models per prompt), TaskForge manages a complete workflow with agents that report back to a coordinator until the plan is executed.

### Design Principles

1. **Inspectability over magic** — every phase produces a human-readable artifact; the chain is debuggable at every seam.
2. **Context is the bottleneck** — task sizing, worker context injection, and artifact flow are designed around token budgets, not human-time estimates.
3. **Plan before you burn tokens** — dry-run (Phases 1–3) is the default; execution requires explicit user approval.
4. **Feedback flows upward** — workers can escalate blockers back to planning; the pipeline is not strictly linear.
5. **Fail narrow, recover wide** — task failures are isolated; the system saves state atomically and resumes cleanly.
6. **Model-agnostic by design** — roles map to capability tiers, not hardcoded model names; the system degrades gracefully when preferred models are unavailable.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER                                           │
│                    /forge prd.md [--execute]                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TASKFORGE EXTENSION                               │
│                         (Orchestrator / Phase Manager)                      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        PHASE MANAGER                                │    │
│  │   Analyze ──► Plan & Decompose ──► [Approve] ──► Execute ──► Review │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      STATE MANAGER                                  │    │
│  │   state.json (atomic writes) + state.log (append-only audit trail)  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     MODEL RESOLVER                                  │    │
│  │   Role → Tier → Priority list → first available model               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┘
                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         AGENT POOL                                        │
│                                                                           │
│  ┌───────────────────┐   ┌────────────────────────────────────────────┐   │
│  │    STRATEGIST     │   │           PLANNER                          │   │
│  │                   │   │   (Architect + Coordinator, merged)        │   │
│  │  Tier: reasoning  │   │                                            │   │
│  │  Tools: read-only │   │  Tier: coding                              │   │
│  │                   │   │  Tools: read-only                          │   │
│  │  Analyzes PRD:    │   │                                            │   │
│  │  • Objectives     │   │  Produces in a single pass:                │   │
│  │  • Requirements   │   │  • Architecture & patterns                 │   │
│  │  • Constraints    │   │  • Component breakdown                     │   │
│  │  • Risks          │   │  • Data models & API design                │   │
│  │                   │   │  • Task list with context manifests        │   │
│  │                   │   │  • Dependency DAG                          │   │
│  │                   │   │  • Task modes (single-pass / iterative)    │   │
│  │                   │   │  • Cost estimate                           │   │
│  └───────────────────┘   └────────────────────────────────────────────┘   │
│                                        │                                  │
│                     ┌──────────────────┘                                  │
│                     ▼                                                     │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                       WORKER POOL                                  │   │
│  │                                                                    │   │
│  │  ┌────────────────────┐  ┌────────────────────┐                    │   │
│  │  │ SINGLE-PASS WORKER │  │ ITERATIVE WORKER   │                    │   │
│  │  │ Tier: bulk         │  │ Tier: endurance     │                    │   │
│  │  │                    │  │                     │                    │   │
│  │  │ One-shot output,   │  │ Compile/test loop,  │                    │   │
│  │  │ gate reviewed      │  │ up to N turns,      │                    │   │
│  │  │                    │  │ self-correcting      │                    │   │
│  │  └────────┬───────────┘  └────────┬────────────┘                    │   │
│  │           │                       │                                 │   │
│  │           ▼                       ▼                                 │   │
│  │  ┌──────────────────────────────────────────────────┐              │   │
│  │  │              GATE REVIEWER (per-task)             │              │   │
│  │  │  Tier: bulk — lightweight validation              │              │   │
│  │  └──────────────────────────────────────────────────┘              │   │
│  │                          │                                         │   │
│  │                          ▼                                         │   │
│  │  ┌──────────────────────────────────────────────────┐              │   │
│  │  │           INTEGRATION REVIEWER (final)           │              │   │
│  │  │  Tier: coding — cross-cutting concerns           │              │   │
│  │  └──────────────────────────────────────────────────┘              │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  ESCALATION PATH  (Worker → Phase Manager → User)                  │   │
│  │  Blockers that invalidate the plan surface before more tokens burn  │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────┘
```

## Model Selection Strategy

### Capability Tiers

Rather than hardcoding model names per role, TaskForge maps each role to a **capability tier**. Each tier is a priority-ordered list of models: the orchestrator tries the first available model and falls back down the list. This lets the system degrade gracefully when a preferred model (e.g., Opus) is unavailable, without manual reconfiguration.

```json
{
  "modelTiers": {
    "reasoning": [
      "anthropic/claude-opus-4-5",
      "opencode-go/glm-5.1",
      "openai-codex/gpt-5.1"
    ],
    "coding": [
      "anthropic/claude-sonnet-4-5",
      "opencode-go/glm-5.1",
      "openai-codex/gpt-5.2-codex"
    ],
    "bulk": [
      "openai-codex/gpt-5.1-codex-mini",
      "opencode-go/glm-5",
      "opencode-go/kimi-k2.5"
    ],
    "endurance": [
      "opencode-go/glm-5.1",
      "openai-codex/gpt-5.2-codex",
      "anthropic/claude-sonnet-4-5"
    ]
  }
}
```

#### Tier Definitions

| Tier        | Purpose                                 | Key Properties                                                    |
| ----------- | --------------------------------------- | ----------------------------------------------------------------- |
| `reasoning` | Deep analysis, nuance, ambiguity detection | Strong reasoning, catches contradictions, large output window    |
| `coding`    | Architecture design, structured planning, integration review | Technical depth, structured output, good code generation |
| `bulk`      | High-volume parallel execution, gate reviews | Cost-effective, fast, reliable single-pass code generation       |
| `endurance` | Iterative compile/test/fix loops, optimization tasks | Goal alignment over many turns, self-correction, staircase pattern |

#### Role → Tier Mapping

| Role                  | Tier        | Why                                                                |
| --------------------- | ----------- | ------------------------------------------------------------------ |
| Strategist            | `reasoning` | Needs deep PRD analysis, ambiguity detection, risk assessment      |
| Planner               | `coding`    | Needs technical depth for architecture + task decomposition        |
| Worker (single-pass)  | `bulk`      | High-volume, parallelized; cost is the primary concern             |
| Worker (iterative)    | `endurance` | Needs sustained coherence over many compile/test cycles            |
| Gate Reviewer         | `bulk`      | Lightweight validation, high frequency, low token cost             |
| Integration Reviewer  | `coding`    | Cross-cutting analysis requires strong technical understanding     |

#### Provider Economics

Models accessed through direct providers (`openai-codex`, `opencode-go`) are significantly cheaper per token than those routed through OpenRouter. The tier system reflects this: `bulk` and `endurance` tiers prioritize direct-provider models, while `reasoning` allows OpenRouter fallbacks for models not available elsewhere.

| Provider       | Cost Profile | Available Models (notable)                                      |
| -------------- | ------------ | --------------------------------------------------------------- |
| `openai-codex` | Cheapest     | gpt-5.1, gpt-5.2-codex, gpt-5.1-codex-mini                    |
| `opencode-go`  | Cheap        | glm-5.1, glm-5, kimi-k2.5, mimo-v2-pro                        |
| `openrouter`   | Expensive    | claude-opus-4-5/4-6, claude-sonnet-4-5/4-6, gpt-5.4-pro       |

#### Default Configuration Without Opus

When Opus is unavailable or cost-prohibitive, the resolved defaults become:

| Role                  | Resolved Model                 | Rationale                                               |
| --------------------- | ------------------------------ | ------------------------------------------------------- |
| Strategist            | `opencode-go/glm-5.1`         | Strong reasoning + thinking mode, direct-provider cost  |
| Planner               | `opencode-go/glm-5.1`         | Technical depth, 131K output window for large plans     |
| Worker (single-pass)  | `openai-codex/gpt-5.1-codex-mini` | Cheapest competent coder, 128K output                |
| Worker (iterative)    | `opencode-go/glm-5.1`         | Proven endurance over 1,700+ tool calls                 |
| Gate Reviewer         | `openai-codex/gpt-5.1-codex-mini` | Lightweight, cheap, fast                             |
| Integration Reviewer  | `opencode-go/glm-5.1`         | Cross-cutting analysis benefits from deep reasoning     |

#### Model Capabilities Reference

| Model                          | Context | Max Output | Thinking | Vision | Notes                                    |
| ------------------------------ | ------- | ---------- | -------- | ------ | ---------------------------------------- |
| `opencode-go/glm-5.1`         | 204.8K  | 131.1K     | Yes      | No     | Endurance champion, staircase pattern    |
| `opencode-go/glm-5`           | 204.8K  | 131.1K     | Yes      | No     | Cheaper, less endurance                  |
| `opencode-go/kimi-k2.5`       | 262.1K  | 65.5K      | Yes      | Yes    | Large context, smaller output            |
| `opencode-go/mimo-v2-pro`     | 1.0M    | 64K        | Yes      | No     | Massive context for large codebases      |
| `openai-codex/gpt-5.1`        | 272K    | 128K       | Yes      | Yes    | Strong generalist, good for strategy     |
| `openai-codex/gpt-5.2-codex`  | 272K    | 128K       | Yes      | Yes    | Strong coder, good structured output     |
| `openai-codex/gpt-5.1-codex-mini` | 272K | 128K      | Yes      | Yes    | Cost-optimized coder                     |
| `anthropic/claude-opus-4-5`   | 200K    | 64K        | Yes      | Yes    | Best reasoning, expensive (OpenRouter)   |
| `anthropic/claude-sonnet-4-5` | 1M      | 64K        | Yes      | Yes    | Strong all-rounder, expensive            |

## Workflow Phases

### Phase 1: PRD Analysis (Strategist — Tier: `reasoning`)

**Input**: PRD file + existing codebase summary (if available)
**Output**: `01-requirements.md`

The Strategist analyzes the PRD and extracts:

- Executive summary
- Core objectives (SMART goals)
- User personas and stories
- Functional requirements (prioritized: must/should/could)
- Non-functional requirements (performance, security, accessibility)
- Constraints and assumptions
- Success metrics (KPIs)
- Risks and dependencies
- Ambiguities and open questions (flagged for user resolution)

**Why `reasoning` tier**: Deep understanding, nuanced analysis, catches ambiguities and contradictions. The Strategist also identifies underspecified areas and surfaces them as explicit questions rather than making silent assumptions. GLM-5.1's thinking mode is well-suited here as a cost-effective Opus alternative.

---

### Phase 2: Planning & Decomposition (Planner — Tier: `coding`)

**Input**: `01-requirements.md` + codebase file tree
**Output**: `02-plan.md`, `03-tasks.json`, `03-tasks.md`, `03-cost-estimate.md`

The Planner produces architecture and task decomposition in a single pass, because the person designing the system is the one best positioned to slice it into work units. Splitting these into two agents would force a lossy re-interpretation of intent.

#### Architecture section (`02-plan.md`)

- Architecture overview and patterns
- Component breakdown with responsibilities
- Data models and schemas
- API design (endpoints, contracts, error handling)
- Implementation sequence with phases
- Testing strategy (unit, integration, e2e)
- Deployment approach

#### Task decomposition section (`03-tasks.json`, `03-tasks.md`)

Each task includes:

- **Context manifest**: explicit list of input files/artifacts the worker needs to read (controls what enters the context window)
- **Output manifest**: explicit list of files the worker will create or modify
- **Dependency edges**: which tasks must complete before this one can start (forming a DAG)
- **Complexity class**: S / M / L (mapped to estimated token budget, not human hours)
- **Task mode**: `single-pass` or `iterative` (see Task Execution Modes below)
- **Acceptance criteria**: concrete, verifiable conditions for the Gate Reviewer
- **Escalation triggers**: conditions under which the worker should stop and raise a blocker instead of improvising
- **Measurable targets** (iterative mode only): numeric thresholds that define "done" (e.g., "all tests pass", "response time < 200ms", "benchmark score > X")

#### Cost estimate (`03-cost-estimate.md`)

- Estimated input/output tokens per task (based on context manifest sizes, complexity class, and task mode)
- Iterative tasks include a turn-budget multiplier in the estimate
- Total estimated cost across all workers + reviewers
- Breakdown by phase

**Size heuristic**: Tasks are sized by context pressure, not clock time. A task is "too big" when its context manifest + expected output would exceed ~70% of the model's context window. A task is "too small" when it produces a trivial change that could be folded into a neighbor.

**Why `coding` tier**: Strong technical depth, good at structured output, cost-effective. GLM-5.1's 131K output window is generous for producing large, detailed plans. The merged role avoids the lossy handoff between separate Architect and Coordinator agents.

---

### Phase 3: User Approval Gate

**Input**: `02-plan.md`, `03-tasks.md`, `03-cost-estimate.md`
**Output**: User decision (approve / edit / abort)

This is **not optional**. The default `forge` command stops here and presents the plan for review. The user can:

- Approve and proceed to execution (`/forge execute` or `--execute` flag)
- Edit `03-tasks.json` manually (including changing task modes or turn budgets) and re-run validation
- Abort

**Why a gate**: Burning tokens on a bad plan is the primary failure mode of multi-agent systems. Showing estimated cost (now including iterative turn budgets) and task structure before execution gives the user meaningful control.

---

### Phase 4: Task Execution (Workers — Parallel)

**Input**: Individual task from `03-tasks.json` + files listed in context manifest
**Output**: `tasks/TASK-001.md`, `tasks/TASK-002.md`, ...

Workers execute tasks in dependency order, with parallelism for independent tasks.

#### Task Execution Modes

The Planner assigns a **task mode** to each task based on its nature and acceptance criteria. This determines how the worker operates and which model tier is selected.

##### `single-pass` (default)

- **Tier**: `bulk` (e.g., `openai-codex/gpt-5.1-codex-mini`)
- **Behavior**: Worker receives context, produces output in one shot, exits.
- **Gate review**: Immediate — validates against acceptance criteria.
- **Best for**: Schema definitions, boilerplate scaffolding, configuration files, straightforward CRUD implementations, documentation.
- **Cost**: Low — one input/output cycle per task.

##### `iterative`

- **Tier**: `endurance` (e.g., `opencode-go/glm-5.1`)
- **Behavior**: Worker gets a compile/test/fix loop with a **turn budget** (configurable, default 50, max 200). Each iteration:
  1. Worker produces or modifies code
  2. Orchestrator runs the task's test/compile command (defined in acceptance criteria)
  3. Results (pass/fail, error output, benchmark scores) are fed back to the worker
  4. Worker decides: fix, optimize further, or declare done
- **Gate review**: After the worker declares done or exhausts its turn budget — validates the *final* output.
- **Best for**: Algorithm implementation with performance targets, complex integrations requiring iterative debugging, optimization tasks with measurable benchmarks, tasks where acceptance criteria include numeric thresholds.
- **Cost**: Higher — multiple cycles, but the endurance model's self-correction avoids the retry tax of a single-pass worker that fails gate review repeatedly.

##### How the Planner Decides

The Planner assigns `iterative` mode when:

1. Acceptance criteria include **measurable targets** (test pass rates, performance thresholds, benchmark scores)
2. The task involves **compilation or runtime validation** (the output can be mechanically tested)
3. The task is **optimization-oriented** (improving an existing implementation, not creating from scratch)
4. The complexity class is L and the task has a **clear feedback signal**

If none of these conditions apply, the task defaults to `single-pass`.

##### Turn Budget Guidelines

| Task Nature                          | Suggested Turn Budget | Rationale                                           |
| ------------------------------------ | --------------------- | --------------------------------------------------- |
| Fix until tests pass                 | 20–50                 | Most test failures resolve in < 10 iterations        |
| Performance optimization (moderate)  | 50–100                | Staircase pattern needs room for structural shifts   |
| Complex algorithm + benchmarking     | 100–200               | Deep optimization may need many experimental cycles  |
| Exploratory / research-like          | 150–200               | Maximum budget, diminishing returns beyond 200       |

#### Common Execution Flow (both modes)

- Read **only** the files listed in the task's context manifest (not the entire codebase)
- If a dependency produced output, that output is injected into context
- Implement the specific task
- Write clean, documented code
- Report structured results (status, files changed, issues encountered)

#### Scheduling

The task DAG is topologically sorted. A ready queue holds tasks whose dependencies are all resolved. Up to `maxWorkers` tasks run concurrently from the ready queue.

Diamond dependencies are handled naturally: a task enters the ready queue only when *all* its predecessors are `completed`. If predecessor A finishes but predecessor B is still running, the task waits.

The scheduler is mode-aware: iterative tasks occupy a worker slot for their entire turn budget duration, so the orchestrator accounts for this when computing effective parallelism. A pool of 4 workers running 4 iterative tasks is very different from 4 single-pass tasks.

#### Per-task Gate Review

After each worker completes (or an iterative worker declares done / exhausts budget), a lightweight **Gate Reviewer** (tier: `bulk`) validates:

- Acceptance criteria met (yes/no with specifics)
- Output files match the output manifest
- No obvious regressions in files touched
- For iterative tasks: final benchmark results vs. measurable targets

If the gate review fails, the task is retried (up to `maxRetries`). If it fails after retries, it moves to `blocked` and dependent tasks are held.

This catches problems *early* — a wrong data model in Task 3 is caught before Tasks 4–11 build on top of it.

#### Escalation Protocol

A worker may encounter a situation where the plan itself is wrong (e.g., an API design doesn't work, a dependency is missing, a constraint was underspecified). Instead of improvising a workaround that diverges from the plan, the worker raises a **blocker**:

```json
{
  "task_id": "TASK-007",
  "status": "blocker",
  "reason": "The plan specifies REST for the notification service, but the requirement for real-time updates requires WebSocket or SSE. This is an architectural decision, not a task-level fix.",
  "suggestion": "Consider adding a WebSocket gateway component.",
  "blocked_tasks": ["TASK-008", "TASK-009", "TASK-012"]
}
```

Blockers pause the affected subgraph and surface to the user via `/forge status`. The user can:

- Amend the plan and re-run affected tasks
- Override the blocker and instruct the worker to proceed with a specific approach
- Abort

---

### Phase 5: Integration Review (Reviewer — Tier: `coding`)

**Input**: All completed task outputs + `01-requirements.md` + `02-plan.md`
**Output**: `04-review.md`

The Integration Reviewer validates the *whole*, not individual tasks (those were already gate-reviewed):

- Cross-component coherence (do the pieces fit together?)
- Correctness against original requirements
- Security concerns (auth, input validation, secrets handling)
- Performance issues (N+1 queries, missing indexes, unbounded loops)
- Testing coverage gaps
- Documentation completeness
- Consistency (naming conventions, error handling patterns, API style)
- For iterative tasks: whether optimization results are sound (no benchmark gaming)

The review produces a structured report with severity levels (critical / warning / info) and specific file:line references.

**Why `coding` tier**: Attention to detail, good at catching cross-cutting issues. Per-task gate reviews handle the local concerns, freeing the integration reviewer to focus on systemic problems. GLM-5.1's extended coherence is valuable here — the reviewer needs to hold the full project structure in mind.

---

## File Structure

```
.task-forge/                        # Output directory (configurable)
├── state.json                      # Current orchestration state (atomic writes)
├── state.log                       # Append-only audit trail
├── 01-requirements.md              # Strategist output
├── 02-plan.md                      # Planner output: architecture
├── 03-tasks.json                   # Machine-readable task list with context manifests
├── 03-tasks.md                     # Human-readable task list
├── 03-cost-estimate.md             # Token/cost estimate (includes iterative budgets)
├── 04-review.md                    # Integration Reviewer output
└── tasks/                          # Individual task outputs
    ├── TASK-001.md                 # Worker output + gate review result
    ├── TASK-001.gate.json          # Structured gate review verdict
    ├── TASK-005.md                 # Iterative worker final output
    ├── TASK-005.iterations.log     # Iteration history (compile/test results per turn)
    ├── TASK-005.gate.json
    └── ...
```

## Task Schema (`03-tasks.json`)

```json
{
  "orchestration_id": "forge-20260411-abc123",
  "estimated_cost": {
    "total_input_tokens": 450000,
    "total_output_tokens": 120000,
    "iterative_budget_tokens": 380000,
    "estimated_usd": 4.20
  },
  "tasks": [
    {
      "id": "TASK-001",
      "title": "Define database schema for user and project models",
      "description": "Create Prisma schema with User, Project, and Membership models...",
      "complexity": "M",
      "task_mode": "single-pass",
      "context_manifest": {
        "artifacts": ["01-requirements.md", "02-plan.md#data-models"],
        "codebase_files": ["prisma/schema.prisma", "src/types/index.ts"],
        "dependency_outputs": []
      },
      "output_manifest": [
        "prisma/schema.prisma",
        "prisma/migrations/001_initial/migration.sql"
      ],
      "dependencies": [],
      "acceptance_criteria": [
        "Schema defines User, Project, Membership models with all fields from 02-plan.md",
        "Migration file is generated and syntactically valid",
        "Indexes on email, project_id foreign keys"
      ],
      "escalation_triggers": [
        "If the plan's data model has circular dependencies that Prisma cannot represent",
        "If a required field type is ambiguous in the requirements"
      ],
      "status": "pending",
      "retries": 0
    },
    {
      "id": "TASK-005",
      "title": "Implement and optimize full-text search with relevance scoring",
      "description": "Build search service with PostgreSQL tsvector, tune ranking weights until benchmark targets are met...",
      "complexity": "L",
      "task_mode": "iterative",
      "turn_budget": 80,
      "test_command": "npm run test:search && npm run bench:search",
      "context_manifest": {
        "artifacts": ["01-requirements.md", "02-plan.md#search-architecture"],
        "codebase_files": ["src/services/search.ts", "tests/search.test.ts", "benchmarks/search.bench.ts"],
        "dependency_outputs": ["TASK-001", "TASK-003"]
      },
      "output_manifest": [
        "src/services/search.ts",
        "src/services/search-index.ts",
        "tests/search.test.ts",
        "benchmarks/search.bench.ts"
      ],
      "dependencies": ["TASK-001", "TASK-003"],
      "acceptance_criteria": [
        "All search tests pass",
        "Relevance benchmark: NDCG@10 >= 0.75 on test corpus",
        "Latency: p95 < 200ms on 100K document corpus"
      ],
      "measurable_targets": {
        "tests_pass": true,
        "ndcg_at_10": 0.75,
        "p95_latency_ms": 200
      },
      "escalation_triggers": [
        "If PostgreSQL tsvector cannot express the required ranking semantics",
        "If the test corpus is not available or not defined in the requirements"
      ],
      "status": "pending",
      "retries": 0
    }
  ],
  "dependency_graph": {
    "TASK-001": [],
    "TASK-002": ["TASK-001"],
    "TASK-003": ["TASK-001"],
    "TASK-004": ["TASK-002", "TASK-003"],
    "TASK-005": ["TASK-001", "TASK-003"]
  }
}
```

## Extension Components

### 1. Main Extension (`index.ts`)

- Command registration (`/forge`)
- Phase orchestration (phase transitions, gate checks)
- Worker pool management (ready queue, concurrency limiting, mode-aware scheduling)
- Dependency DAG resolution (topological sort, diamond handling)
- Model resolver (tier → priority list → first available)
- Iterative loop runner (compile/test harness for iterative workers)
- Escalation routing (blocker → user notification)
- Error handling and recovery

### 2. State Manager (`state.ts`)

- Atomic `state.json` writes (write-tmp + rename for crash safety)
- Append-only `state.log` for audit trail
- State reconstruction on resume: read `state.json` (fast path), fall back to `state.log` replay if corrupted
- Phase transition validation (no skipping phases, no re-entering completed phases without explicit reset)

### 3. Model Resolver (`models.ts`)

- Loads tier definitions from configuration
- Maps role → tier → ordered model list
- Probes model availability (API key present, provider reachable)
- Returns first available model for a given role
- Logs resolved model per task for cost tracking and debugging

### 4. Iterative Runner (`iterative.ts`)

- Manages the compile/test/feedback loop for iterative tasks
- Runs `test_command` after each worker turn
- Parses test/benchmark output into structured feedback
- Tracks measurable targets across iterations
- Decides when to stop: targets met, budget exhausted, or worker declares done
- Writes `TASK-NNN.iterations.log` for inspectability

### 5. Agent Definitions (`agents/`)

- `strategist.md` — PRD analysis agent
- `planner.md` — Architecture + task decomposition agent (merged Architect/Coordinator)
- `worker.md` — Single-pass implementation agent (with escalation protocol)
- `worker-iterative.md` — Iterative implementation agent (with test feedback loop and self-correction protocol)
- `gate-reviewer.md` — Per-task lightweight validation agent
- `integration-reviewer.md` — Final cross-cutting review agent

### 6. Configuration (`.pi/task-forge.json`)

```json
{
  "modelTiers": {
    "reasoning": [
      "anthropic/claude-opus-4-5",
      "opencode-go/glm-5.1",
      "openai-codex/gpt-5.1"
    ],
    "coding": [
      "anthropic/claude-sonnet-4-5",
      "opencode-go/glm-5.1",
      "openai-codex/gpt-5.2-codex"
    ],
    "bulk": [
      "openai-codex/gpt-5.1-codex-mini",
      "opencode-go/glm-5",
      "opencode-go/kimi-k2.5"
    ],
    "endurance": [
      "opencode-go/glm-5.1",
      "openai-codex/gpt-5.2-codex",
      "anthropic/claude-sonnet-4-5"
    ]
  },
  "roleAssignment": {
    "strategist": "reasoning",
    "planner": "coding",
    "worker": "bulk",
    "workerIterative": "endurance",
    "gateReviewer": "bulk",
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
  "costLimitUsd": 10.00
}
```

#### Configuration Precedence

1. **`modelOverrides`**: Explicit model per role (e.g., `"strategist": "openai/o3"`) — highest priority, skips tier resolution entirely.
2. **`roleAssignment`**: Role → tier mapping — resolved against `modelTiers` priority lists.
3. **Built-in defaults**: The tier definitions and role mappings shown above.

This allows users to either trust the tier system or pin specific models for specific roles without changing the tier definitions.

## Commands

| Command                     | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `/forge <prd-file>`         | Analyze + Plan + Decompose (stops at approval gate)|
| `/forge execute`            | Execute approved plan                              |
| `/forge <prd-file> --execute` | Full run without approval gate (opt-in)          |
| `/forge status`             | Show current status, progress, and any blockers    |
| `/forge blocker <task-id> --resolve "<instruction>"` | Override a blocker with specific guidance |
| `/forge pause`              | Pause running workers (in-flight tasks complete)   |
| `/forge resume`             | Resume paused orchestration                        |
| `/forge abort`              | Abort orchestration (state is saved)               |
| `/forge cost`               | Show cost estimate or actual spend so far           |
| `/forge models`             | Show resolved models per role (tier resolution)    |
| `/forge config`             | Show current configuration                         |
| `/forge help`               | Show help                                          |

## State Management

### State Model

```typescript
interface ForgeState {
  orchestrationId: string;
  status: "analyzing" | "planning" | "awaiting_approval" | "executing" | "reviewing" | "completed" | "paused" | "aborted" | "blocked";
  currentPhase: 1 | 2 | 3 | 4 | 5;
  resolvedModels: Record<string, string>; // role → resolved model name
  tasks: Record<string, TaskState>;
  blockers: Blocker[];
  cost: { inputTokens: number; outputTokens: number; estimatedUsd: number };
  timestamps: { started: string; lastUpdated: string; completed?: string };
}

interface TaskState {
  status: "pending" | "ready" | "running" | "completed" | "failed" | "blocked" | "skipped";
  taskMode: "single-pass" | "iterative";
  resolvedModel: string; // actual model used
  retries: number;
  iterationCount?: number; // for iterative tasks: how many turns used
  turnBudget?: number; // for iterative tasks: max allowed turns
  measurableTargets?: Record<string, number | boolean>; // current values
  gateReview?: { passed: boolean; notes: string };
  blocker?: Blocker;
  startedAt?: string;
  completedAt?: string;
}

interface Blocker {
  taskId: string;
  reason: string;
  suggestion: string;
  blockedTasks: string[];
  resolvedBy?: string; // user instruction that resolved it
}
```

### Persistence Strategy

- **Primary**: `state.json` — rewritten atomically (write to `.state.json.tmp`, then `rename`) on every state transition. This is the fast-path for resume.
- **Secondary**: `state.log` — append-only, one JSON line per event. Used for audit and as a fallback if `state.json` is corrupted.
- **Iterative logs**: `tasks/TASK-NNN.iterations.log` — append-only, one entry per compile/test cycle. Separate from state to avoid bloating the main state file.
- **Resume logic**: Read `state.json`. If valid, reconstruct ready queue from task statuses. If corrupted, replay `state.log` to rebuild state. Iterative tasks resume from their last recorded iteration.

State survives session restarts and can be inspected via `/forge status`.

## Error Handling

### Task Failures

- Workers retry up to `maxRetries` times
- Each retry includes the previous attempt's error in context (so the model can learn from it)
- For iterative tasks, "failure" means the worker exhausted its turn budget without meeting measurable targets — the gate reviewer then decides if the partial result is acceptable
- After `maxRetries`, the task moves to `failed`
- Failed tasks block dependent tasks (status: `blocked`)
- `/forge status` shows the failure chain

### Escalation (Plan-Level Failures)

- Workers raise blockers when the plan itself is wrong (not just a coding mistake)
- Blockers pause the affected subgraph, not the entire pipeline
- Independent task branches continue executing
- User resolves blockers via `/forge blocker <id> --resolve "<instruction>"`

### Phase Failures

- If a phase agent fails (not a task, but the phase itself), orchestration stops
- Partial results are saved
- User can inspect outputs and fix issues
- `/forge resume` retries the failed phase

### Model Failures

- If a model in a tier is unreachable or returns errors, the resolver falls to the next model in the priority list
- If all models in a tier fail, the task is marked as `failed` with a clear error indicating model availability issues
- `/forge models` shows which models resolved successfully and which were skipped

### Abort Handling

- `Ctrl+C` signals graceful shutdown: in-flight workers complete their current turn, state is saved
- Double `Ctrl+C` forces immediate termination, state.log ensures recoverability
- `/forge abort` is the clean path: saves state, marks status as `aborted`
- After abort, `/forge resume` picks up from last saved state (iterative tasks resume from last iteration)

## Worker Context Injection

This is the most critical operational detail. Each worker receives a carefully assembled context window:

### Context Assembly Order

1. **System prompt**: Worker agent definition (`worker.md` or `worker-iterative.md`) with escalation protocol
2. **Plan excerpt**: The relevant section of `02-plan.md` referenced by the task (not the full plan)
3. **Task definition**: The specific task from `03-tasks.json` including acceptance criteria and measurable targets
4. **Codebase files**: Only the files listed in `context_manifest.codebase_files`
5. **Dependency outputs**: Outputs from predecessor tasks listed in `context_manifest.dependency_outputs`
6. **Previous attempt** (if retry): The prior attempt's output and error, so the model doesn't repeat the same mistake
7. **Iteration history** (iterative mode, turns 2+): Last N iterations from the log (not all — windowed to stay within budget), including test output and the worker's previous decisions

### Context Budget Enforcement

Before dispatching a task, the orchestrator estimates the token count of the assembled context. If it exceeds `contextBudgetPercent` of the resolved model's context window:

- **Option A**: Trim codebase files to relevant sections (using line ranges from the plan)
- **Option B**: Split the task into subtasks with smaller context requirements
- **Option C**: Try a model with a larger context window (e.g., `opencode-go/mimo-v2-pro` at 1M)
- **Option D**: Flag as a blocker — the task is too large for safe execution

For iterative tasks, the budget must also account for growing iteration history. The windowed approach (keeping only the last N iterations in context) prevents unbounded growth.

This prevents the failure mode where a worker gets a truncated context and produces nonsense.

## Dependency Resolution

### DAG Scheduling

```
TASK-001 (schema, single-pass)
  ├──► TASK-002 (auth module, single-pass)
  │      └──► TASK-004 (auth middleware, single-pass)
  └──► TASK-003 (user service, single-pass)
         ├──► TASK-004 (auth middleware, single-pass)  ← diamond dependency
         └──► TASK-005 (search optimization, iterative, 80 turns)
```

- Topological sort determines execution order
- Ready queue: tasks whose predecessors are all `completed`
- Diamond dependencies: TASK-004 enters the ready queue only when both TASK-002 and TASK-003 are `completed`
- Cycles are detected at plan validation time (Phase 3) and rejected
- Iterative tasks are annotated with their turn budget in status output so the user can see expected duration

### Dynamic DAG Modifications

If a blocker resolution adds new tasks or changes dependencies:

1. User provides the amendment via `/forge blocker <id> --resolve`
2. The orchestrator re-validates the DAG (no cycles, no orphans)
3. New tasks are appended to `03-tasks.json` (with Planner assigning task mode)
4. The ready queue is recomputed

## Comparison with Auto-Router

| Feature              | Auto-Router   | TaskForge                          |
| -------------------- | ------------- | ---------------------------------- |
| Scope                | Single prompt | Multi-phase workflow               |
| Model selection      | Per-prompt    | Per-role via tier system            |
| Agents               | None          | 4 specialized roles, 6 agent types |
| Coordination         | None          | Full orchestration with DAG        |
| State                | Route only    | Full workflow state with recovery  |
| Output               | Model switch  | Artifacts + code + reviews         |
| Feedback loops       | None          | Escalation + iterative mode        |
| Cost control         | None          | Estimate + budget limit + tiers    |
| Model fallback       | None          | Tier priority lists                |

## Implementation Order

1. ✅ Main extension structure and commands
2. ✅ State management and persistence
3. ✅ Phase orchestration framework
4. ✅ Agent definitions (strategist, planner)
5. ⬜ Model resolver with tier system and fallback logic
6. ⬜ State manager with atomic writes and log replay
7. ⬜ Agent definitions (single-pass worker, iterative worker, gate reviewer, integration reviewer)
8. ⬜ Context assembler (manifest-based context injection, budget enforcement)
9. ⬜ Worker pool with DAG-based scheduling (mode-aware)
10. ⬜ Iterative runner (compile/test harness, turn budget, measurable targets)
11. ⬜ Gate review loop (per-task validation)
12. ⬜ Escalation routing and blocker resolution
13. ⬜ Cost estimation and budget enforcement
14. ⬜ Error handling and retry logic (with error-in-context)
15. ⬜ Pause/resume with state reconstruction (iterative-aware)
16. ⬜ Configuration loading, validation, and `/forge models` command
17. ⬜ Output artifact generation

## Future Enhancements

- **Incremental updates**: Re-run on changed PRD sections (diff-based re-planning)
- **Multi-repo support**: Coordinate across repositories
- **CI/CD integration**: Trigger on PRD changes
- **Visual progress**: TUI widget showing DAG execution state with iteration counters
- **Custom phases**: User-defined workflow steps (e.g., "security audit" phase)
- **Adaptive tier routing**: Automatically promote a task to a higher tier if it fails gate review at the current tier
- **Codebase indexer**: Pre-compute a file-level summary so the Planner can write better context manifests without reading every file
- **Cost-per-model telemetry**: Track actual token usage per model to refine tier ordering over time
- **Collaborative iterative mode**: Two workers on the same task — one writes code, the other reviews each iteration (pair programming pattern)
