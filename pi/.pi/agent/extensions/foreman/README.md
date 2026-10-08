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
/foreman models [role=provider/model …] choose the models for architect, builder and reviewer on this host
/foreman preview [stop]                 open the app being built in your browser
/foreman recordings [task-id]           open the videos and screenshots kept from test runs
/foreman pause                          stop after the current task
/foreman stop                           abort the running task now
```

Work is committed on a `foreman/<timestamp>` branch. You merge it yourself. Foreman never pushes.
A task that fails `limits.buildAttempts` times, or is interrupted, is blocked and everything behind
it waits until you `/foreman unblock` it.

## The progress panel

While a run is going (and after it ends) a boxed panel sits above the editor: a header with the run state,
total time, done/open counts and a progress bar; the task list with icons (`✓` done, `▸` running, `✖` blocked,
`·` pending) that collapses to `… +N more` around the current task; then what is happening now (phase, its
elapsed time, the latest output line), the commands that verify the current task, the preview link and the
files to look at. It redraws to the terminal's width. The layout is borrowed from the pi-goal-x panel.

## Watching the UI

- **Preview** (`/foreman preview`): the app the Architect described in `foreman/preview.json` runs in the
  sandbox with the repository mounted read-only, on its own port and with its own data folder, and opens in
  your browser (the address is also printed as `Open: http://127.0.0.1:<port>`, and stays in the progress panel and `/foreman status` while it runs). It follows the Builder's saved files: refresh the page, and the app restarts by itself
  (after a short pause) whenever a source file changes. It can show half-finished work. Your clicking
  cannot disturb the tests, which use a different port and data. `/foreman preview stop` ends it.
- **Recordings** (`/foreman recordings [task-id]`): after each task's success tests, videos, screenshots
  and traces written to `test-results/` are copied to `foreman/.run/artifacts/<task>-attempt<N>/`, with an
  `index.html` that plays them. They are never committed. The progress panel says when they were recorded.
- The test browser itself runs headless inside the sandbox and is not shown live.

## Choosing models on any host

`/foreman models` sets the role models on the host where pi runs, and creates `~/.pi/agent/foreman.json`
if it does not exist. It needs no panel, so it is how you configure a remote host.

- **Menu** (`/foreman models` with no arguments, in an interactive pi): for each role it asks for a filter
  word (for example `sol` or `qwen flash`), lists the matching models, then asks for the thinking level
  that model supports. It lists only models this host's pi can use, so it never offers one you are not
  logged in to.
- **One line:** `/foreman models architect=openai-codex/gpt-… builder=qwen-flash/malos/… reviewer=same`.
  Add `:high` (or another level) to a model for its thinking level. `reviewer=same` uses the builder's model.
- **`--project`** writes `.pi/foreman.json` for the current project instead of the global file. A project
  file wins over the global one, so Foreman tells you when a project file would hide your change.
- It keeps every other setting in the file, refuses to touch a file that is not valid JSON, and refuses
  models this host does not have or local models that need two different GPU modes.

Models can be mixed: for example a cloud model for the Architect and Reviewer and a local model on this
machine for the Builder. Cloud roles need nothing from the GPU host; a local role needs the host in the
mode that serves it (`pi-llama` needs team, `ds4` needs ds4, `qwen-flash` needs qwen-flash), and Foreman
says which role is the problem if it is not. At the start of `/foreman plan` and `/foreman run` it checks
that every role's model exists in this host's pi, so a host that is logged in differently fails early
and clearly instead of after the Builder has worked.

## Configure

Everything lives in one file, `~/.pi/agent/foreman.json` (global), optionally overridden per project
by `.pi/foreman.json`. Copy `foreman.example.json` to start, or let `/foreman models` create it.

- `selection`: `"local"` (the roles follow the host mode, as the panel's local view does) or `"mixed"`
  (the roles are used exactly as written, cloud and local together). `/foreman models` writes `"mixed"`.
- `roles`: `architect`, `builder`, `reviewer`, each `{ "provider", "model", "thinking" }`. The Reviewer
  may be `{ "same_as": "builder" }`, which avoids a model swap on every task. Only the Builder is
  required; without an Architect, planning uses your current model.
- `modes`: the one model each of `ds4` and `qwen-flash` serves, used for all three roles when
  `selection` is `"local"` and the host is in that mode.
- `limits`, `gpu` (`managedProviders`; `providerModes` maps each local provider to the host mode that
  serves it) and `notes`: facts about this machine that are passed to the Architect, such as a required
  Playwright version.

The model panel (Settings → Models → Team roles) edits the `roles` block of this file on the GPU host and
keeps everything else. `/foreman status` shows the effective models. Changes apply to the next command.
A Reviewer on a different model than the Builder means a model swap on every task.

## Develop

```bash
npm install
npm test           # node --test, no GPU needed
npm run typecheck
```
