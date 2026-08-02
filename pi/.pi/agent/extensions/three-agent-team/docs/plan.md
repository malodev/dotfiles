# `/team-import` Production-Readiness Remediation Plan

## Status

**Required before implementation can be called production-ready.**

This plan addresses the independent standards and production-safety review of the staged implementation against `48fc08c` and `PLAN_IMPORT_PRODUCTION_FIX_PLAN.md`.

Current ordinary gates pass:

- TypeScript compilation
- `git diff --check 48fc08c`
- 118/118 Node tests
- 11/11 trusted validator tests
- 54/54 Pi inference tests
- Manual clean staged export, `npm ci`, and extension import

Those results are necessary but insufficient. The current importer still has critical crash windows, does not persist authoritative artifacts or queue postimages, and lacks the required hard-crash and registered-handler evidence. Production readiness must not be claimed until every exit criterion in this document passes.

---

## 1. Non-negotiable safety invariants

The corrected implementation must preserve these invariants at every externally visible phase:

1. **No live mutation before durable authority exists.** Before any task path, Git ref, real index, or queue state changes, an atomically published transaction bundle must contain the exact approved manifest, rendered artifacts, digests, repository identity, owner, initial Git state, and initial queue state.
2. **Recovery never rerenders accepted artifacts.** Renderer changes after a crash cannot change recovered bytes.
3. **Recovery proves postimages.** Phase advancement requires exact equality with the journaled Git, worktree, index, and queue postimages.
4. **Every mismatch becomes durably `BLOCKED`.** No conflict, validation failure, CAS failure, malformed journal, or unexpected side effect may leave a transaction indefinitely retrying in a nonterminal phase.
5. **No arbitrary adoption.** Existing files, commits, refs, index entries, or queue entries are accepted only when every authoritative field matches.
6. **One mutation boundary.** All repository and queue mutations use one documented lock order and recheck the import fence while the repository lock is held.
7. **Approval remains evidence-bound.** The owner approves one canonical manifest digest at one exact `HEAD`, under one passwd-derived UID principal.
8. **Completed replay is observationally idempotent.** It returns the original commit, tasks, sequences, and outcome without generating new timestamps, artifacts, commits, journals, or queue writes.
9. **Blocked evidence is retained.** A blocked transaction is never silently ignored or replaced.
10. **No release by assertion.** Production readiness requires the real command handler, hard-crash matrix, clean-install smoke, and independent reviews—not only importer-level happy-path tests.

---

## 2. Target module design

### 2.1 Deep module and seam

Replace the current collection of public transaction helpers with one deep `PlanImporter` module. The command adapter and tests cross the same small interface:

```ts
interface PlanImporter {
  preview(manifestPath: CanonicalManifestPath): Promise<ImportPreview>;

  apply(
    approval: ImportApproval,
    capability: HeldRepositoryCapability,
  ): Promise<ImportOutcome>;
}

type ImportOutcome =
  | { kind: "NEWLY_COMPLETED"; result: CompletedImport }
  | { kind: "RESUMED_COMPLETED"; result: CompletedImport }
  | { kind: "ALREADY_COMPLETED"; result: CompletedImport }
  | { kind: "BLOCKED"; journalId: JournalId; reason: string };
```

The interface includes these invariants:

- `preview()` is read-only and accepts only `team/plan.yaml`.
- `apply()` requires a caller-held repository capability and never reacquires that lock.
- The implementation resumes the exact matching transaction automatically.
- A conflicting or blocked transaction returns a typed blocked outcome and performs no unjournaled mutation.
- Internal crash probes and filesystem/Git adapters remain internal seams; they are not exposed through the production command interface.

### 2.2 Internal adapters

Use internal adapters only where there are real production and test implementations:

- `ArtifactStore`: secure passwd-rooted implementation plus `/tmp` test implementation.
- `GitTransaction`: argument-array Git plumbing implementation plus deterministic test inspection helpers.
- `QueueEnrollment`: durable queue implementation plus test fixture implementation.
- `CrashProbe`: production no-op plus worker-test stall adapter.

Do not expose these adapters through `PlanImporter` merely for unit testing. Production command tests must exercise the same external seam as Pi.

### 2.3 File placement

Recommended ownership:

- `plan-import.ts`: `PlanImporter` orchestration and phase recovery only.
- `import-journal.ts`: transaction-bundle schema, secure publication, strict reads, phase CAS, and scanning.
- `plan-import-artifacts.ts`: immutable artifact-bundle construction and verified materialization.
- `plan-import-git.ts` or generalized `queue-repository.ts`: exact tree/commit construction and postimage verification.
- `team-import-command.ts`: strict native parser and thin registered command adapter.
- `goal-contract.ts`: sole canonical Goal Contract renderer.
- `queue.ts`: atomic import-enrollment command and exact immutable tuple comparison.

---

## 3. Atomically publish a complete `PREPARED` transaction

### 3.1 Replace the empty journal window

Do not create a visible journal with `tasks: []`.

Build the complete transaction below the repository-keyed external state root:

```text
imports/<repository-key>/.building-<journal-id>/
  journal.json
  approved-manifest.yaml
  sources/
    plan
    prd                    # when present
  tasks/<task-id>/
    brief.md
    status.yaml
```

Construction sequence:

1. Parse and strictly validate the canonical manifest.
2. Verify raw committed source blob bytes and digests at the previewed `HEAD`.
3. Snapshot canonical repository identity, UID, owner, Git `HEAD`, and complete queue preconditions while holding the repository lock.
4. Render every contract into the private building directory.
5. Run the trusted validator against a private Git fixture containing the exact rendered bytes.
6. Compute and record every artifact size, mode, SHA-256 digest, approved brief digest, authorized contract digest, dependency, and completion policy.
7. Write the complete `PREPARED` journal into the same building directory.
8. Fsync every file, each child directory, and the building directory.
9. Atomically rename the entire building directory to `imports/<repository-key>/<journal-id>/`.
10. Fsync the repository import directory.

The journal becomes visible atomically with all immutable artifacts. A crash before directory rename leaves no active transaction and no live mutation. Private `.building-*` directories are never adopted automatically; a secure, owner-approved maintenance path may clean them after proving that no published journal references them.

### 3.2 Artifact immutability

After publication:

- Artifact files are never rewritten.
- Recovery verifies ownership, mode, regular-file type, canonical containment, size, and digest before every use.
- Journal artifact paths are repository-keyed relative paths, never arbitrary absolute paths.
- Completed and blocked bundles remain available for audit.

### 3.3 Pre-live validation

The trusted validator must pass before publication of `PREPARED` and before live worktree mutation. Post-commit `inspectEnrollmentAdmission()` remains mandatory, but it is a second authority check rather than the first validation.

---

## 4. Replace the journal with an authoritative phase-CAS schema

### 4.1 Schema version

Introduce journal schema version 2. Since the current implementation is not deployed, do not add a permissive automatic migration. If any version-1 nonterminal journal is encountered, fail closed without side effects and require explicit owner handling.

### 4.2 Required fields

Strictly validate:

- Canonical repository path, SHA-256 repository key, current UID, and owner principal.
- Journal ID bound to its directory name.
- Canonical `team/plan.yaml` path and exact approved manifest bytes/digest.
- Previewed `HEAD` and verified raw source blobs/digests.
- Initial queue revision, expected head, paused state, dispatcher lease state, next sequence, and active barrier summary.
- Stable approval timestamp.
- Unique task IDs in topological order.
- Canonical repository-relative live paths.
- Immutable artifact-relative paths, sizes, modes, and SHA-256 digests.
- Approved and authorized contract digests.
- Tree SHA, commit SHA, parent, and exact subject.
- Exact intended queue tuples and expected sequences.
- Queue postimage revision and expected head.
- Typed completed result.
- Parsed ISO timestamps and nonempty blocking reason for `BLOCKED`.
- Phase-dependent required/forbidden fields.

Reject unknown fields at every nested level, duplicate tasks, duplicate paths, duplicate queue tuples, traversal, absolute artifact paths, unsafe modes, malformed IDs/digests, and any repository/UID/key mismatch.

### 4.3 State machine

Use an explicit queue-intent phase so queue persistence never precedes journaled authority:

```text
PREPARED
  -> TREE_INSTALLED
  -> GIT_INSTALLED
  -> QUEUE_PREPARED
  -> QUEUE_ENROLLED
  -> COMPLETED

Any nonterminal phase -> BLOCKED
```

Phase meanings:

- `PREPARED`: immutable artifacts and all preconditions are durable; no live side effect is required.
- `TREE_INSTALLED`: exact commit object metadata is durable; `HEAD` remains at the initial parent.
- `GIT_INSTALLED`: live files, `HEAD`, real index, and worktree exactly match the commit.
- `QUEUE_PREPARED`: exact queue enrollment tuples and queue postimage are durable; queue has not necessarily changed.
- `QUEUE_ENROLLED`: exact queue postimage is present.
- `COMPLETED`: final immutable result is durable.
- `BLOCKED`: persisted reason and observed mismatch are durable; no automatic mutation is permitted.

### 4.4 Transition enforcement

Replace optional caller-supplied `previousPhase` with a phase compare-and-swap:

1. Acquire the transaction journal lock under the held repository capability.
2. Read and strictly validate the current on-disk journal.
3. Require the persisted phase and generation/revision expected by the caller.
4. Validate the complete next journal and legal transition.
5. Atomically replace and fsync it.

No caller may omit or fabricate the previous phase. Exact same-phase writes are allowed only for a defined idempotent metadata completion, with a journal revision CAS.

### 4.5 Blocked discovery

Journal scanning must return completed, blocked, and active matching transactions deterministically. A matching blocked approval returns the persisted blocked outcome. A different import cannot silently supersede blocked evidence; starting another transaction requires an explicit owner resolution workflow documented and tested separately.

---

## 5. Build and install the exact Git postimage

### 5.1 Tree and commit construction

Use the immutable bundle as a private worktree:

1. Create an isolated `GIT_INDEX_FILE`.
2. `git read-tree <initial-head>`.
3. Set a private `GIT_WORK_TREE` rooted at the bundle materialization tree.
4. Stage only NUL-delimited approved task pathspecs.
5. `git write-tree`.
6. `git commit-tree <tree> -p <initial-head> -m <exact-subject>`.
7. Verify the created object is a commit and that its tree, single parent, and subject exactly match.
8. Persist all metadata as `TREE_INSTALLED` while live `HEAD` is unchanged.

Generalize the exact-commit implementation already used in `queue-repository.ts`; do not retain a second weaker plumbing path.

### 5.2 Symlink-safe live materialization

Replace `mkdir()` plus `writeFile()` with a repository-root-anchored helper that:

- Walks every path segment using directory descriptors and no-follow semantics.
- Rejects symlinks at every existing ancestor, including the case where a symlinked ancestor contains a missing descendant.
- Creates task directories without following links.
- Writes exclusive temporary regular files with approved modes.
- Fsyncs files, atomically renames within the verified directory, and fsyncs directories.
- Never overwrites an unexpected existing path.

During `TREE_INSTALLED` recovery:

- Missing live artifacts may be materialized from immutable bundle bytes.
- Exact already-materialized artifacts are accepted.
- Any different bytes, mode, type, owner, extra task path, or path redirection transitions to `BLOCKED`.

### 5.3 Ref and index installation

After exact live materialization:

1. Reverify `HEAD == initialHead`.
2. Install with `git update-ref HEAD <commit> <initialHead>`.
3. Normalize only the real index with `git read-tree --reset <commit>`.
4. Verify exact `HEAD`, commit type/tree/parent/subject, real index tree, clean worktree, and artifact bytes.
5. Persist `GIT_INSTALLED`.

If a crash occurs after ref CAS but before phase persistence, recovery may advance only after all Git and worktree postimages match exactly.

---

## 6. Make queue enrollment an exact atomic postimage

### 6.1 Admission and preconditions

Before any Git installation, refuse a fresh import when:

- A live dispatcher lease exists.
- Any queue attempt is active.
- A `RUNNING` or `BLOCKED` entry is a barrier.
- Existing queued work would be invalidated by the import commit.
- Queue expected head, revision, paused state, or next sequence differs from the captured preimage.

Define explicitly whether imports require a quiescent queue. The safest production rule is: only completed/dequeued historical entries may exist, no dispatcher lease may be live, and queue expected head must equal the previewed repository `HEAD` or be null for a new epoch.

### 6.2 Specialized atomic command

Add a queue command such as `bulkImportEnqueue` with:

- Expected queue revision and current expected head.
- New expected head equal to the exact import commit.
- Complete immutable enrollment tuples.
- Expected sequences and resulting revision.

The queue transaction must:

1. Compare every existing tuple before any CAS check.
2. Return an exact no-op when all tuples and the intended postimage already match.
3. For an effective write, verify the full captured preimage.
4. Atomically append all entries and advance expected head/revision.
5. Return the exact persisted postimage.

Persist intended tuples as `QUEUE_PREPARED` before invoking the command. After invocation, reread and compare every immutable field, sequence, state, queue revision, and expected head before persisting `QUEUE_ENROLLED`.

A crash after queue persistence but before journal update is recovered by exact tuple/postimage comparison. Missing, partial, duplicate, or conflicting tuples become `BLOCKED`.

---

## 7. Deterministic recovery by phase

Implement one recovery table rather than duplicated fresh/resumed flows:

| Phase | Required observations | Allowed action |
|---|---|---|
| `PREPARED` | Bundle valid; live task paths absent | Build exact tree/commit |
| `TREE_INSTALLED` | Commit metadata exact; `HEAD` is parent or exact commit; live artifacts absent/exact | Materialize missing exact files and CAS-install, or verify already-installed postimage |
| `GIT_INSTALLED` | Exact commit, ref, index, worktree, admissions, and queue preconditions | Build and persist exact queue intent |
| `QUEUE_PREPARED` | Git postimage exact; queue is exact preimage or intended postimage | Execute no-op/effective atomic enqueue, then verify |
| `QUEUE_ENROLLED` | Every queue tuple and queue postimage exact | Persist original completed result |
| `COMPLETED` | Stored result and all required audit fields valid | Return `ALREADY_COMPLETED` unchanged |
| `BLOCKED` | Valid persisted reason | Return `BLOCKED`; perform no mutation |

Wrap every recovery branch so unexpected errors are classified:

- Environmental/transient read errors: return an error without phase advancement only when no mismatch is observed and retry is safe.
- Any observed state mismatch, validation failure, CAS conflict, malformed postimage, or impossible phase invariant: persist `BLOCKED` before returning.

Centralize post-commit admission, queue intent, enrollment, and completion so fresh and resumed paths cannot drift.

---

## 8. Centralize mutation fencing and lock order

Introduce one deep mutation boundary used by every mutating command and Bash/tool mutation path:

```ts
await withTeamMutationBoundary(repo, purpose, async capability => {
  // Fence is checked after repository lock acquisition.
});
```

Required lock order:

1. In-process run admission/reservation.
2. Repository execution lock.
3. Active import/blocked transaction check.
4. Queue transaction lock when needed.
5. Git/worktree/external-state side effects.

Never acquire these in reverse order.

Apply it to `/team-new`, `/team-go`, `/team-resume`, `/team-enqueue`, `/team-dequeue`, `/team-pause`, `/team-continue`, `/team-unblock`, `/team-discard`, import approval/recovery, user Bash, tool calls, and interactive mutation paths. Read-only preview/status/report paths remain outside the mutation boundary.

The import path is the single exception to the generic “no active import” rejection: it may resume only an exact matching journal while holding the same repository capability.

Recheck durable dispatcher and active-attempt state while both repository and queue locks are held before publishing `PREPARED`.

---

## 9. Strict command adapter, YAML parser, and canonical renderer

### 9.1 `/team-import` parser

Create a pure parser with only two accepted forms:

```text
/team-import team/plan.yaml
/team-import team/plan.yaml --approve sha256:<64-lowercase-hex> --head <40-lowercase-hex>
```

Reject empty input, alternate paths, extra tokens, reordered flags, duplicate flags, missing values, `--head` without approval, approval without `--head`, uppercase/noncanonical digests, and malformed SHAs.

Move the registered adapter into `team-import-command.ts`. It should parse, acquire the mutation boundary once for approval, call `PlanImporter`, and map the discriminated outcome directly to truthful user messages.

### 9.2 YAML strictness

Parse the YAML document AST and reject:

- Standalone anchors
- Aliases
- Merge keys
- Custom tags
- Duplicate keys
- Unknown fields

Add a standalone-anchor regression test; the current alias-plus-merge test is insufficient.

### 9.3 Canonical Goal Contract rendering

Remove `contractTemplate()` from `index.ts`. Define one canonical contract input model and use `goal-contract.ts` for both `/team-new` and imports. Add parity tests proving both paths emit the same required structure, authority fields, completion policy, and digest semantics.

---

## 10. Test-first implementation sequence

### Milestone A — capture current failures

Add failing tests before implementation for:

- Visible `PREPARED` journal always has nonempty complete artifacts.
- Crash immediately after `PREPARED` resumes exactly.
- Partial live materialization recovers from immutable bytes.
- Artifact mismatch blocks durably.
- Commit with wrong type/tree/parent/subject blocks.
- Queue entry with same task ID but different immutable tuple blocks.
- Admission and queue CAS failures persist `BLOCKED`.
- Matching blocked replay returns the same blocked outcome.
- Journal reader rejects every malformed nested field and phase-invariant violation.
- Illegal transition cannot be bypassed by omitting or lying about the prior phase.
- Symlinked ancestor with a missing descendant is rejected.
- Standalone YAML anchors are rejected.
- Duplicate/reordered/dependent command flags are rejected.

### Milestone B — importer integration tests

Exercise only the `PlanImporter` interface for:

- Side-effect-free preview.
- Successful two-task dependency import.
- Collision and every symlink/path escape.
- Source, manifest, and `HEAD` drift.
- Queue revision/head/dispatcher/barrier drift.
- Completed exact replay with original result.
- Conflicting replay and blocked replay.
- No duplicate artifacts, commits, journals, or queue entries.

### Milestone C — real six-cut `SIGKILL` matrix

Use a spawned worker and a test-only `CrashProbe` adapter. At each cut, the worker reports readiness and stalls; the parent sends `SIGKILL`:

1. After durable `PREPARED` publication.
2. After durable `TREE_INSTALLED`.
3. After ref CAS but before `GIT_INSTALLED` journal update.
4. After durable `GIT_INSTALLED`.
5. After queue persistence but before `QUEUE_ENROLLED` update.
6. After durable `QUEUE_ENROLLED`.

For every cut:

- Release is by kernel process death, not cooperative cleanup.
- Start a fresh worker/process for recovery.
- Assert exact final commit/tree/parent/subject/index/worktree.
- Assert exact queue tuples, sequences, revision, and expected head.
- Assert stable journal ID, approval timestamp, commit SHA, and result.
- Assert no duplicate task files, artifacts, commits, journals, or queue entries.
- Repeat the matrix enough times to detect timing dependence.
- Add conflict variants that deterministically reach the same `BLOCKED` result.

All repositories and state roots remain under `/tmp`.

### Milestone D — registered production handler

Create a fake Pi adapter that captures the actual registered `/team-import` handler, then invoke it for:

- Preview.
- Approval.
- Resumed completion.
- Already completed replay.
- Blocked outcome.
- Every malformed argument form.
- Missing manifest and source drift errors.
- Lock/fence and live-dispatcher refusal.

Do not test a parallel parser or helper that production registration bypasses.

### Milestone E — clean-install smoke

Add a repository script that, in a clean temporary checkout of the tested commit:

1. Runs `npm ci`.
2. Confirms resolution of the locked `yaml` runtime dependency.
3. Imports the extension entry point.
4. Registers the extension against a minimal fake Pi interface.
5. Runs a read-only command smoke.

The test must not resolve dependencies from the developer’s existing ignored `node_modules`.

---

## 11. Commit-sized implementation slices

Use small, independently testable commits in this order:

1. `test(team): capture plan import recovery authority failures`
2. `fix(team): reject standalone yaml anchors and strict import args`
3. `refactor(team): unify goal contract rendering`
4. `refactor(team): introduce deep plan importer interface`
5. `fix(team): atomically publish immutable import bundles`
6. `fix(team): enforce strict journal schema and phase cas`
7. `fix(team): build exact import commits from private artifacts`
8. `fix(team): materialize import artifacts without following symlinks`
9. `fix(team): verify exact git postimages during recovery`
10. `fix(team): journal and verify exact queue enrollment intent`
11. `fix(team): centralize team mutation fencing`
12. `test(team): add registered import handler coverage`
13. `test(team): add six-cut sigkill recovery matrix`
14. `test(team): add clean-install extension smoke`
15. `docs(team): record verified import guarantees and limits`

Do not combine transaction design, queue semantics, and documentation claims into one large commit. Each implementation commit must leave its focused tests green.

---

## 12. Safety and rollback rules during implementation

- Use only repositories and external state below `/tmp` for destructive, crash, corruption, symlink, and migration tests.
- Do not modify live `~/.pi/agent`, passwd-rooted production queue state, or deployed stow targets.
- Do not run `git reset --hard`, `git clean`, forced deletion, or directory deletion.
- Do not commit, push, deploy, or alter live configuration without explicit owner approval.
- Preserve blocked and completed journal evidence.
- Keep the old importer unexposed once the new `PlanImporter` seam is wired; do not maintain two production paths.
- If a phase cannot prove its required postimage, stop and persist `BLOCKED`; never add a fallback that adopts observed state.

---

## 13. Documentation corrections

Only after the crash matrix and handler tests pass:

- Update `README.md` to advertise exactly `team/plan.yaml` and the strict two command forms.
- Update `team-from-plan/SKILL.md` to show the proposed manifest before writing it, satisfying `AGENTS.md`.
- Update initializer/workflow guidance to use the canonical renderer and production mutation boundary.
- Replace stale test counts in `PLAN_IMPORT_IMPLEMENTATION_REPORT.md`.
- Record the automated clean-install result and six-cut crash matrix.
- Update `QUEUE_IMPLEMENTATION_REPORT.md` with the fresh independent verdict.
- Avoid “atomic” without the qualifier **journaled logical atomicity**.

---

## 14. Final release gates

All commands must run from a clean coherent staged or committed snapshot:

```bash
git diff --check 48fc08c

npx tsc --noEmit --skipLibCheck --allowImportingTsExtensions \
  --module nodenext --moduleResolution nodenext --target es2023 --types node \
  pi/.pi/agent/extensions/three-agent-team/*.ts \
  pi/.pi/agent/extensions/three-agent-team/test/*.ts

npm run test:three-agent-team
npm run test:team-import-crash-matrix
npm run test:team-import-clean-install
```

Then obtain two new independent reviews:

1. Standards review against repository instructions and maintainability baseline.
2. Specification and production-safety review against `PLAN_IMPORT_PRODUCTION_FIX_PLAN.md` and this remediation plan.

### Production-ready definition

Production readiness may be claimed only when:

- There are zero critical or high review findings.
- Every ordinary and production-only gate passes.
- Every generated contract passes the trusted validator.
- All six real `SIGKILL` cuts recover identically or reach deterministic durable `BLOCKED`.
- Registered production command preview, approval, recovery, replay, and error paths are covered.
- Exact Git and queue postimages are verified at every phase.
- No live mutation occurs before authoritative artifact publication.
- Clean-install extension loading is automated and passes without existing `node_modules`.
- Documentation and reports match measured behavior and counts.
- The complete staged snapshot is coherent.
- No deployment or production-state mutation has occurred without explicit owner approval.

Until every condition above is met, the truthful release verdict remains **NOT PRODUCTION-READY**.
