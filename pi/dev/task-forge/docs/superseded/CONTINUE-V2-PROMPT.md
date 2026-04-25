# Continue TaskForge V2 Refactor — Clean Session Prompt

Use this prompt when starting from a clean session and continuing the TaskForge rewrite.

---

You are continuing the **TaskForge V2 refactor** in:

- `/Users/mauro/dotfiles/pi/.pi/agent/extensions/task-forge`

Git repo root:

- `/Users/mauro/dotfiles`

## First read these files in this order

1. `pi/.pi/agent/extensions/task-forge/REFACTOR-ROADMAP-V2.md`
2. `pi/.pi/agent/extensions/task-forge/WORKLOG-V2.md`
3. `pi/.pi/agent/extensions/task-forge/ARCHITECTURE-V2.md`
4. `pi/.pi/agent/extensions/task-forge/REGRESSION-CHECKLIST-V2.md`

Treat them as follows:
- `REFACTOR-ROADMAP-V2.md` = where we are going
- `WORKLOG-V2.md` = what has been done and why
- `ARCHITECTURE-V2.md` = target architecture
- `REGRESSION-CHECKLIST-V2.md` = regression gate before considering a refactor step complete

If they disagree:
- follow `REFACTOR-ROADMAP-V2.md` for implementation order
- use `WORKLOG-V2.md` for historical choices and resolved problems
- use `ARCHITECTURE-V2.md` for structural intent and invariants

## Current rewrite state

The V2 durable/event-sourced core already exists.
A large part of the execution-path bridge has already been extracted into `v2/` modules.
`index.ts` is smaller than before, but it still contains several concrete implementations and some adapter glue.

Already extracted into `v2/` include:
- durable core: `types.ts`, `events.ts`, `derive.ts`, `storage.ts`, `engine.ts`, `migrate.ts`, `preflight.ts`
- execution model: `execution.ts`, `executor.ts`, `runner.ts`
- bridge/adapters: `bridge.ts`, `launcher.ts`, `review.ts`, `adapters.ts`, `command-adapter.ts`
- task lifecycle: `task-executor.ts`, `task-failure.ts`, `task-diagnostic.ts`, `task-success.ts`, `task-runner.ts`
- validation/reviewer helpers: `validation.ts`, `gate-review.ts`, `diagnostic-review.ts`
- supervision: `supervisor.ts`

Known regression lesson from the refactor so far:
- `Extension "command:forge" error: loadConfig is not defined`
- cause: helpers depending on closure state were moved outside the extension closure
- implication: after scope/module changes, run `REGRESSION-CHECKLIST-V2.md`

## Current likely next step

Unless the roadmap was updated after this prompt was written, the next planned checkpoint is:

- run live `/forge` regression smoke checks in a safe workspace and fix any runtime gaps found

Likely focus areas:
- `/forge status`
- `/forge execute`
- `/forge resume`
- `/forge abort`
- planning smoke flow from `/forge <prd>` through approval

## Important constraints

- Preserve existing `/forge` UX.
- Prefer extraction over adding more branches inside `index.ts`.
- Keep V2 authoritative whenever possible.
- Use typed helper/result surfaces instead of loose mutable control flow.
- Do not touch unrelated repository changes.
- Use Conventional Commits for checkpoint commits.
- Keep Anthropic as fallback-only; prefer the existing OpenAI-first routing policy.

## Files to update before ending the session

If you make meaningful progress, update all three:

1. `REFACTOR-ROADMAP-V2.md`
   - update milestone state, remaining steps, or next checkpoint if needed

2. `WORKLOG-V2.md`
   - update `Latest checkpoint`
   - record what changed
   - record design choices made
   - record problems encountered and how they were resolved

3. `ARCHITECTURE-V2.md`
   - update only if module boundaries, invariants, or target architecture meaningfully changed

If useful, also update:
- `README.md`
- `CHANGELOG.md`

## Good continuation pattern

1. Read the three docs above.
2. Inspect current `index.ts` and relevant `v2/` modules.
3. Extract one coherent boundary at a time.
4. Keep changes checkpoint-sized.
5. After each meaningful extraction:
   - update roadmap/worklog/architecture docs
   - summarize what moved and what remains

## Definition of success for the session

A good continuation session should:
- reduce `index.ts`
- move logic into `v2/`
- preserve behavior
- improve typed boundaries
- leave updated file-based memory for the next clean session

## Session close checklist

Before ending the session, do this:

1. Update `REFACTOR-ROADMAP-V2.md`
   - milestone progress
   - next checkpoint
   - remaining steps if they changed

2. Update `WORKLOG-V2.md`
   - `Latest checkpoint`
   - what changed
   - why it changed
   - problems resolved and how

3. Update `ARCHITECTURE-V2.md`
   - only if architectural boundaries or invariants changed

4. If the handoff assumptions changed, update `CONTINUE-V2-PROMPT.md`

5. If the user-facing structure changed, update `README.md` and optionally `CHANGELOG.md`

6. Run `REGRESSION-CHECKLIST-V2.md`
   - or explicitly record in `WORKLOG-V2.md` why live smoke checks were skipped

7. Leave a short summary stating:
   - what was finished
   - what remains next
   - whether the roadmap next step changed
