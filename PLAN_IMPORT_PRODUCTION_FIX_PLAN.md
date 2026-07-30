# Plan Import Production Fix Plan

## Status

This plan supersedes the incomplete plan-import implementation currently present in the `feat/three-agent-transactional-queue` worktree.

The current implementation is **not ready for production**. It must not be deployed or described as production-ready until every phase, acceptance criterion, final gate, and independent review in this document passes.

## Operating-model clarification

Architect, Builder, and Reviewer execute strictly sequentially. There is no simultaneous multi-agent repository editing.

This lowers the urgency of concurrency-specific CAS failures, but does not remove the need for CAS and idempotency:

- `bulkEnqueue` replay is primarily an idempotency and recovery concern, not an agent-concurrency concern.
- `git update-ref <new> <expected-old>` protects against stale state caused by another Pi process, manual Git activity, command retries, and crash recovery.
- CAS defects are therefore not the primary production blockers under the current operating model.

The highest-risk defects occur in one sequential process:

1. `/team-import --approve` deadlocks against its own repository lock after installing the commit.
2. A crash between Git installation and queue enrollment can leave partial durable state.
3. Generated contracts fail the trusted Goal Contract validator.
4. No real recovery implementation exists for partial imports.

## Why the previous implementation failed

The previous design plan was substantially correct, but the implementation did not follow it. Completion was incorrectly inferred from compilation and green tests that did not exercise the mutating production path.

| Required behavior | Current implementation |
|---|---|
| Run the trusted validator for every rendered contract | `plan-import.ts` explicitly skips it and relies on manifest parsing “for now” |
| Render complete valid Goal Contracts | Renderer contains `PLACEHOLDER` and omits required fields |
| Use an isolated index and expected-parent `update-ref` CAS | Uses the real index, shell-interpolated `git add`, and unconditional `update-ref` |
| Journal `PREPARED → TREE_INSTALLED → GIT_INSTALLED → QUEUE_ENROLLED → COMPLETED` | `TREE_INSTALLED` is absent |
| Reconcile interrupted transactions | `recoverImportJournal()` only reads JSON |
| Fence mutations while an import is incomplete | Mutating commands do not inspect import journals |
| Record the real owner principal | Handler contains `ownerPrincipal: "test-user"` |
| Test the registered production command | Tests call only `previewPlanImport()` |
| Hard-crash-test every transaction phase | No apply-path crash tests exist |

The replacement implementation must begin with failing production-path tests and must reuse canonical Goal Contract, Git, durability, and queue mechanisms rather than duplicating them.

---

# Phase 1 — Establish failing acceptance tests first

## Files

- `pi/.pi/agent/extensions/three-agent-team/plan-import.test.ts`
- `pi/.pi/agent/extensions/three-agent-team/plan-manifest.test.ts`
- `pi/.pi/agent/extensions/three-agent-team/queue.test.ts`
- `pi/.pi/agent/extensions/three-agent-team/test/plan-import-worker.ts`
- A command-registration test harness that invokes the actual registered `/team-import` handler

## Add red tests for

1. Registered `/team-import` preview performs no repository or external-state writes.
2. Registered approval completes without lock timeout.
3. Every generated contract passes the bundled pre-go validator.
4. Successful import creates exactly one commit and one queue entry per task.
5. Existing task-directory collision causes zero mutation.
6. Symlinked task paths and parents cause zero external writes.
7. Manifest changes after preview are rejected.
8. `HEAD` changes after preview are rejected.
9. Crash after every journal phase resumes deterministically.
10. Exact command replay is a no-op.
11. Conflicting replay becomes durably `BLOCKED`.
12. Bulk replay remains idempotent after queue-head advancement.
13. Incomplete import prevents other mutating team commands.

## Exit criterion

The tests fail for the expected current defects, not because of fixture or harness problems.

---

# Phase 2 — Make the YAML manifest genuinely strict

## File

- `pi/.pi/agent/extensions/three-agent-team/plan-manifest.ts`

## Changes

1. Parse with YAML aliases disabled (`maxAliasCount: 0`).
2. Reject anchors, aliases, merge keys, and custom tags.
3. Reject unknown root fields; permit only `version`, `sources`, and `tasks`.
4. Require the manifest path to be exactly `team/plan.yaml`.
5. Require source paths to be normalized repository-relative paths.
6. Require source files to be regular, non-symlink, tracked files at the previewed `HEAD`.
7. Verify declared SHA-256 values against source bytes committed at that `HEAD`.
8. Require success-test IDs matching `ST-\d{2,}`.
9. Add a required success-test `title` for `### ST-NN: title` rendering.
10. Reject duplicate prerequisites.
11. Reject self-prerequisites.
12. Detect success-test prerequisite cycles.
13. Require non-empty non-goals, relevant files, and architectural constraints.
14. Add the missing execution-authority fields required by the trusted validator:
    - Non-destructive development commands
    - Routine technical decisions inside the contract
15. Continue rejecting unknown fields at every nested level, duplicate YAML keys, null task entries, invalid task IDs, unknown dependencies, task dependency cycles, and dependencies that appear after their dependents.

## Exit criterion

Malformed YAML, stale source evidence, and malformed task/test graphs are rejected before journal creation or repository mutation.

---

# Phase 3 — Centralize canonical Goal Contract rendering

## New module

- `pi/.pi/agent/extensions/three-agent-team/goal-contract.ts`

## Interface

```ts
renderDraftContract(task, baselineCommit): {
  brief: string;
  status: string;
}

buildEnrollmentSnapshot(renderedContract, approvedAt): {
  approvedBriefDigest: string;
  authorizedBrief: string;
  contractDigest: string;
}
```

## Changes

1. Move canonical Goal Contract formatting out of `index.ts`.
2. Use the same renderer for `/team-new` and plan imports.
3. Render:
   - The real baseline commit
   - `### ST-NN: title`
   - Backticked structured success-test fields
   - `Prerequisites: \`none\`` when empty
   - Every required execution-authority field
   - The exact completion policy
   - Exactly one `PENDING` authorization marker
4. Compute `approvedBriefDigest` from the pending `brief.md`.
5. Compute `contractDigest` from the exact future authorized `brief.md`, never from `status.yaml`.
6. Validate all rendered contracts in a private temporary Git fixture before changing the live worktree.
7. After exact commit installation, run `inspectEnrollmentAdmission()` for every task and use its returned bytes and digests as the enrollment authority.
8. Ensure rendering and enrollment use one stable approval timestamp stored in the journal.

## Exit criterion

Every imported contract passes the existing trusted Python pre-go validator without exceptions or import-specific behavior.

---

# Phase 4 — Replace the journal with a durable repository-keyed transaction log

## File

- `pi/.pi/agent/extensions/three-agent-team/import-journal.ts`

## State machine

```text
PREPARED
  → TREE_INSTALLED
  → GIT_INSTALLED
  → QUEUE_ENROLLED
  → COMPLETED

Any conflict → BLOCKED
```

## Journal contents

- Schema version
- Canonical repository path, repository key, and UID
- Journal ID and owner principal
- Canonical manifest path and approved digest
- Initial `HEAD`
- Initial queue revision and expected head
- Stable approval timestamp
- Exact task paths and dependency lists
- Rendered artifact paths and digests
- Approved and authorized contract digests
- Tree SHA
- Commit SHA, parent, and subject
- Exact immutable queue enrollment tuples
- Current phase
- Created/updated timestamps
- Blocking reason when phase is `BLOCKED`

## Durability and safety requirements

1. Store journals below the passwd-rooted, repository-keyed external-state directory.
2. Permit at most one incomplete import per repository.
3. Reject symlinks, wrong ownership, and unsafe directory/file modes.
4. Strictly validate every field on every journal read.
5. Persist rendered artifacts externally so recovery does not depend on a later renderer version.
6. Fsync artifact/journal files, atomically rename them, then fsync their directories.
7. Permit only legal forward phase transitions.
8. Make exact phase replay idempotent.
9. Retain completed and blocked journals for audit; do not silently delete evidence.
10. Reject journal IDs and artifact paths that contain traversal or escape their repository-keyed state directory.

## Exit criterion

A journal is either fully valid and recovery-authoritative or rejected before it can guide any side effect.

---

# Phase 5 — Build the exact commit without touching the real index

## Files

- `pi/.pi/agent/extensions/three-agent-team/queue-repository.ts`
- `pi/.pi/agent/extensions/three-agent-team/plan-import.ts`

## Changes

1. Remove the plan importer’s shell-string Git helper.
2. Use argument-array subprocess calls exclusively.
3. Reject every task collision before writing anything.
4. Reject symlinked task directories and parent paths.
5. Render files into a private staging directory.
6. Create an isolated `GIT_INDEX_FILE`.
7. Run the exact plumbing sequence:
   - `git read-tree <initial-head>`
   - `git add --pathspec-from-file=- --pathspec-file-nul`
   - `git write-tree`
   - `git commit-tree`
8. Journal the exact tree, parent, subject, and commit SHA as `TREE_INSTALLED` while `HEAD` is unchanged.
9. Materialize only the approved task bytes into verified canonical live paths.
10. Install the commit with:

```bash
git update-ref HEAD <commit> <initial-head>
```

11. Normalize only the real index; never use `git reset --hard`.
12. Verify the live repository is clean and exactly matches the journaled tree.
13. Reuse or generalize the existing exact-commit implementation in `queue-repository.ts`; do not maintain a second weaker implementation.

## Exit criterion

The importer never invokes shell-interpolated Git, never uses the real index to build the commit, and never overwrites an unexpected `HEAD`.

---

# Phase 6 — Implement deterministic recovery and logical atomicity

## Deep module interface

```ts
const importer = await openPlanImporter(repo, options);

await importer.preview("team/plan.yaml");

await importer.apply({
  manifestPath: "team/plan.yaml",
  approvedDigest,
  ownerPrincipal,
}, heldCapability);
```

The command handler acquires the repository execution lock exactly once. `apply()` consumes that held capability and must never reacquire the same lock.

## Recovery rules

1. Before starting a new import, inspect the active repository journal.
2. The same manifest, owner, and digest resume the existing transaction.
3. Different inputs fail closed without creating a second journal.
4. Recovery by phase:
   - `PREPARED`: verify durable artifacts and create the exact tree/commit.
   - `TREE_INSTALLED`: verify the commit object, materialize exact files, and install the commit.
   - `GIT_INSTALLED`: verify exact `HEAD`, tree, worktree, task admissions, and queue preconditions; then enqueue.
   - `QUEUE_ENROLLED`: verify every immutable queue entry; then mark completed.
   - `COMPLETED`: return the original result unchanged.
   - `BLOCKED`: report the persisted reason and perform no automatic mutation.
5. If a crash occurs after a side effect but before its phase update, recovery may roll forward only when the observed state exactly equals the journaled postimage.
6. Never adopt arbitrary `HEAD`, task bytes, commit objects, or queue entries.
7. Never generate a fresh approval timestamp, commit, or journal during exact replay.
8. Any mismatch transitions the journal durably to `BLOCKED`.
9. Never claim physical atomicity across Git and external queue state; provide journaled logical atomicity through exact roll-forward or durable blocking.

## Exit criterion

Killing the process after every phase results in exact roll-forward or durable `BLOCKED`, never orphaned, silently replaced, or implicitly authorized tasks.

---

# Phase 7 — Correct queue replay and fence unrelated mutations

## Files

- `pi/.pi/agent/extensions/three-agent-team/queue.ts`
- Central team command admission code

## Changes

1. For `bulkEnqueue`, compare every existing immutable entry before checking queue `expectedHead` or revision.
2. If every entry already exists and exactly matches, return an idempotent no-op before head and revision checks.
3. Apply queue-head and expected-revision CAS only when the command will write at least one new entry.
4. Pass the actual previewed queue revision from the importer; never pass `undefined` for an effective import write.
5. Add a central `assertNoIncompleteImport(repo)` guard to mutating commands:
   - `/team-new`
   - `/team-go`
   - `/team-enqueue`
   - `/team-dequeue`
   - `/team-pause`
   - `/team-continue`
   - `/team-unblock`
   - `/team-discard`
   - `/team-import`
6. Permit read-only queue/status/report and import-preview commands.
7. Permit the exact matching `/team-import --approve` invocation to resume its own journal.
8. Refuse import while a live dispatcher or active task owns execution; sequential role execution remains unchanged.

## Exit criterion

Exact replays remain no-ops after queue-head advancement, and unrelated mutations cannot cross an incomplete import transaction.

---

# Phase 8 — Correct the native command adapter

## Files

- `pi/.pi/agent/extensions/three-agent-team/index.ts`
- Optionally `pi/.pi/agent/extensions/three-agent-team/team-import-command.ts` as the Pi command adapter
- `pi/.pi/agent/extensions/three-agent-team/core.ts` for strict argument parsing

## Changes

1. Add a strict `/team-import` argument parser.
2. Reject empty, extra, reordered, duplicate, or malformed arguments.
3. Require `sha256:<64-lowercase-hex>` for approval.
4. Require the canonical `team/plan.yaml` path.
5. Use `ownerPrincipal: uid:${currentUid()}`.
6. Keep preview side-effect-free.
7. Acquire the repository execution lock exactly once for approval/recovery.
8. Pass the lock-derived capability into the importer.
9. Report whether the transaction was:
   - Newly completed
   - Resumed and completed
   - Already completed
   - Durably blocked
10. Remove all TODOs, placeholders, and “for now” implementation branches.
11. Keep the adapter thin; all transaction behavior belongs behind the importer interface.

## Exit criterion

Tests invoke the same registered command handler Pi uses in production, and no command-only behavior remains untested.

---

# Phase 9 — Add hard-crash and production-path coverage

## Required scenarios

1. Preview causes no repository or external-state writes.
2. Successful two-task import preserves its dependency.
3. Existing task collision.
4. Symlinked task directory and symlinked parent.
5. Source-digest mismatch.
6. Manifest drift after preview.
7. `HEAD` drift before commit installation.
8. Queue revision drift.
9. Crash after:
   - `PREPARED`
   - `TREE_INSTALLED`
   - Ref CAS before journal update
   - `GIT_INSTALLED`
   - Queue persistence before journal update
   - `QUEUE_ENROLLED`
10. Exact replay after every crash.
11. Conflicting replay becomes `BLOCKED`.
12. No duplicate commits, task files, journals, or queue entries.
13. Post-completion bulk replay after expected-head advancement.
14. Owner principal remains passwd-UID-derived.
15. Registered command handler—not only importer functions—covers preview, approval, replay, and errors.
16. Incomplete journal blocks every unrelated mutating command.

Use spawned worker processes and `SIGKILL`, with repositories and state roots exclusively below `/tmp`.

## Exit criterion

Repeated crash-matrix runs produce identical final Git and queue state, or the same deterministic `BLOCKED` result for conflicts.

---

# Phase 10 — Dependency, formatting, documentation, and final gate

## Dependency deployment

Make `yaml` a reproducibly locked runtime dependency.

Choose and verify one deployment model:

1. Declare and lock `yaml` at the repository root where the stowed extension can resolve it after a documented clean install; or
2. Track the extension lockfile and provide a mandatory extension dependency-install step used by every client deployment.

Add a smoke test that installs dependencies into a clean temporary checkout and loads the extension from that checkout. The test must not rely on ignored local `node_modules` content.

## Cleanup

1. Remove every trailing-whitespace failure.
2. Remove unused imports and dead journal functions.
3. Update README claims only after implementation and crash tests prove them.
4. Update `team-from-plan/SKILL.md` to match the final strict schema exactly.
5. Update initializer/workflow guidance where import behavior affects generated repositories.
6. Update `QUEUE_IMPLEMENTATION_REPORT.md` with verified counts and the independent review verdict only after final review.

## Final gates

```bash
git diff --check 48fc08c

npx tsc --noEmit --skipLibCheck --allowImportingTsExtensions \
  --module nodenext --moduleResolution nodenext --target es2023 --types node \
  pi/.pi/agent/extensions/three-agent-team/*.ts \
  pi/.pi/agent/extensions/three-agent-team/test/*.ts

npm run test:three-agent-team

# In a clean temporary checkout:
npm ci
# Run the clean-install extension-load smoke test.
```

Then run two fresh independent reviews:

1. Standards review
2. Specification and production-safety review

## Production-ready definition

The implementation is ready only when all of the following are true:

- Zero critical or high review findings
- No failed gate
- Trusted validator passes every generated contract
- Registered production command path is covered
- Every hard-crash phase test passes
- Exact replay is idempotent
- Conflicting replay blocks durably
- No TODO, placeholder, or “for now” implementation branches remain
- Clean-install extension loading succeeds
- Documentation matches observed behavior
- No live deployment or passwd-rooted production-state mutation occurs without explicit owner approval

---

# Suggested commit sequence

1. `test(team): capture plan import production failures`
2. `fix(team): enforce strict plan manifests`
3. `refactor(team): centralize goal contract rendering`
4. `fix(team): add durable import transaction journal`
5. `fix(team): create exact plan import commits`
6. `fix(team): recover interrupted plan imports`
7. `fix(team): preserve queue import idempotency`
8. `fix(team): wire approved plan imports`
9. `test(team): cover plan import crash recovery`
10. `docs(team): document transactional plan imports`

Do not commit, deploy, or claim production readiness until all ten phases and both final independent reviews pass.
