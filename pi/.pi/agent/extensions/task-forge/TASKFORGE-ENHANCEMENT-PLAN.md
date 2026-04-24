# TaskForge Enhancement Plan

> Superseded by: `TASKFORGE-V2-ONLY-MIGRATION-PLAN.md`
>
> Historical purpose: turn the design review observations into an incremental improvement plan. Use the V2-only migration plan for current work.

## Executive summary

TaskForge has the right architectural direction: an event-sourced v2 runtime, derived snapshots, explicit human intervention, task contracts, role/tier model routing, and inspectable artifacts.

The next phase should not add many new product features. It should harden the orchestration runtime around three themes:

1. **State-machine rigor** — eliminate ambiguous/stuck states.
2. **Validation-contract rigor** — prevent unsafe shell-string validation contracts before execution.
3. **Operator clarity** — make blockers and evidence concise, actionable, and scriptable.

## Current assessment

### What is solid

- Event log as the source of truth (`events.jsonl`).
- Derived snapshot model (`derive.ts`) as the authoritative state view.
- Explicit `needs_human_intervention` state.
- Role/tier model abstraction via `task-forge.json`.
- File-configurable prompts in `agents/*.md`.
- Task contracts with dependencies, manifests, validation, and acceptance criteria.
- Human approval gate before execution.
- Typed blocker/remediation categories.

### Main pitfalls to address

1. **v1/v2 coexistence still leaks into runtime behavior**
   - Some command handlers still reason through compatibility state.
   - This can produce contradictory UX like “not resumable” and “cannot execute from needs_human_intervention.”

2. **Status transitions are not yet centralized**
   - `/forge execute`, `/forge resume`, and `/forge blocker` have overlapping but different gating logic.

3. **Validation commands are fragile shell strings**
   - Commands like `npx tsc --noEmit` depend on implicit cwd/tsconfig assumptions.
   - Bad command contracts can enter durable state and cause repeated blockers.

4. **Human-intervention evidence can be too noisy**
   - Large compiler/test output can overwhelm the actionable message.

5. **Output manifest strictness can create false negatives**
   - Gate review can fail valid work if the expected filename is stale or overly literal.

6. **Prompt/config/docs drift is likely**
   - Agent prompts, README, architecture docs, runbooks, and runtime config can diverge.

7. **Self-hosting TaskForge on TaskForge magnifies edge cases**
   - The system dogfoods its own weakest paths: validation, blockers, retry, and manifest alignment.

---

## Enhancement roadmap

## Phase 1 — Make the state machine explicit

### Goal

Remove stuck-state classes by centralizing command transition decisions.

### Work items

#### 1.1 Add transition policy module

Create a pure/testable module, likely:

```text
agent/extensions/task-forge/v2/transition-policy.ts
```

It should answer:

```ts
canExecute(snapshot): Decision
canResume(snapshot): Decision
canResolveBlocker(snapshot, taskId): Decision
nextEventsForRetry(snapshot, taskId): EventPlan
nextEventsForPatchValidation(snapshot, taskId, command): EventPlan
```

### Acceptance criteria

- `/forge execute`, `/forge resume`, and `/forge blocker` share transition logic.
- No command can leave the run in `needs_human_intervention` after a valid patch/retry when no unresolved blocker remains.
- Tests cover all allowed/refused transitions.

### Expected files

- `v2/transition-policy.ts` (new)
- `index.ts`
- `v2/derive.ts` if snapshot semantics need tightening
- transition policy tests

---

## Phase 2 — Make human intervention event-first

### Goal

Ensure human intervention is always resolved through explicit events, never hidden state mutation.

### Work items

#### 2.1 Normalize blocker resolution event sequence

Preferred recovery chain:

```text
human_intervention_requested
(task_contract_patched | test_spec_patched)?
human_intervention_resolved
task_requeued
approval_required or approval_granted
```

#### 2.2 Update blocker commands

`/forge blocker` should emit the correct event plan for:

- `--resolve`
- `--retry`
- `--patch-validation`
- `--force-unblock`

### Acceptance criteria

- `pendingHumanIntervention` clears only via `human_intervention_resolved`.
- A patched human-gated task can be retried without manual JSON editing.
- Event log remains auditable and replayable.

### Expected files

- `index.ts`
- `v2/engine.ts`
- `v2/derive.ts`
- blocker command integration tests

---

## Phase 3 — Harden validation contracts

### Goal

Reject or normalize unsafe validation commands before they reach execution.

### Work items

#### 3.1 Add validation command policy

Create or split into:

```text
v2/validation-command-policy.ts
```

Policy checks:

- Reject `deno test` / `deno check` in active TaskForge runtime/docs/tests.
- Reject bare `npx tsc --noEmit` unless it includes:
  - explicit file targets, or
  - `-p/--project <tsconfig>`.
- Warn/reject global `node --test` when the task has targeted test files.
- Validate referenced test paths exist when possible.
- Preserve valid commands without surprising rewrites.

#### 3.2 Normalize at write-time

Normalize/check validation commands before events such as:

- `tasks_registered`
- `test_spec_written`
- `task_contract_patched`
- `test_spec_patched`

### Acceptance criteria

- Invalid command shapes fail preflight with concise guidance.
- Bad commands do not become authoritative event state when avoidable.
- Existing valid Node commands continue to pass.

### Expected files

- `v2/validation.ts`
- `v2/preflight.ts`
- possible `v2/validation-command-policy.ts`
- planner/test-designer persistence points in `index.ts`
- validation/preflight tests

---

## Phase 4 — Improve operator UX for blockers/status

### Goal

Make TaskForge easier to operate under failure.

### Work items

#### 4.1 Compact evidence formatter

Human-facing messages should summarize known noisy outputs:

- TypeScript compiler help output
- long stack traces
- repeated test output
- missing command/runtime errors

Full output should stay in artifacts/logs.

#### 4.2 Scriptable blocker status

Add:

```text
/forge blocker --list --json
/forge status --json
```

### Acceptance criteria

- Human-intervention message is short and actionable by default.
- Full evidence remains available in logs/artifacts.
- Blocker/status JSON output is stable enough for scripts.

### Expected files

- `index.ts`
- status rendering modules
- status/blocker tests
- runbook docs

---

## Phase 5 — Improve manifest mismatch handling

### Goal

Keep output manifests useful without causing avoidable false blockers.

### Work items

#### 5.1 Add manifest mismatch classifier

Classify mismatch types:

- missing expected output file
- actual file differs only by naming convention
- file existed before task but manifest marked `(new)`
- validation passed but manifest stale

#### 5.2 Add explicit remediation path

Possible future command:

```text
/forge blocker <task-id> --patch-manifest "..."
```

Do not silently rewrite manifests without event/audit trail.

### Acceptance criteria

- Gate review can suggest precise manifest remediation.
- False blockers become easy to resolve.
- Manifest strictness still prevents uncontrolled scope creep.

### Expected files

- `v2/gate-review.ts`
- `v2/blocker-classifier.ts`
- blocker resolution modules
- tests for known filename mismatch cases

---

## Phase 6 — Reduce v1 runtime dependency

### Goal

Make v2 the only mental/runtime model for commands.

### Work items

#### 6.1 Audit v1 compatibility usage

Identify places where command logic still depends on v1-shaped state.

#### 6.2 Keep v1 only as migration/compatibility output

- v2 snapshot is authoritative.
- v1 conversion is allowed only for backwards-compatible display or migration.
- command decisions must not depend on v1 state.

### Acceptance criteria

- `/forge status`, `/forge execute`, `/forge resume`, `/forge blocker` all read v2 snapshot first and emit v2 events.
- No command path requires manual sync between v1 and v2.

### Expected files

- `index.ts`
- `v2/bridge.ts`
- migration helpers/tests

---

## Phase 7 — Documentation and drift control

### Goal

Keep docs/config/prompts aligned with the current runtime.

### Work items

#### 7.1 Add event schema documentation

Create:

```text
EVENTS.md
```

Document:

- every event type
- emitter
- affected snapshot fields
- invariants
- migration policy

#### 7.2 Add drift checks

Automated checks:

- no `Deno.test`, `deno test`, or `deno check` in active TaskForge paths
- README config is either generated or clearly marked illustrative
- `ARCHITECTURE-V2.md` event list matches `events.ts`
- agent prompt contract tests stay green

### Acceptance criteria

- Documentation does not describe obsolete events/commands.
- CI/local checks catch common drift before commits.

### Expected files

- `EVENTS.md`
- README/runbook updates
- scripts or tests for drift checks

---

## Recommended implementation order

1. **Phase 1 + Phase 2**: transition policy and human-intervention event lifecycle
2. **Phase 3**: validation command safety
3. **Phase 4**: compact evidence and JSON status/blocker output
4. **Phase 5**: manifest mismatch remediation
5. **Phase 6**: v1 runtime dependency cleanup
6. **Phase 7**: event docs and drift checks

This order prioritizes unblockability first, then prevents repeat failures, then improves operator experience.

---

## Testing strategy

### Required regression scenarios

- fail -> human intervention -> patch validation -> retry -> execute
- fail -> human intervention -> retry without patch -> execute
- dependency blocker cascade over a multi-level DAG
- output manifest mismatch with semantically equivalent file
- invalid bare `tsc --noEmit`
- Deno command rejected in generated validation contract
- long compiler output summarized in human message

### Suggested test groups

```text
v2/transition-policy.*.test.ts
v2/validation-command-policy.*.test.ts
v2/execution.cascade.test.ts
v2/human-intervention-lifecycle.integration.test.ts
src/commands/status/*.test.ts
```

---

## Success metrics

- No manual JSON edits required to recover from common blocker states.
- No human-facing message dumps full compiler help output.
- No Deno command/test regressions in active TaskForge code/docs/tests.
- `/forge blocker` can recover a patched task and make `/forge execute` available.
- Event replay produces the same actionable state after restart.
- Full TaskForge test suite remains green under Node.

---

## Non-goals

- Replacing the v2 event-sourced architecture.
- Rewriting the full agent framework.
- Building a dashboard UI.
- Solving all possible shell command portability issues.
- Fully automating plan rewrites without user confirmation.

---

## Notes for self-hosted TaskForge runs

When using TaskForge to improve TaskForge itself:

- prefer small PRDs,
- use targeted validation commands,
- avoid global test-suite commands unless intentionally testing global behavior,
- keep output manifests conservative,
- avoid `(new)` unless the file is guaranteed not to exist,
- run Node tests only.
