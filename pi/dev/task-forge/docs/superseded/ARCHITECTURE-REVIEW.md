# TaskForge TDD Architecture Review

This document reviews the TaskForge architecture with a new **Test Designer** role and incorporates the TDD-oriented observations raised during review.

It is intentionally split into:
- **target architecture**
- **current implementation gap notes**

This avoids documenting unimplemented behavior as if it already exists.

---

## Executive summary

The original TaskForge architecture is strong at:
- role-based orchestration
- inspectable artifacts
- approval gating
- dependency-aware execution
- blocker escalation
- model-tier routing

The main missing piece is a disciplined TDD layer that does **not** hallucinate internal APIs before code exists.

The safest architectural change is:
1. add a **Test Designer** role after planning
2. constrain that role to **grounded contract / acceptance / integration tests only**
3. keep **unit-level failing tests** inside the worker’s iterative loop once real implementation boundaries exist
4. add a **diagnostic escalation path** for disputes between requirement, implementation, and tests
5. make gate-review strength conditional on whether generated tests exist

---

## Revised target architecture

```text
Strategist
  -> 01-requirements.md

Planner
  -> 02-plan.md
  -> 03-tasks.json
  -> 03-tasks.md
  -> 03-cost-estimate.md

Test Designer
  -> 03-test-spec.json
  -> optional 03-test-spec.md

Approval Gate
  -> human review of plan + task graph + test spec

Execution
  -> worker / worker-iterative
  -> task outputs
  -> gate review

Diagnostic Escalation (when tests/requirements/implementation disagree)
  -> classify failure root cause
  -> requeue task, rewrite test spec, or raise blocker

Integration Review
  -> 04-review.md
```

---

## New role: Test Designer

### Purpose

The Test Designer produces **pre-implementation test contracts**.

### Placement

It belongs **after Planner** and **before Approval Gate**.

### Why this placement matters

At that point the system has:
- requirements
- architecture
- task decomposition
- explicit acceptance criteria
- expected external interfaces

But it does **not** have concrete internal implementations.

That means the Test Designer must not behave like a unit-test author for internal logic.

### Constraint: no hallucinated internals

The Test Designer may write only:
- contract tests
- acceptance tests
- integration tests
- structural smoke tests against explicit interfaces

It must not invent:
- internal function signatures
- private helper modules
- class structures not committed to in the plan
- speculative APIs

### Output

Recommended artifact:
- `03-test-spec.json`

Optional companion:
- `03-test-spec.md`

Recommended per-task structure:

```json
{
  "taskId": "TASK-003",
  "testFiles": [
    {
      "path": "tests/integration/test_auth_flow.py",
      "type": "integration",
      "targets": ["POST /auth/login", "POST /auth/refresh"],
      "fixtures_required": ["test_db", "mock_oauth_provider"],
      "derived_from": ["requirement.FR-004", "task.acceptance_criteria[1]"]
    }
  ],
  "acceptance_signal": "pytest tests/integration/test_auth_flow.py exits 0",
  "coverage_threshold": 80,
  "ambiguities": []
}
```

---

## Two-tier TDD model

The review observation is correct: forcing a pre-implementation agent to design unit tests against non-existent internals is a hallucination trap.

So the architecture should separate TDD into two tiers.

### Tier 1 — Pre-approval test design
Handled by **Test Designer**.

Produces only grounded tests:
- acceptance tests
- contract tests
- integration tests
- explicit test commands and coverage expectations

### Tier 2 — Per-task implementation-time TDD
Handled by **worker-iterative**.

The worker generates internal/unit-level failing tests only after it has enough concrete context to avoid inventing fake interfaces.

This preserves TDD discipline without transferring design authority to a context-starved pre-implementation agent.

---

## Iterative loop: explicit red-green-refactor

The current iterative worker model should be strengthened.

### Recommended loop

#### Iteration 0 — Red
- receive or write failing test
- run `test_command`
- confirm failure
- if it passes immediately, flag the test as suspicious or trivial

#### Iteration 1..N — Green
- implement minimum change required to pass
- re-run validation
- stop when green

#### Final iteration — Refactor
- improve structure without changing behavior
- re-run validation
- preserve green state

This can be enforced mostly through `worker-iterative.md` and task metadata.

---

## Diagnostic escalation role

A failing test does not always imply bad implementation.

There are three possible root causes:
1. implementation is wrong
2. test spec is wrong
3. requirement / planner assumption is wrong

The current worker → blocker → human flow is too coarse for this.

### Recommended addition

Add a **diagnostic escalation role** at the `coding` tier.

### Inputs
- failing test output
- implementation result
- original requirement
- relevant task definition
- relevant test spec entry

### Output
A structured classification:
- `implementation_error`
- `test_spec_error`
- `requirement_or_plan_error`

### Actions
- if implementation error: retry/requeue task
- if test spec error: rewrite test spec and requeue
- if requirement/plan error: raise blocker with combined context

This keeps the human from having to reconstruct the whole disagreement manually.

---

## Gate reviewer tier should be conditional

The review is also right that a cheap bulk-tier reviewer is not enough once generated tests become part of the quality contract.

### Recommended rule

Use:
- `bulk` tier gate review for scaffolding/config/lightweight tasks
- `coding` tier gate review for tasks with generated tests, coverage thresholds, or deeper behavioral verification

### Suggested discriminator

Promote gate review when the task includes any of:
- test spec entries
- `coverage_threshold`
- `task_mode = iterative`
- measurable targets beyond a binary pass/fail signal

This is a conditional tier upgrade, not a permanent role change.

---

## Coverage should be a first-class gate signal

If the system claims to support high test quality, coverage cannot stay implicit.

### Add to task/test metadata

Recommended field:

```json
"coverage_threshold": 80
```

This should be overridable per task.

### Gate behavior

The gate reviewer should parse coverage output from the task’s validation command and compare it against the threshold.

Without this, a task can pass with one shallow happy-path test.

---

## Complexity routing modes

The current full pipeline is good for medium and large work, but too expensive for tiny changes.

### Recommended orchestration modes

| Mode | Trigger | Shape |
|---|---|---|
| `micro` | <= 3 tasks, single component, low ambiguity | merged Strategist+Planner -> worker with inline test-first loop |
| `standard` | 4-12 tasks, bounded scope | full pipeline |
| `complex` | 13+ tasks, cross-cutting changes, ambiguous PRD | full pipeline + mandatory human checkpoints between phases |

This can be introduced as a small classifier phase before normal execution.

---

## Current model policy

The current TaskForge configuration is **OpenAI-first**, with Anthropic used as fallback.

### Tier intent

- `reasoning` favors broad synthesis and requirement interpretation
- `coding` favors code-oriented planning, debugging, and review
- `bulk` favors cheap frequent execution
- `endurance` favors long feedback-loop coherence

### Current preferred ordering

- `reasoning`
  - `openai-codex/gpt-5.4`
  - `openai-codex/gpt-5.1`
  - `opencode-go/glm-5.1`
  - `anthropic/claude-opus-4-5`

- `coding`
  - `openai-codex/gpt-5.3-codex`
  - `openai-codex/gpt-5.2-codex`
  - `openai-codex/gpt-5.4`
  - `opencode-go/glm-5.1`
  - `anthropic/claude-sonnet-4-5`

- `bulk`
  - `openai-codex/gpt-5.1-codex-mini`
  - `openai-codex/gpt-5.3-codex-spark`
  - `opencode-go/glm-5`
  - `opencode-go/kimi-k2.5`
  - `anthropic/claude-sonnet-4-5`

- `endurance`
  - `openai-codex/gpt-5.3-codex`
  - `openai-codex/gpt-5.2-codex`
  - `opencode-go/glm-5.1`
  - `anthropic/claude-sonnet-4-5`

This matches the current global TaskForge config and keeps Anthropic as fallback-only.

---

## Clarify `endurance`

`endurance` should not be explained as a web-specific compile loop tier.

It is better understood as:

> a model tier optimized for **feedback-loop coherence**

That applies to:
- compile/test/fix loops in web apps
- property-based test iteration in Python libraries
- benchmark loops in systems code
- data validation / sample replay loops in pipelines

This should be documented explicitly so the architecture reads as language-agnostic.

---

## Current implementation gaps

At the time of this review, the following are true:

### Already true
- role-based orchestration exists
- approval gate exists
- agent markdown files are runtime-loaded
- iterative worker loop exists
- gate review exists
- blocker handling exists
- tier-based model routing exists
- `scopeClassifier` routes work into `micro`, `standard`, or `complex`
- `micro` mode uses a compact planner path
- `complex` mode inserts a mandatory checkpoint after requirements
- `test-designer` is wired into the planning flow
- `03-test-spec.json` is generated before the approval gate
- test metadata is propagated into task context
- gate review is conditionally promoted to a stronger model tier for test-heavy tasks
- a `diagnosticReviewer` role is wired for persistent test-related failures
- validation output and framework-aware coverage extraction are available to gate/diagnostic review
- iterative tasks are tracked through orchestrator-level TDD phases: red -> green -> refactor -> complete

### Not yet implemented
- coverage threshold parsing is improved with framework-aware adapters, but not yet implemented as deep framework-specific integrations
- diagnostic handling currently focuses on per-task classification, not full cross-task repair planning
- complex mode currently inserts one hard checkpoint after requirements rather than a richer multi-checkpoint policy

So this review describes the **recommended next architecture**, not the exact current runtime.

---

## Recommended next implementation steps

1. Add deeper framework-specific validation adapters instead of regex-oriented parsing only
2. Expand diagnostic handling from per-task classification to broader repair planning
3. Add richer complex-mode checkpoint policy beyond the single post-requirements checkpoint
4. Add more explicit status/reporting for iterative TDD phase progress
5. Add optional task-level policy for when refactor can be skipped on trivial iterative tasks

---

## Bottom line

Adding a Test Designer improves TaskForge **only if** it is constrained to grounded, pre-implementation test contracts.

If it is allowed to invent internal unit-test targets before implementation exists, it will create exactly the kind of brittle hallucinated authority that TDD is supposed to prevent.

So the correct architectural move is:
- **pre-approval grounded test design** by Test Designer
- **implementation-time internal TDD** by iterative workers
- **diagnostic escalation** when tests, code, and requirements disagree
