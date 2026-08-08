# PRD — Three-Agent Team Extension

## Elevator pitch

Give AI agents a harness to autonomously complete a batch of development tasks
from a plan and an optional PRD, without human intervention after the initial
specification phase. The owner specifies, reviews, and approves; the agents
build, verify, and complete.

## Core requirements

### R1 — Hands-free long-horizon execution

The system must accept a plan (and optionally a PRD) as input and produce
completed, committed, verified work as output. After the owner approves the
task contracts, the agents must proceed through the full batch without further
human involvement — running until the queue is empty, paused, or blocked.

### R2 — Specification phase with human-in-the-loop

Human involvement is concentrated before execution begins:

- Architect decomposes the plan into discrete task contracts with executable
  success tests
- Owner may grill the Architect to stress-test contracts
- Owner reviews and explicitly approves each contract or the full manifest

No human should be required to edit task files, run git commands, or intervene
during execution — approval is the only required human action.

### R3 — Three-role workflow

The system must run a configurable three-role pipeline per task:

- **Architect** — discusses goals, drafts contracts, validates, decomposes
  plans
- **Builder** — implements the contract in a sandboxed environment
- **Reviewer** — reviews the implementation against the contract, requests
  changes or approves

Roles must be configurable (model, provider, limits) without changing extension
source code.

### R4 — Durable FIFO queue

Tasks must be enrollable in a crash-resumable durable queue:

- FIFO ordering with explicit dependencies
- Immutable append-only attempt history
- Barrier semantics: only the earliest nonterminal entry runs; RUNNING and
  BLOCKED entries block everything behind them
- Pause without interrupting the running task
- Tombstone dequeuing of never-dispatched entries
- Recovery of BLOCKED tasks through owner-led discussion

### R5 — Crash resilience

Every state transition must survive process death:

- Journaled transactions (PREPARED → GIT_INSTALLED → COMPLETED)
- Replaying an idempotent journal entry resumes, never restarts
- Fencing tokens prevent stale dispatchers from acting after takeover
- Ambiguous state after a crash becomes BLOCKED, never silently retried
- External authorization records stored outside the Builder-writable repository
  prevent tampering

### R6 — Exact commits

The extension must never adopt an arbitrary HEAD:

- Every commit built with `git commit-tree` from an explicit path universe
- Installed with `git update-ref` compare-and-swap
- Never `git reset --hard`
- Completion window: only three named evidence files may change after review
  approval

### R7 — Validated contracts

Every task contract must pass a deterministic validator before execution:

- Success tests must be real executable commands, not placeholders
- Commands must appear identically in both the ST block and Verification
  commands list
- Open decisions must be NONE
- The validator is bundled with the extension, never read from the
  Builder-writable repository

### R8 — Sandboxed execution

Builder must run in an isolated environment:

- Bubblewrap with synthetic /dev, hidden DBus, read-only host filesystem
- Only the repository and /tmp writable
- Builder gets edit/write tools; Reviewer does not
- Dedicated npm/UV/XDG caches under /tmp

### R9 — Queued contract amendment

Correcting a mistake in enrolled but undispatched contracts must be possible
without dequeuing and re-importing:

- Atomic edits described in a strict YAML manifest
- Every edit matches exactly once; ambiguous matches are refused
- Re-validates all queued contracts, not just the amended ones
- Creates a single exact commit and advances the queue epoch
- Journaled and idempotent (same amendment ID replays, not restarts)

### R10 — Plan decomposition

A plan file must be decomposable into a strict YAML task manifest:

- Each task is a bounded, atomic unit of work
- Dependencies between tasks are explicit
- Tasks are ordered so dependencies appear before dependents
- Manifest is imported as one journaled transaction: render, validate, commit,
  enroll

## Anti-requirements

What this extension deliberately does not do:

- **No automatic approval.** The owner must explicitly approve contracts and
  manifests. The extension refuses to execute unauthorized work.
- **No push or deploy.** V1 scope is local commits only. `push_on_success`
  and `deploy_on_success` are refused.
- **No concurrent task execution.** One Builder/Reviewer cycle at a time. The
  queue is strictly sequential.
- **No arbitrary git operations.** The extension only creates exact commits;
  it never rebases, merges, or force-pushes.
- **No human intervention mid-execution.** If a task blocks, it stays blocked
  until the owner explicitly unblocks it — the extension does not prompt or
  interrupt.

## Out of scope (V1)

- Parallel task execution
- Push-to-remote and deployment
- Dynamic task insertion into a running queue
- User-facing web dashboard
- Slack/email notifications
- Multi-repository tasks
