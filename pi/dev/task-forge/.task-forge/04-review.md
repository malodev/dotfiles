## 1. **Summary**

The migration is **partially integrated**: core V2 primitives and command services exist, but the runtime shell (`index.ts`) is still hybrid in several critical paths.  
As a result, the implementation does **not yet satisfy** the PRD’s V2-only authority guarantees end-to-end.

---

## 2. **Critical Issues**

1. **`/forge execute` and `/forge resume` still depend on in-memory V1 state**
   - `handleExecuteCommand` hard-fails when `state` is null (`index.ts:2291-2294`).
   - Execution loop still requires V1 `state` (`executeApprovedPlan`, `index.ts:2039-2040`), and resume immediately starts that path (`index.ts:2767-2768`).
   - This breaks restart determinism: with valid V2 events but no in-memory state, commands can fail with “No plan available/No plan to execute”.

2. **V1 fallback remains active runtime authority**
   - `loadAuthoritativeSnapshot` still falls back to `migrateV1StateToSnapshot(raw)` (`index.ts:523-538`).
   - Bootstrap explicitly notes fallback to V1 on failure (`index.ts:519` comment).
   - This conflicts with one-way migration intent and keeps hybrid authority live in runtime.

3. **`/forge blocker` still mutates non-authoritative state and bypasses event-only durability**
   - Direct mutable state writes remain in active paths (`task.status = "pending"` etc., `index.ts:2463`, `2486`, `2676`).
   - Direct `state.json` mutation is still performed (`index.ts:2568-2585`), violating derived/debug-only semantics.
   - `--patch-validation` applies local mutations even when V2 patch planning fails (events only appended under `patchResult.ok`, but success flow continues and notifies success at `index.ts:2541-2597`).

4. **Required `/forge blocker --list --json` behavior is not implemented**
   - No `--list`/`--json` handling in command parsing (no `--list` support in `index.ts`; list branch always renders text: `index.ts:2348-2377`).
   - Help output also omits this required command shape (`v2/commands/help.ts:20-24`).

5. **Node-only validation policy is not actually enforced**
   - `assertSafeValidationCommand` blocks Deno and some unsafe shapes, but has no Node allowlist enforcement (`v2/validation.ts:109-129`).
   - Non-Node commands are currently accepted by guard logic (e.g., `python -m pytest`).
   - This violates the “Node-only active test/check policy” requirement.

---

## 3. **Warnings**

1. **Transition-policy wiring is inconsistent for blocker force-unblock**
   - Policy/service exists (`v2/commands/blocker.ts:141`), but `index.ts` does not import/use that service for `--force-unblock` (`index.ts:43`, custom branch at `index.ts:2478-2526`).

2. **Command result contract diverges from required rendering contract**
   - `CommandResult` lacks required `level` and `snapshotHint` fields (`v2/commands/contracts.ts:13-23`), increasing renderer inconsistency risk.

3. **Type-safety is broadly disabled in core V2 modules**
   - Multiple foundational files are `// @ts-nocheck` (e.g., `v2/derive.ts`, `v2/storage.ts`, `v2/migrate.ts`, `v2/validation.ts`, `v2/commands/execute.ts`, `v2/commands/resume.ts`).
   - This looks like acceptance-gate gaming rather than stabilization.

4. **Testing gap: handler-level integration is missing**
   - Tests are mostly service-level and structural; they do not catch active `index.ts` hybrid behavior (e.g., execute/resume requiring `state`).
   - `tests/integration/no-v1-authority.structural.test.ts` checks string presence, not runtime behavior.

5. **Performance risk from repeated full replay**
   - `deriveSnapshot` re-reads entire `events.jsonl` each time (`v2/storage.ts:35-46`).
   - Engine append path derives+writes snapshot on every event (`v2/engine.ts:43-48`).
   - Under larger logs this can become costly.

---

## 4. **Informational Notes**

- Positive: V2 command services, transition policy, migration guard module, and replay-focused regression suites are present and mostly coherent.
- Positive: drift checks exist and pass (`scripts/drift-check.sh`), and event doc parity is automated.
- Caveat: docs claim V2-only runtime (`README.md:555-560`), but runtime shell behavior currently does not fully match that claim.

---

## 5. **Recommended Follow-ups**

1. **Blocker fix (highest priority):** remove `state` dependency from execute/resume runtime path in `index.ts`; execute directly from V2 snapshot/tasks.
2. **Blocker fix:** replace remaining inline blocker logic with V2 blocker command services only; remove direct `state.json` and mutable `state` edits.
3. **Blocker fix:** implement `/forge blocker --list --json` end-to-end (parser + renderer + tests).
4. **Blocker fix (security):** enforce strict Node-only validation command allowlist in `assertSafeValidationCommand`.
5. **Architecture fix:** route migration solely through `v2/migrate.ts` (`shouldImportLegacyState`/`importLegacyState`) and delete runtime V1 fallback in `loadAuthoritativeSnapshot`.
6. **Quality fix:** remove `@ts-nocheck` from core V2 files and restore real project-level type-gate.
7. **Testing fix:** add black-box integration tests through `pi.registerCommand("forge")` for restart scenarios and blocker patch safety (including invalid command rejection behavior).