# Foreman

Pi extension that builds a first version of a product from an idea, an intent, or a PRD, using
local models that can only run one at a time on a single GPU. See [SPEC.md](SPEC.md) for the design.

## Use

```text
/foreman plan <idea | path/to/prd.md>   Architect drafts foreman/plan.md and foreman/tasks.yaml
                                        (review and edit them by hand)
/foreman run                            Builder → tests → Reviewer → commit, task by task
/foreman status                         progress
/foreman unblock <task-id> [note]       retry a blocked task, optionally with guidance
/foreman pause                          stop after the current task
/foreman stop                           abort the running task now
```

Work is committed on a `foreman/<timestamp>` branch. You merge it yourself. Foreman never pushes.
A task that fails `limits.buildAttempts` times, or is interrupted, is blocked and everything behind
it waits until you `/foreman unblock` it.

## Configure

Everything lives in one file, `~/.pi/agent/foreman.json` (global), optionally overridden per project
by `.pi/foreman.json`. Copy `foreman.example.json` to start.

- `roles`: `architect`, `builder`, `reviewer`, each `{ "provider", "model", "thinking" }`. The Reviewer
  may be `{ "same_as": "builder" }`, which avoids a model swap on every task. Only the Builder is
  required; without an Architect, planning uses your current model.
- `modes`: the one model each of `ds4` and `qwen-flash` serves. Foreman reads the host's live mode
  (from the manager) on every `/foreman plan` and `/foreman run`: in `team` it uses `roles`; in `ds4` or
  `qwen-flash` it uses that mode's model for all three roles and takes the lease in that mode; in any other
  mode (studio, stop, maintenance) it refuses and tells you to switch the mode in the panel. It never
  switches the host away from what it is running. With only cloud models configured the mode is not consulted.
- `limits`, `gpu` (`managedProviders` lists the providers that need a `pi-inference` lease) and `notes`:
  facts about this machine that are passed to the Architect, such as a required Playwright version.

The model panel (Settings → Models → Team roles) edits the `roles` block of this file and keeps
everything else. `/foreman status` shows the effective models. Changes apply to the next command.
A Reviewer on a different model than the Builder means a model swap on every task.

## Develop

```bash
npm install
npm test           # node --test, no GPU needed
npm run typecheck
```
