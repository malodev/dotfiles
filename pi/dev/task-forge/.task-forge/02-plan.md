# TaskForge V2-Only Migration Plan

## Architecture overview
Target architecture becomes strictly:

`/forge command -> index.ts (thin shell) -> v2/commands/* -> v2/events append -> v2/derive snapshot -> renderer`

Authoritative state is `events.jsonl` only. `state.json` is derived/debug only and never used for command authority. Session memory is advisory metadata only.

## Major components and responsibilities
1. **Thin extension shell (`index.ts`)**
   - Parse `/forge` CLI arguments.
   - Load current V2 snapshot via storage/derive.
   - Delegate to V2 command services.
   - Append returned events.
   - Recompute snapshot and render output.
   - No transition/business orchestration logic.

2. **V2 command services (`v2/commands/*.ts`)**
   - Stateless, snapshot-in/result-out modules.
   - Return structured `CommandResult` (`ok`, `level`, `message`, optional `events`, optional `snapshotHint`).
   - No direct UI rendering; no pi-runtime coupling.

3. **Transition policy (`v2/transition-policy.ts`)**
   - Single source for state gating and transition planning:
     `canExecute`, `canResume`, `canPause`, `canAbort`, `canResolveBlocker`, `planRetryEvents`, `planPatchValidationEvents`.
   - Shared by execute/resume/blocker and reused by status messaging.

4. **Event model and derivation (`v2/events.ts`, `v2/derive.ts`, `v2/storage.ts`)**
   - All durable effects represented as V2 events.
   - Replay deterministically reconstructs snapshot.

5. **Legacy migration (`v2/migrate.ts`)**
   - Explicit one-way importer from legacy state.
   - Import runs only when needed; V2 remains authoritative afterward.

6. **Validation & evidence safety (`v2/validation.ts`, preflight/execution flow)**
   - Reject unsafe validation command shapes pre-execution.
   - Reject Deno in active paths.
   - Reject bare `npx tsc --noEmit` with concise remediation.
   - Summarize noisy evidence for users; preserve full logs in artifacts.

7. **Docs and drift control**
   - `README.md`, `ARCHITECTURE-V2.md`, runbook aligned to V2-only reality.
   - `EVENTS.md` canonical event reference aligned to `v2/events.ts`.
   - Drift checks for Deno references, event-list mismatch, config-example mismatch.

## Data model decisions
- **Source of truth:** append-only `events.jsonl`.
- **Derived state:** replayed `RunSnapshot`; deterministic and reproducible.
- **Command contract:** common `CommandResult` base with optional command-specific metadata extensions.
- **Blocker resolution:** event-backed transitions only (`task_contract_patched`, `human_intervention_resolved`, `task_requeued`, `approval_required`, `approval_granted`, etc.).
- **Legacy state:** never consulted as live authority after import.

## API/interface design
- Command service function style (example):
  - `runStatus(snapshot, args, config): CommandResult`
  - `runExecute(snapshot, args, config): CommandResult`
  - `runBlocker(snapshot, args, config): CommandResult`
- Transition policy returns structured decision payloads (`allowed`, `reasonCode`, optional suggested events).
- `index.ts` uses a command registry mapping command names to handlers.

## Implementation ordering
1. Freeze V1 paths and identify deletion targets.
2. Introduce command result contract + service scaffolds.
3. Implement transition policy + unit tests.
4. Refactor shell delegation in `index.ts`.
5. Flip status.
6. Flip execute/resume.
7. Flip blocker.
8. Flip remaining commands.
9. Implement explicit legacy migration guard.
10. Remove/quarantine V1 runtime paths.
11. Harden validation/evidence.
12. Add replay/regression test suite.
13. Update docs + add drift checks.

## Testing strategy
- **Unit tests:** transition policy and each command service.
- **Integration tests:** command flow append/replay/status parity before/after restart.
- **Regression tests:**
  - needs-human-intervention patched -> executable,
  - executing/no-running/ready-tasks recovery,
  - dependency requeue clears downstream blockers,
  - invalid validation command never reaches worker/gate.
- **Drift checks:** docs/events/config alignment and no active Deno references.

## Deployment/operational considerations
- Ship in slices but keep compatibility at command-name level.
- Preserve backward recovery with explicit one-time migration only.
- Keep user-facing messages concise and actionable.
- Log full diagnostics in artifacts for support and forensics.

## Confidence and ambiguity note
Confidence is **moderate** due to missing live file-tree verification in this prompt. Plan assumes required files exist at paths specified by PRD; early tasks include an explicit audit/freeze step to resolve path or naming mismatches safely.