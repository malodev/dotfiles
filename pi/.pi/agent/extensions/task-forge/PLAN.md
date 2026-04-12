# TaskForge — Hierarchical Multi-Agent Orchestration Plan

## Overview

TaskForge is a pi extension that orchestrates multiple specialized AI agents to transform Product Requirement Documents (PRDs) into working implementations. Unlike the auto-router (which selects models per prompt), TaskForge manages a complete workflow with agents that report back to a coordinator until the plan is executed.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER                                           │
│                         /forge prd.md                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TASKFORGE EXTENSION                               │
│                         (Orchestrator / Coordinator)                        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        PHASE MANAGER                                │    │
│  │   Controls workflow: Analyze → Plan → Decompose → Execute → Review  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│    STRATEGIST     │   │    ARCHITECT      │   │    COORDINATOR    │
│                   │   │                   │   │                   │
│  Model: Opus      │   │  Model: Sonnet    │   │  Model: Sonnet    │
│  Tools: read-only │   │  Tools: read-only │   │  Tools: read-only │
│                   │   │                   │   │                   │
│  Analyzes PRD:    │   │  Creates Plan:    │   │  Decomposes:      │
│  • Objectives     │   │  • Architecture   │   │  • Task list      │
│  • Requirements   │   │  • Components     │   │  • Dependencies   │
│  • Constraints    │   │  • Data models    │   │  • Assignments    │
│  • Risks          │   │  • API design     │   │                   │
└───────────────────┘   └───────────────────┘   └───────────────────┘
                                                        │
                                                        ▼
                              ┌─────────────────────────────────────────┐
                              │            WORKER POOL                  │
                              │                                         │
                              │  ┌─────────┐ ┌─────────┐ ┌─────────┐    │
                              │  │Worker 1 │ │Worker 2 │ │Worker 3 │    │
                              │  │Sonnet   │ │Sonnet   │ │Sonnet   │    │
                              │  └─────────┘ └─────────┘ └─────────┘    │
                              │       │           │           │         │
                              │       └───────────┼───────────┘         │
                              │                   │                     │
                              │                   ▼                     │
                              │           ┌─────────────┐               │
                              │           │  REVIEWER   │               │
                              │           │  Sonnet     │               │
                              │           └─────────────┘               │
                              └─────────────────────────────────────────┘
```

## Workflow Phases

### Phase 1: PRD Analysis (Strategist - Opus)

**Input**: PRD file  
**Output**: `01-requirements.md`

The Strategist analyzes the PRD and extracts:

- Executive summary
- Core objectives (SMART goals)
- User personas and stories
- Functional requirements
- Non-functional requirements
- Constraints and assumptions
- Success metrics (KPIs)
- Risks and dependencies

**Why Opus**: Deep understanding, nuanced analysis, catches ambiguities that cheaper models miss.

---

### Phase 2: Implementation Planning (Architect - Sonnet)

**Input**: Requirements analysis  
**Output**: `02-implementation-plan.md`

The Architect creates a detailed plan:

- Architecture overview and patterns
- Component breakdown with responsibilities
- Data models and schemas
- API design (endpoints, contracts)
- Implementation sequence with phases
- Testing strategy
- Deployment approach

**Why Sonnet**: Strong technical depth, good at structured planning, cost-effective for this phase.

---

### Phase 3: Task Decomposition (Coordinator - Sonnet)

**Input**: Implementation plan  
**Output**: `03-tasks.json`, `03-tasks.md`

The Coordinator breaks the plan into discrete tasks:

- Each task: 2-4 hours of work
- Clear dependencies between tasks
- Complexity ratings (Simple/Medium/Complex)
- Expected files to create/modify
- Acceptance criteria for each task

**Why Sonnet**: Organized thinking, good at structured decomposition.

---

### Phase 4: Task Execution (Workers - Sonnet, Parallel)

**Input**: Individual tasks with context  
**Output**: `tasks/TASK-001.md`, `tasks/TASK-002.md`, ...

Workers execute tasks in parallel (respecting dependencies):

- Read existing codebase context
- Implement the specific task
- Write clean, documented code
- Create/update tests
- Report results back to Coordinator

**Why Sonnet**: Good coding ability, cost-effective for parallel execution.

**Parallelism**: Up to `maxWorkers` (default: 4) concurrent workers.

---

### Phase 5: Code Review (Reviewer - Sonnet)

**Input**: All completed task outputs  
**Output**: `04-review.md`

The Reviewer validates the implementation:

- Correctness against requirements
- Code quality and maintainability
- Security concerns
- Performance issues
- Testing coverage
- Documentation completeness

**Why Sonnet**: Attention to detail, good at catching issues.

---

## File Structure

```
.task-forge/                    # Output directory (configurable)
├── 01-requirements.md          # Strategist output
├── 02-implementation-plan.md   # Architect output
├── 03-tasks.json               # Machine-readable task list
├── 03-tasks.md                 # Human-readable task list
├── 04-review.md                # Reviewer output
└── tasks/                      # Individual task outputs
    ├── TASK-001.md
    ├── TASK-002.md
    └── ...
```

## Extension Components

### 1. Main Extension (`index.ts`)

- Command registration (`/forge`)
- State management (persisted via `pi.appendEntry`)
- Phase orchestration
- Worker pool management
- Error handling and recovery

### 2. Agent Definitions (`agents/`)

- `strategist.md` - PRD analysis agent
- `architect.md` - Planning agent
- `coordinator.md` - Task decomposition agent
- `worker.md` - Implementation agent
- `reviewer.md` - Code review agent

### 3. Configuration (`.pi/task-forge.json`)

```json
{
  "models": {
    "strategist": "anthropic/claude-opus-4-5",
    "architect": "anthropic/claude-sonnet-4-5",
    "coordinator": "anthropic/claude-sonnet-4-5",
    "worker": "anthropic/claude-sonnet-4-5",
    "reviewer": "anthropic/claude-sonnet-4-5"
  },
  "maxWorkers": 4,
  "maxRetries": 2,
  "outputDir": ".task-forge",
  "autoReview": true
}
```

## Commands

| Command             | Description                      |
| ------------------- | -------------------------------- |
| `/forge <prd-file>` | Start orchestration from PRD     |
| `/forge status`     | Show current status and progress |
| `/forge pause`      | Pause running workers            |
| `/forge resume`     | Resume paused orchestration      |
| `/forge abort`      | Abort orchestration              |
| `/forge config`     | Show current configuration       |
| `/forge help`       | Show help                        |

## State Management

State is persisted via `pi.appendEntry()` and includes:

- Orchestration ID and status
- Current phase
- Task list with statuses
- Timestamps

State survives session restarts and can be inspected via `/forge status`.

## Error Handling

### Task Failures

- Workers retry up to `maxRetries` times
- Failed tasks block dependent tasks
- Coordinator reports blocked tasks

### Phase Failures

- If a phase fails, orchestration stops
- Partial results are saved
- User can inspect outputs and fix issues

### Abort Handling

- Ctrl+C propagates to kill workers
- State is saved on abort
- Can resume or restart

## Model Selection Strategy

| Role        | Model  | Why                                  |
| ----------- | ------ | ------------------------------------ |
| Strategist  | Opus   | Deep analysis, catches nuances       |
| Architect   | Sonnet | Technical depth, structured thinking |
| Coordinator | Sonnet | Organization, decomposition          |
| Worker      | Sonnet | Coding ability, cost-effective       |
| Reviewer    | Sonnet | Attention to detail                  |

Users can override any model in `.pi/task-forge.json`.

## Comparison with Auto-Router

| Feature         | Auto-Router   | TaskForge            |
| --------------- | ------------- | -------------------- |
| Scope           | Single prompt | Multi-phase workflow |
| Model selection | Per-prompt    | Per-role             |
| Agents          | None          | 5 specialized agents |
| Coordination    | None          | Full orchestration   |
| State           | Route only    | Full workflow state  |
| Output          | Model switch  | Artifacts + code     |

## Implementation Order

1. ✅ Main extension structure and commands
2. ✅ State management and persistence
3. ✅ Phase orchestration framework
4. ✅ Agent definitions (strategist, architect, coordinator)
5. ⬜ Agent definitions (worker, reviewer)
6. ⬜ Worker pool with parallel execution
7. ⬜ Dependency resolution and task scheduling
8. ⬜ Error handling and retry logic
9. ⬜ Pause/resume functionality
10. ⬜ Configuration loading
11. ⬜ Output artifact generation

## Future Enhancements

- **Interactive mode**: User approves plan before execution
- **Incremental updates**: Re-run on changed PRD sections
- **Multi-repo support**: Coordinate across repositories
- **CI/CD integration**: Trigger on PRD changes
- **Cost tracking**: Report token usage per phase
- **Visual progress**: TUI widget showing workflow state
- **Custom phases**: User-defined workflow steps
