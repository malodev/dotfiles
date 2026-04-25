## TaskForge V2-Only Migration — Test Design Summary

### Framework & Convention
- **Test runner**: Node.js built-in (`node:test`) with `--experimental-strip-types`
- **Unit/contract tests**: `tests/v2/commands/*.test.ts` and `tests/v2/*.test.ts`
- **Integration/structural tests**: `tests/integration/*.test.ts`
- **Type-checking**: `npx tsc --noEmit` before test execution

### What is already implemented vs missing
Several V2 command services (`v2/commands/*.ts`) and `v2/transition-policy.ts` were already scaffolded/implemented before this test-design session. Tests for those modules are **verification tests** that confirm contract conformance and coverage of acceptance-criteria gaps.

Tests that are expected to **fail now** (pre-implementation) and pass after the task is completed:
- `tests/integration/index-shell-delegation.structural.test.ts` (T4) — `index.ts` does not yet import V2 command services
- `tests/v2/commands/help.test.ts` (T8) — `v2/commands/help.ts` does not exist
- `tests/v2/migrate.test.ts` (T9) — one-way migration guard is incomplete
- `tests/integration/no-v1-authority.structural.test.ts` (T10) — V1 helpers are still used in `index.ts`
- `tests/v2/validation-policy.test.ts` (T11) — `assertSafeValidationCommand` does not exist; Deno and bare `npx tsc --noEmit` are not rejected
- `tests/integration/blocker-cascade-replay.test.ts` (T7) — dependency unblock cascade is not auto-resolved on requeue
- `tests/integration/replay-regression-suite.test.ts` (T12) — dependency cascade regression fails for the same reason

### Key design choices
1. **Structural smoke tests for `index.ts`** (T4, T10): Because `index.ts` imports `@mariozechner/pi-coding-agent` which is unavailable in the local test environment, we use file-text analysis to verify delegation patterns and absence of V1 authority instead of runtime import tests.
2. **Integration tests use temp directories and real V2 storage**: Tests for replay parity, migration, and regressions exercise `v2/storage.ts` (`appendEvent`, `readEvents`, `deriveSnapshot`) and `v2/derive.ts` (`replayEvents`) against actual file I/O in `tmpdir()`.
3. **No invented internal APIs**: Tests only import modules that already exist or are explicitly committed in the PRD (e.g., `v2/commands/help.ts`). Where the exact API for a requirement is missing (validation policy guard, evidence summarization, force-unblock events), ambiguities are recorded rather than silently filling gaps.

### Ambiguities flagged
- **Validation command policy API**: Not committed; assumed `assertSafeValidationCommand` in `v2/validation.ts` but could also belong in `v2/preflight.ts`.
- **Evidence summarization**: No committed function/module.
- **Force-unblock event schema**: Not defined in `v2/events.ts`.
- **Doc canonical ownership**: `events.ts` vs `EVENTS.md` drift-check boundary is unspecified.
