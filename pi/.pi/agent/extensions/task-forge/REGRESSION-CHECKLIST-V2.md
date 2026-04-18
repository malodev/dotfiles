# TaskForge V2 Regression Checklist

_Last updated: 2026-04-13_

Use this checklist after any meaningful refactor step, especially when changing:
- `index.ts`
- scope/closure boundaries
- `v2/adapters.ts`
- `v2/runner.ts`
- task lifecycle modules under `v2/`
- command/session wiring

This checklist exists because the refactor has already produced at least one real regression:
- `Extension "command:forge" error: loadConfig is not defined`

That regression was caused by moving helpers outside the extension closure while leaving `loadConfig`, `config`, and `state` inside it.

---

## Minimum regression gate

## 1. Scope sanity check
Before runtime testing, inspect for accidental scope leaks.

Look for helpers outside `export default function (pi) { ... }` that still reference closure-bound symbols such as:
- `config`
- `state`
- `runAbortController`
- `pi`
- `loadConfig(...)`
- other helpers defined only inside the extension closure

If a helper is outside the closure, it must not depend on closure-only state unless that state is explicitly passed in.

---

## 2. Command smoke tests
After loading/reloading the extension, verify these commands do not throw extension errors:

- `/forge status`
- `/forge help`
- `/forge config`

If relevant and safe, also verify:
- `/forge models`

Minimum pass condition:
- no `Extension "command:forge" error: ...`
- especially no `loadConfig is not defined`

---

## 3. Planning smoke test
If planning/session wiring changed, verify a plan can start without immediate extension failure.

Suggested smoke flow:
- run `/forge <some-prd-file>` in a safe workspace
- verify TaskForge enters planning/approval flow without command-level crash

If you cannot run this, record that it was skipped in `WORKLOG-V2.md`.

---

## 4. Execution-path smoke test
If task execution modules changed, verify at minimum that these commands do not immediately crash:
- `/forge execute`
- `/forge pause`
- `/forge resume`
- `/forge abort`
- `/forge status`

If a safe test workspace is available, perform a real execution-path smoke test.
If not, record the limitation in `WORKLOG-V2.md`.

---

## 5. Documentation memory update
If a regression is found:
- record it in `WORKLOG-V2.md`
- update `REFACTOR-ROADMAP-V2.md` if it changes the next checkpoint or blocks progress
- update `CONTINUE-V2-PROMPT.md` if future agents need to watch for it explicitly

---

## Session-close rule
Do not treat a refactor step as complete until this checklist has been run or explicitly skipped with a reason recorded in `WORKLOG-V2.md`.
