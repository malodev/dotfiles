# Workflow Reference

## Purpose

This initializer adapts the useful process layer from `russelleNVy/three-man-team` to Pi and local OpenAI-compatible models. It does not install or execute upstream Claude Code scripts.

The workflow has one task-level approval: owner and Architect agree on a validated Goal Contract, then the owner chooses immediate `/team-go <task-id>` or clean committed FIFO `/team-enqueue <task-id> [--after ...]`. The global extension executes Builder, Reviewer, and verification autonomously until the objective success tests pass or a genuine blocker requires changing the contract. Plain `go` has no authority, and queue metadata alone is never execution authorization.

## Roles

### Architect

- Runs interactively on the exact host-configured Architect model.
- Diagnoses current behavior and discusses goal, approach, constraints, and success tests.
- Records the Goal Contract and one `go` authorization.
- Orchestrates all subsequent iterations without routine owner interruption.
- Makes technical decisions inside the authorized contract.
- Performs final verification and applies only the agreed completion policy.
- Does not implement production code.

### Builder

- Runs as an isolated Pi child session using the exact host-configured Builder model and limits.
- Implements the authorized Goal Contract.
- Tests its work and writes a build report.
- Handles Reviewer findings autonomously.
- Never self-approves or exceeds the completion policy.

### Reviewer

- Runs as an isolated Pi child session using the exact host-configured Reviewer model and limits.
- Receives no direct `edit` or `write` tools; its `bash` non-mutation rule is prompt-enforced.
- Discovers the complete Git diff independently.
- Verifies tests and success criteria.
- Returns findings; Builder owns all fixes.

## State transitions

| Current | Event | Next |
|---|---|---|
| `DISCUSSING` | Owner says `go` to the Goal Contract | `EXECUTING` |
| `EXECUTING` | Builder report is complete | `REVIEWING` |
| `REVIEWING` | Reviewer requests in-contract changes | `EXECUTING` |
| `REVIEWING` | Reviewer approves | `VERIFYING` |
| `REVIEWING` | Resolution would change contract | `BLOCKED` |
| `VERIFYING` | Implementation-related check fails | `EXECUTING` |
| `VERIFYING` | Every success test passes | `COMPLETED` |
| `EXECUTING` or `VERIFYING` | Genuine external/contract blocker | `BLOCKED` |
| `BLOCKED` | Owner resolves blocker and reauthorizes | `EXECUTING` |

Any other transition is invalid and must stop.

### External durable queue states

Queue lifecycle is stored outside the repository; `QUEUED` and `RUNNING` are not `status.yaml` states.

| Current | Event | Next |
|---|---|---|
| `QUEUED` | Fenced FIFO claim | `RUNNING` |
| `QUEUED` | Owner dequeues an unclaimed entry with no dependents | `DEQUEUED` |
| `RUNNING` | Uncertain/error outcome | `BLOCKED` |
| `RUNNING` | Exact completion commit installed and verified | `COMPLETED` |
| `BLOCKED` | Matching owner recovery, process quiescence, and immutable authorization validation | `RUNNING` under a new attempt/fence |

Attempts are immutable and append-only:

```text
CLAIMED → AUTHORIZING → AUTHORIZED → EXECUTING → VERIFIED → COMMITTING → COMPLETED
```

Any nonterminal phase may end at `BLOCKED`. A blocked or running head is a queue-wide FIFO barrier. It is never skipped, reset to `QUEUED`, or retried from lease expiry alone. `/team-pause` prevents the next claim; `/team-continue` explicitly reconciles and drains until idle, paused, or blocked; `/team-dequeue` is forbidden after claim.

## The one task gate

Before execution, the owner sees a concise Goal Contract covering:

- goal and current behavior;
- agreed approach;
- objective success tests;
- non-goals and constraints;
- baseline commit;
- allowed repository operations;
- commit, push, and deployment policy.

For immediate work, the owner runs `/team-go <task-id>` once. For deferred work, the owner first commits every approved input into a completely clean repository, then runs `/team-enqueue <task-id>` and `/team-continue`. Enrollment freezes approval but leaves repository authorization `PENDING`; only the runnable fenced dispatcher may materialize the exact `/team-enqueue` authorization marker, status snapshot, and immutable external authorization record. After either path authorizes execution, the extension owns implementation, review, fixes, routine technical decisions, and final verification within the contract.

### Deterministic pre-go gate

A Goal Contract is not eligible for `go` merely because it reads plausibly. Before asking, Architect must:

1. use an existing baseline commit that remains an ancestor of `HEAD` and was not created by Builder;
2. remove project-command placeholders from `AGENTS.md`;
3. give every numbered success test an exact command, expected integer exit code, specific evidence, hardware/system-write declaration, and prerequisites;
4. make every writing test depend on an offline non-writing test;
5. resolve all open decisions and align completion policy with `status.yaml`;
6. run `git add -N .` so no untracked file is omitted from the baseline diff;
7. pass `python team/validate_goal_contract.py team/tasks/<task-id> --phase pre-go`.

At immediate `go`, or at runnable queued dispatch, the extension records the current exact `HEAD` as `authorization_head` plus a SHA-256 digest of the authorized brief in task metadata and in an extension-owned state record outside the Builder-writable repository. For tasks authorized by an older extension, an explicit owner `/team-resume` or finalized recovery performs a one-time migration and reports the exact adopted head and digest; partial snapshots fail closed. Before Builder, the extension passes the same validator with `--phase execution`; execution fails closed if `HEAD`, brief, status, external record, dispatcher fence, or repository capability drifts. Agents use the repository copy for immediate feedback, while extension runtime gates invoke the trusted bundled validator so Builder edits cannot weaken enforcement. Builder reruns it before mutation and before review; Reviewer reruns it independently. The validator enforces structure and repository visibility, but agents must still challenge semantically vague, disjunctive, or impossible criteria.

### Deferred queue admission

`/team-enqueue` additionally requires a full SHA-1 `HEAD`, no in-progress Git operation, no staged/unstaged/intent-to-add/untracked content, all task files regular and committed byte-for-byte at `HEAD`, no stale external authorization record, `commit_on_success: true`, and push/deploy false. Dependencies must name earlier non-dequeued entries. Queue and authorization state are passwd-home-rooted under owner-only `~/.local/state/pi-three-agent-team`; environment variables cannot redirect it. Administrative retries are idempotent only when every immutable enrollment input matches.

## Autonomous review gate

Reviewer checks the actual diff, not only Builder's report. Reviewer executes declared verification commands and records evidence. Findings inside the Goal Contract return directly to Builder without owner approval.

## Completion policy

The Goal Contract decides these before execution:

```yaml
commit_on_success: false
push_on_success: false
deploy_on_success: false
```

A `true` value is explicit advance authorization for that action after all success tests pass. A `false` value means leave the work ready and do not interrupt to ask again during the run. Authorization for one action does not imply another. Queued tasks require commit true and push/deploy false so each successful FIFO entry advances the exact expected-head chain.

### Exact reviewed-tree completion

Reviewer approval freezes the complete worktree through an isolated temporary index and explicit path list. After that point, only `status.yaml`, `verification.log`, and `completion-report.md` under the active task may change. The extension rejects all other post-review contamination, creates the exact single-parent commit with `git commit-tree`, journals tree/parent/subject/commit, installs it with `git update-ref` compare-and-swap, normalizes only the index, and verifies a clean worktree. It never uses `git reset --hard`, never broadly stages arbitrary late changes, and never adopts arbitrary `HEAD`.

## Genuine blockers

Interrupt the owner only when:

- required behavior, non-goals, architecture, or execution authority must change;
- credentials or an external decision are unavailable;
- a relevant baseline failure prevents trustworthy verification;
- an unauthorized destructive or irreversible action is required;
- five review cycles fail to achieve approval.

Ask one focused question with evidence, options, and a recommendation.

## Review loop limit

Allow at most five review cycles by default. At the limit, report:

- unresolved findings;
- attempts and verification evidence;
- suspected root cause;
- whether the Goal Contract must change;
- recommendation to continue, redesign, or abandon.

This is a safety ceiling, not a routine approval point.

## Single-GPU scheduling

The configured large role models may not remain loaded together with useful runtime headroom on a single 32 GiB R9700. The extension enters the configured inference mode, invokes one exact-model child session at a time, snapshots role choices per authorized task, and never uses delegated or parallel routing. The durable dispatcher lease/fence coordinates FIFO repository ownership; the independent host-global inference lease is acquired only immediately before Builder/Reviewer work and released before dispatcher ownership ends. Both renew independently, and loss of either aborts the recorded process group and blocks the attempt.

## Durable versus task-local knowledge

- `AGENTS.md`: short commands, rules, and invariants loaded every turn.
- `CONTEXT.md`: domain language and architecture.
- `docs/adr/`: durable decisions and their rationale.
- `team/tasks/<task-id>/`: Goal Contract, reports, and state for one unit of work.

Do not copy conversation transcripts into `AGENTS.md`.

## Upstream attribution

Concept adapted from Three Man Team, MIT licensed:

- Repository: https://github.com/russelleNVy/three-man-team
- Assessed commit: fd9ab86c001e32fd3dce161e961110b3eeb00eb8
