# Queue Implementation Report

## Status

The transactional three-agent FIFO queue is implemented in this worktree. It is not deployed or committed. Production `/team-continue` now performs fenced deferred authorization, sequential exact-model Builder/Reviewer execution, verification, exact-tree completion, and FIFO draining until idle, paused, or blocked.

The executor-less dispatcher option remains only as a fail-closed test/diagnostic seam and blocks before model execution.

## Safety properties implemented

- Passwd-home-rooted external state keyed by canonical repository identity; environment redirects are ignored.
- Owner/mode/symlink validation, real process-wide `flock`, fsynced atomic persistence, revision CAS, immutable enrollment, idempotent commands, FIFO barriers, renewable dispatcher leases, and monotonic fencing tokens.
- Strict clean committed enrollment and dispatch-time HEAD/brief/status/digest revalidation while holding the repository execution lock.
- Recoverable deferred authorization with exact pre/postimages and immutable external authorization evidence.
- Stop-before-exec role launcher: child PID/process-start identity is journaled before the executable receives `SIGCONT`.
- Dispatcher/repository/inference lease loss aborts the workflow process group and prevents later repository writes through the stale capability.
- Reviewer-approved tree freeze through an isolated temporary index and explicit path universe.
- Post-review allowlist limited to `status.yaml`, `verification.log`, and `completion-report.md` for the active task.
- Exact `commit-tree` journal containing tree, parent, subject, and commit SHA; `update-ref` compare-and-swap installation; index-only normalization; final clean-tree verification.
- No `git reset --hard`, no queued `git add -A`, no arbitrary current-HEAD adoption, and no unrelated late path inclusion.
- Conservative stale-`RUNNING` reconciliation to `BLOCKED`, never `QUEUED`; an exact `COMMITTING` journal may deterministically roll forward only when HEAD/tree/parent/subject/commit/worktree all match.
- Owner recovery bound to queue revision, failed attempt, and enrollment owner; recorded processes must be positively quiescent; immutable authorization is revalidated; recovery appends a larger-fenced attempt.
- Immediate workflows use the same authorization-head-parented exact completion path.
- `/team-continue` retains its live Pi command context rather than dispatching against stale context. Session shutdown releases recovery locks; replacement sessions reacquire and revalidate.
- Interactive authorization guards are reconstructed from durable repository evidence after restart.

## Public commands

- `/team-enqueue <task-id> [--after <earlier-id>[,<earlier-id>...]]`
- `/team-queue`
- `/team-pause`
- `/team-continue`
- `/team-dequeue <task-id>`
- Existing `/team-go`, `/team-resume`, `/team-unblock`, `/team-discard`, status/report, and interactive lifecycle commands remain available subject to queue and repository-lock admission.

## Durable transitions

```text
Queue:   QUEUED -> RUNNING -> COMPLETED
                    |
                    +-> BLOCKED -> RUNNING under matching owner recovery
         QUEUED -> DEQUEUED

Attempt: CLAIMED -> AUTHORIZING -> AUTHORIZED -> EXECUTING
         -> VERIFIED -> COMMITTING -> COMPLETED
         any nonterminal phase -> BLOCKED
```

A running or blocked FIFO head is a queue-wide barrier. Attempts are append-only and never silently requeued.

## Verification

The aggregate command is:

```bash
npm run test:three-agent-team
```

Type checking is:

```bash
npx tsc --noEmit --skipLibCheck --allowImportingTsExtensions \
  --module nodenext --moduleResolution nodenext --target es2023 --types node \
  pi/.pi/agent/extensions/three-agent-team/*.ts \
  pi/.pi/agent/extensions/three-agent-team/test/*.ts
```

Final counts and review verdict should be recorded only after the final aggregate and independent code review run.

As of the latest implementation: 139 tests pass (29 core, 32 queue, 29 manifest, 9 preview, 7 apply, 10 strictness, 4 crash recovery, 2 crash matrix, 7 SIGKILL matrix, 11 handler). The queue includes a `bulkImportEnqueue` command with full preimage verification and atomic postimage assertion. Clean-install smoke and SIGKILL crash matrix automation pass.

## Operational note

No live `$HOME/.pi` files or passwd-rooted queue state were modified while implementing or testing this worktree. Deployment and commit remain separate owner-approved actions.
