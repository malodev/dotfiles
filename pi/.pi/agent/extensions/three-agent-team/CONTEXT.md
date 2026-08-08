# Domain model — three-agent-team

Ubiquitous language for the extension. Terms here are the ones code should be named after.
Runtime behaviour and the owner-facing contract live in [README.md](README.md).

## Completion

**Completion window** — the span between freezing the reviewed worktree and installing the
exact completion commit. Inside it, only the three named completion-evidence files may
change; any other path change blocks completion. The window is an atomicity guarantee, not
a phase of the workflow.

**Completion seal** — the module that owns the completion window: it freezes the reviewed
tree, runs verification, writes evidence, creates the exact commit, journals it, and
installs it under compare-and-swap. Named for what it guarantees — that once the tree is
frozen nothing unaccounted-for gets in. Two entry points: forward (`sealCompletion`) and
crash resume (`resumeSealedCompletion`).

**Completion evidence** — exactly `status.yaml`, `verification.log`, and
`completion-report.md` under the task directory. The only paths permitted to change inside
the completion window. `status.yaml` and `completion-report.md` are rendered by the caller
and handed to the seal as bytes; `verification.log` is produced incrementally on disk by
the success-test runner and is digested in place.

**Completion journal** — the three durable checkpoints the seal emits as it crosses the
window: VERIFIED, COMMITTING, COMPLETED. COMMITTING must be recorded between `commit-tree`
and `update-ref`, or crash recovery has nothing to reconcile against. Absent for immediate
`/team-go`; supplied by the dispatcher session for queued execution.

**Reviewed tree** — the tree object materialized from the worktree at the moment Reviewer
approves, plus a digest of the real Git index. The baseline the contamination check
compares against.

**Exact commit** — a single-parent commit built with `git commit-tree` from an explicit
path universe and installed with `git update-ref` compare-and-swap. Never `reset --hard`,
never an adopted arbitrary `HEAD`.

## Queue

**Barrier** — the earliest nonterminal FIFO entry; the only runnable entry. `RUNNING` and
`BLOCKED` entries are barriers for everything behind them. `barrier(snapshot)` (`queue.ts`)
is the one definition — every caller across `queue.ts`, `queue-dispatcher.ts`,
`session-state.ts`, and `index.ts` calls it rather than re-deriving it.

**Nonterminal** — not yet `COMPLETED` or `DEQUEUED` (`QUEUED`/`RUNNING`/`BLOCKED` all count).
The predicate `barrier()` searches for and every epoch transition retains. Distinct from
"not dequeued" (a looser, epoch-liveness-only check used in three places inside `queue.ts`
that still counts `COMPLETED` entries — kept private, never exported, since nothing outside
the module needs it).

**Epoch** — the span of queue history sharing one `expectedHead` lineage. A new epoch starts
whenever `expectedHead` advances outside normal task completion (a fresh enrollment after
all work finished, a queued-contract amendment, or a plan re-import) — always by retaining
only nonterminal entries, never by a bespoke retention rule per call site.

**Attempt** — one immutable dispatch of a queued entry, advancing CLAIMED → AUTHORIZING →
AUTHORIZED → EXECUTING → VERIFIED → COMMITTING → COMPLETED. Append-only; never reset,
reused, or silently retried.

**Reconciliation** — a replacement dispatcher session (holding a newer fencing token)
completing an attempt claimed under a prior one, after a crash. Deliberately bypasses the
current-fencing/owner match that a normal completion requires — that bypass is
reconciliation's entire reason to exist, not an oversight.

**Expected head** — the commit the queue requires `HEAD` to be at for the barrier to be
dispatchable. Advances only on completion.

**Enrollment** — approving a clean, committed draft for deferred execution. Approval, not
execution authorization: the task stays repository-local `DISCUSSING` until the fenced
dispatcher binds it to an exact `HEAD`.

**Queued contract amendment** — an atomic correction to the approved briefs of enrolled,
undispatched tasks. A single manifest (`team/amendment.yaml`) describes exact text edits;
approval (`/team-amend --approve`) applies them, re-validates every queued contract
(an edit can break a sibling), creates an exact single-parent commit, and advances the
queue to a new epoch with recomputed digests — as one journaled, crash-resumable
transaction. Replaying the same amendment id is idempotent. The companion skill is
`team-amend-contracts` (`skills/team-amend-contracts/SKILL.md`).

## Task

**Goal Contract** — the authorized `brief.md` plus its matching `status.yaml`, together
defining what the task must achieve and how success is verified.

**Authorization record** — the immutable extension-owned record, stored outside the
Builder-writable repository, that pins the authorization head and authorized-brief digest.
Queue metadata alone can never satisfy execution validation.

## Repository access

**Git adapter** — `git.ts` is the one place this extension spawns git. Arguments are always
argv, never a shell string, so pathspecs and refs cannot be reinterpreted by shell quoting.
Three entry points for the three shapes callers need: `git()` (raw result, never throws),
`gitText()` (trimmed stdout, throws with a label), `gitTextOrEmpty()` (`""` on failure, for
probes where absence is a valid answer). Output is `Buffer` at the core because blob
comparison and NUL-separated `-z` output need exact bytes.

**Task path** — two distinct forms, both derived from a task ID. `taskPath(repo, taskId)`
is the **absolute** filesystem directory. `relativeTaskPath(taskId, name)` is the
**repo-relative** string used for `status.yaml` field values, completion-evidence map keys,
and owner-facing messages — the form git and the evidence check both speak.

**Identity predicates** — `isTaskId`, `isSha1`, `isSha256` in `core.ts` are the single
definition of those shapes. Pattern *fragments* embedded inside larger regexes (marker
extraction, path matching in `index.ts`) necessarily still spell the character class out;
only standalone validation goes through the predicates.

## Session state

**Session state** — the extension's live bookkeeping for one loaded instance: which run is
active, which locks/leases are held outside a run, and which architect chat turn is in
progress. One instance per `threeAgentTeamExtension(pi)` call (`session-state.ts`,
`createSessionState`), mirroring the queue's `openDurableQueue` factory pattern. Not
persisted — rebuilt fresh on every extension load.

**Active run** — the single reserved Builder/Reviewer workflow execution. At most one at a
time; `reserveRun`/`releaseRun` enforce the mutex `activeRunDenial` already expressed.

**Recovery discussion** — the owner-led Architect conversation opened by `/team-unblock`,
diagnosing a `BLOCKED` task before any resume decision is made. Distinct from **recovery
finalization**: the discussion produces a `recovery-plan.md` with a disposition; finalization
(`finalizeRecovery`) acts on that disposition — RESUME (queued or immediate) or ESCALATE
(hands back to discussion for an owner decision). A recovery discussion and a pending
finalization can transiently both reference the same object (`promoteToRecovery`) until
finalization resolves it.

**Architect validation turn** — the automatic pre-go validate-and-repair loop started when
Architect finishes drafting a contract: validate, and on failure, ask Architect to correct
up to twice before failing closed (`settleArchitectValidation`).
