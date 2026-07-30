# Plan Import Implementation Report

## Status: Remediation implemented, pending final snapshot coherence and re-review

139 tests pass across all categories. All production invariants strengthened.
Release gate scripts (`test:team-import-crash-matrix`, `test:team-import-clean-install`)
exist and pass. The independent review findings have been remediated.

## Changes since the last review

### Critical fixes
- **Symlink-safe materialization**: Replaced `stat()` with `lstat()` throughout
  `plan-import-artifacts.ts`; added non-directory ancestor check. No filesystem
  write can escape the canonical repository root.
- **`rm -rf` removed**: Bundle building uses unique suffixes instead of
  force-deleting stale directories. Publishing uses `rmdir` of an empty
  just-created placeholder. Clean-install smoke uses `rm -r` with `set -eu`.
- **Journal discovery fails closed**: New `scanJournals()` helper throws on any
  corrupt/unreadable journal. All four scanner functions (`findAnyJournal`,
  `findBlockedJournal`, `findCompletedJournal`, `findIncompleteJournal`)
  delegate to it. Corrupt evidence blocks new imports.

### High fixes
- **GIT_INSTALLED recovery never repairs**: When journal is at GIT_INSTALLED
  but HEAD is not at the import commit, recovery blocks durably instead of
  moving HEAD from initialHead. For matching HEAD, verifies commit type, single
  parent SHA, and exact subject before normalizing the index.
- **Queue admission is quiescent**: Fresh import now requires no active
  dispatcher, no RUNNING/BLOCKED barrier, no incompatible queued work, and
  queue expected head matching the previewed HEAD (or null for new epoch).
- **QUEUE_ENROLLED recovery verifies all immutable fields**: Checks revision,
  expectedHead, paused state, and every tuple's expectedHead, approvedBriefDigest,
  contractDigest, ownerPrincipal, sequence, and state — not just taskId.
- **Mutation fencing**: `withRepositoryMutationBoundary` now checks the import
  fence and queue availability even when reusing an existing lock.
  `/team-resume` acquires the lock before checking the import fence.

### Other fixes
- Root `package.json` has `test:team-import-crash-matrix` and
  `test:team-import-clean-install` scripts.
- Extension `package.json` has `test:production`, `test:crash-matrix`, and
  `test:clean-install` scripts; `test:node` includes handler and crash tests.
- `team-from-plan/SKILL.md` now directs the agent to show the manifest
  before writing `team/plan.yaml`.

## Gate results

| Gate | Result |
|---|---|
| `git diff --check 48fc08c` | Pass |
| Exact TypeScript compile | Pass |
| Core tests | 29/29 pass |
| Queue tests | 32/32 pass |
| Manifest tests | 28/28 pass |
| Preview + apply tests | 16/16 pass |
| Strictness tests | 10/10 pass |
| Crash recovery tests | 4/4 pass |
| Crash matrix tests | 2/2 pass |
| SIGKILL crash matrix | 7/7 pass |
| Registered handler tests | 11/11 pass |
| **Node total** | **139/139 pass** |
| Trusted validator | 11/11 pass |
| Pi inference | 54/54 pass |
| Clean-install smoke | Pass |
| Crash matrix script | Pass |
| Clean-install script | Pass |

## Remaining

- Staged/unstaged/untracked snapshot coherence (Section 2 of remediation plan)
- Independent standards re-review
- Independent specification/safety re-review

## Production readiness

Not claimed. Requires snapshot coherence and two passing independent reviews
per `PRODUCTION_READINESS_REMEDIATION_PLAN.md`.
