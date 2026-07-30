# `/team-import` Production-Readiness Remediation Plan

## Status

**Current verdict: NOT PRODUCTION-READY.**

The implementation passes many tests, but the independent review found critical
and high-severity gaps against `PLAN_IMPORT_PRODUCTION_FIX_PLAN.md` and `plan.md`.
Passing tests alone is not sufficient: the required production invariants must be
implemented, tested through the registered production path, and reviewed from one
coherent snapshot.

This plan contains the remaining work required before production readiness may be
declared.

---

## 1. Release rules

Until every gate in this document passes:

- Do not claim production readiness.
- Do not deploy or mutate production state.
- Do not commit, push, force-delete, or delete directories without explicit owner
  approval.
- Run destructive, crash, corruption, and symlink tests only in repositories and
  state roots below `/tmp`.
- Preserve all `BLOCKED` and `COMPLETED` import evidence.
- Fix a production invariant before updating documentation that describes it.

A passing test count does not override a failed invariant or review finding.

---

## 2. Establish one coherent candidate snapshot

### Work

1. Inventory every staged, unstaged, and untracked candidate file.
2. Ensure every imported production module and every required test/script belongs
   to the candidate snapshot.
3. Remove accidental or unrelated changes only with explicit owner approval.
4. Stage the complete candidate, or create an owner-approved review commit.
5. Do not review a mixture of staged, unstaged, and untracked implementations.

### Acceptance criteria

- `git status --short` contains no `MM`, `AM`, or untracked candidate files.
- `git diff --cached --check` passes for a staged candidate, or the committed
  snapshot is clean.
- Exporting the candidate snapshot includes every module imported by `index.ts`.

---

## 3. Add failing tests for every confirmed critical defect

Write these tests before changing production behavior.

### Artifact and bundle tests

- A symlinked ancestor containing a missing descendant is rejected.
- A final artifact path that is a symlink is rejected, even when its target has
  matching bytes.
- An existing regular artifact with wrong mode, owner, size, or bytes becomes
  durably `BLOCKED`.
- A published bundle contains exact `sources/plan` and optional `sources/prd`
  bytes.
- Every immutable artifact has recorded path, size, mode, type, and SHA-256.
- A crash before publication exposes no transaction.
- A crash after publication preserves the bundle permanently.

### Git recovery tests

For each phase, inject wrong commit type, tree, parent, subject, HEAD, real index,
worktree bytes, artifact mode, and extra task path independently. Every mismatch
must produce a durable `BLOCKED` journal without repairing or adopting state.

### Queue tests

- Fresh import refuses a live dispatcher, active attempt, `RUNNING`/`BLOCKED`
  barrier, incompatible queued work, or wrong expected head.
- Exact replay is checked before stale preimage rejection.
- Recovery compares every immutable tuple field, exact sequence/state, revision,
  expected head, paused state, and next sequence.
- Partial, duplicate, missing, or conflicting enrollment becomes durably
  `BLOCKED`.
- Every queue command failure after publication persists `BLOCKED`.

### Journal and fencing tests

- Unknown or malformed nested journal fields fail closed.
- Repository path/key, UID, owner, journal directory name, manifest bytes, source
  bytes, and phase invariants are bound and validated.
- An unreadable/corrupt journal blocks discovery and unrelated mutation; it is
  never silently skipped.
- Every mutating command checks the import fence after acquiring or confirming
  the repository lock.

### Acceptance criteria

- Each test fails for the intended reason before the corresponding fix.
- Tests use only temporary repositories/state roots below `/tmp`.

---

## 4. Implement truly symlink-safe artifact materialization

### Work

1. Replace `stat()`-based path checks with repository-root-anchored no-follow
   traversal (`lstat`, directory descriptors, or equivalent safe primitives).
2. Verify canonical containment before every filesystem operation.
3. Reject symlinks at every existing ancestor and at the final path.
4. Create each directory without following links and verify it immediately.
5. Create temporary files exclusively in the already-verified parent directory.
6. Verify regular-file type, UID, exact mode, size, and digest.
7. Atomically rename without replacing an unexpected destination.
8. Fsync the file and each affected directory.
9. On any mismatch after publication, persist `BLOCKED`; never repair or
   overwrite an unexpected artifact.

### Acceptance criteria

- All artifact/path attack tests pass.
- No filesystem write can escape the canonical repository root.
- Existing artifacts are accepted only when every recorded property matches.

---

## 5. Publish a complete authoritative `PREPARED` bundle

### Work

1. Verify raw plan/PRD blobs at the previewed commit.
2. Copy the exact verified blobs into `sources/plan` and optional `sources/prd`.
3. Render all contracts in the private building directory.
4. Run the trusted validator against a private Git fixture containing the exact
   rendered bytes **before publication and before live mutation**.
5. Record every artifact path, size, mode, type, digest, contract digest,
   dependency, completion policy, and stable approval timestamp.
6. Write the complete journal into the same private directory.
7. Fsync all files and directories, then atomically rename the complete bundle.
8. Never automatically delete `.building-*`, published, `BLOCKED`, or
   `COMPLETED` bundles. Any maintenance cleanup must be separate, secure,
   owner-approved, and evidence-aware.

### Acceptance criteria

- Visible `PREPARED` always contains all authoritative bytes and metadata.
- No live worktree, Git ref/index, or queue mutation occurs before publication.
- Failed validation leaves no published transaction and no live mutation.
- Published evidence remains available for audit.

---

## 6. Make journal validation and discovery fail closed

### Work

1. Define strict schemas for every nested object; reject unknown nested fields.
2. Validate duplicate IDs, paths, tuples, and sequences.
3. Validate canonical repository path/key, current UID, owner principal, journal
   ID/directory binding, canonical manifest path, source bytes, and all digests.
4. Validate phase-specific required and forbidden fields for every phase.
5. Validate the entire next journal before every phase-CAS write.
6. Serialize journal transitions with the transaction lock under the held
   repository capability.
7. Make discovery deterministic. A malformed, unreadable, or insecure journal is
   a blocking condition, not an entry to skip.
8. Keep exact matching `BLOCKED` and `COMPLETED` results durable and replayable.

### Acceptance criteria

- Every malformed journal fixture is rejected before side effects.
- Corrupt evidence blocks new imports and unrelated mutations.
- No caller can fabricate or omit the expected phase/revision.

---

## 7. Prove exact Git postimages; never repair observed state

### Work

1. Build the commit from immutable bundle bytes using a private index/worktree.
2. Verify commit type, exact tree, exactly one parent, and exact subject before
   persisting `TREE_INSTALLED`.
3. Install the ref with compare-and-swap from the recorded parent.
4. Normalize the real index only after successful ref CAS.
5. Verify exact HEAD, commit metadata, real index tree, clean worktree, artifact
   bytes/modes, and absence of extra task paths before `GIT_INSTALLED`.
6. Define recovery by persisted authority:
   - `PREPARED`: verify bundle, then construct the exact object.
   - `TREE_INSTALLED`: verify exact commit metadata; materialize only missing
     artifacts from the bundle; then perform ref CAS.
   - `GIT_INSTALLED`: verify the complete recorded postimage only. Do not move
     HEAD, rewrite the real index, rematerialize files, or adopt a different
     object.
7. Any mismatch must transition durably to `BLOCKED`.

### Acceptance criteria

- Recovery never repairs a `GIT_INSTALLED` state.
- Wrong parent/subject/index/worktree/mode/extra path always blocks.
- Exact replay retains journal ID, approval time, tree, commit, and result.

---

## 8. Make queue admission and enrollment exact

### Work

1. Require a quiescent queue for a fresh import:
   - no live dispatcher lease;
   - no active attempt;
   - no `RUNNING` or `BLOCKED` barrier;
   - no incompatible queued work;
   - expected head is null for a new epoch or equals the previewed HEAD.
2. Persist dispatcher/barrier/attempt summary and all queue preconditions in the
   journal.
3. In `bulkImportEnqueue`, compare all existing immutable tuples first.
4. Return an exact no-op when tuples and intended postimage already match, before
   applying stale revision/head checks.
5. For an effective write, verify the full captured preimage and atomically append
   all entries with exact sequences.
6. Return and persist the exact postimage.
7. Before `QUEUE_ENROLLED`, compare every tuple field, sequence, state, revision,
   expected head, paused state, and next sequence.
8. On queue rejection or postimage mismatch, persist `BLOCKED` before returning.

### Acceptance criteria

- Existing queued work cannot be invalidated by an import commit.
- A crash after queue persistence rolls forward only from an exact postimage.
- Partial or conflicting queue state never completes an import.

---

## 9. Centralize the mutation fence

### Work

1. Route every mutating team command through one repository mutation boundary.
2. Acquire or confirm the repository execution lock first.
3. Check the incomplete-import fence while that lock is held.
4. Do not bypass the fence merely because a caller already owns a lock.
5. Move `/team-resume` fencing inside the acquired lock.
6. Permit only read-only commands and exact matching import recovery.
7. Test all mutating commands, including Bash/tool-call mutation paths.

### Acceptance criteria

- There is no check-before-lock race.
- An incomplete or corrupt journal blocks every unrelated mutation.
- Exact matching recovery remains possible.

---

## 10. Complete production-path test coverage

### Registered handler matrix

Invoke the actual registered `/team-import` handler through a fake Pi adapter for:

- preview;
- fresh approval;
- resumed completion;
- already-completed replay;
- durable blocked outcome;
- every malformed argument form;
- missing manifest and source/manifest/HEAD drift;
- repository lock/fence refusal;
- live dispatcher and queue barrier refusal;
- importer and recovery error reporting.

Move the complete adapter into `team-import-command.ts`; `index.ts` should only
register it.

### Real SIGKILL matrix

At all six required cut points:

1. wait for worker readiness;
2. send real `SIGKILL`;
3. start a fresh recovery process;
4. assert exact commit/tree/parent/subject/index/worktree;
5. assert exact queue tuples/sequences/revision/expected head;
6. assert stable journal ID, approval timestamp, commit SHA, and result;
7. assert no duplicate files, bundles, commits, journals, or queue entries;
8. run conflict variants that assert the persisted journal phase is exactly
   `BLOCKED`, not merely that the worker failed;
9. repeat enough times to expose timing dependence.

### Acceptance criteria

- All required scenarios are asserted, not inferred from `COMPLETED` output.
- Production-only tests are part of explicit root scripts.

---

## 11. Add truthful release automation

### Required root scripts

Add and verify:

- `test:team-import-crash-matrix`
- `test:team-import-clean-install`

Update the aggregate Node test script to include handler, crash-matrix, and
SIGKILL tests, or clearly separate ordinary and production-only suites while
running both in release gates.

### Clean-install smoke requirements

1. Export the complete coherent candidate snapshot into a temporary directory.
2. Run `npm ci`, not `npm install`.
3. Ensure no dependency resolves from existing ignored `node_modules`.
4. Confirm the locked `yaml` runtime dependency resolves.
5. Import the extension entry point.
6. Register it against a minimal fake Pi API.
7. Invoke a read-only registered command.
8. Clean temporary data without prohibited forced directory deletion.

### Acceptance criteria

Both required commands exist and pass from the candidate snapshot.

---

## 12. Correct skills, README, and reports

Only after implementation and test gates pass:

1. Change `team-from-plan/SKILL.md` to display the proposed manifest before
   writing `team/plan.yaml`.
2. Ensure initializer/workflow guidance uses the canonical renderer and mutation
   boundary.
3. Report separately:
   - ordinary Node tests;
   - validator tests;
   - inference tests;
   - handler tests;
   - SIGKILL tests;
   - clean-install result.
4. Derive counts from executed commands; do not hand-sum stale categories.
5. Use **journaled logical atomicity**, never an unqualified atomicity claim.
6. Record remaining limitations and the latest independent verdict.

### Acceptance criteria

- Documentation matches measured commands and behavior exactly.
- No report claims production readiness before both final reviews pass.

---

## 13. Run the final release gates from the coherent snapshot

Run exactly:

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

Also verify:

```bash
git status --short
git diff --cached --check
```

### Acceptance criteria

- Every command exits zero.
- The tested snapshot is exactly the snapshot submitted for review.
- Every generated contract passes the trusted validator.

---

## 14. Obtain two new independent reviews

Use reviewers that did not implement the fixes.

### Standards review

Review the complete coherent snapshot against:

- `pi/.pi/agent/AGENTS.md`;
- repository conventions;
- maintainability and deep-module boundaries.

### Specification and production-safety review

Review against:

- `PLAN_IMPORT_PRODUCTION_FIX_PLAN.md`;
- `plan.md`;
- this remediation plan.

The reviewers must inspect implementation and tests directly rather than trusting
reports.

### Acceptance criteria

- Zero critical findings.
- Zero high findings.
- Every medium finding is fixed or explicitly accepted by the owner with a
  documented non-safety rationale.
- Both review axes return PASS.

If either review fails, fix findings, rerun all gates, and obtain two fresh
reviews from the new coherent snapshot.

---

## 15. Production-ready declaration checklist

Production readiness may be declared only when every item is checked:

- [ ] Candidate snapshot is coherent and complete.
- [ ] No live mutation occurs before authoritative bundle publication.
- [ ] Bundle contains exact source and artifact bytes plus complete metadata.
- [ ] Materialization cannot follow symlinks or escape the repository.
- [ ] Journal validation and discovery fail closed.
- [ ] Every Git phase proves the complete exact postimage.
- [ ] Every queue phase proves the complete exact postimage.
- [ ] Recovery never repairs or adopts unjournaled state.
- [ ] Every mismatch persists deterministic durable `BLOCKED`.
- [ ] Mutation fencing is centralized and race-free.
- [ ] Registered production handler matrix passes.
- [ ] Repeated six-cut real SIGKILL matrix passes with exact assertions.
- [ ] Clean-install smoke passes with `npm ci` from the coherent snapshot.
- [ ] All generated contracts pass the trusted validator.
- [ ] All required release commands exit zero.
- [ ] Documentation and measured counts agree.
- [ ] Independent standards review has zero critical/high findings.
- [ ] Independent specification/safety review has zero critical/high findings.
- [ ] No deployment or production-state mutation occurred without owner approval.

Only then may the verdict change to **PRODUCTION-READY**.
