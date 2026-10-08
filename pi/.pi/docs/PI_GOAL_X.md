# pi-goal-x — goal runtime for pi

Adds `/goal` and friends to pi: you state an outcome once, the agent turns it into an
objective plus a task tree, keeps working on it automatically across turns and sessions,
and a **separate agent audits the result** before the goal is accepted.

- **Package:** `npm:pi-goal-x` (installed in `~/.pi/agent/settings.json` → `packages`)
- **Source:** https://github.com/tmonk/pi-goal-x
- **Local copy:** `~/.pi/agent/npm/node_modules/pi-goal-x/` (`extensions/goal.ts`, `docs/`)
- **State:** `<cwd>/.pi/goals/` — per project, not global

```bash
pi install npm:pi-goal-x      # install
pi remove  npm:pi-goal-x      # remove
```

---

## Table of contents

1. [Mental model](#mental-model)
2. [Typical use](#typical-use)
3. [Regular vs ordered goals](#regular-vs-ordered-goals)
4. [Commands](#commands)
5. [Dashboard and keys](#dashboard-and-keys)
6. [Settings worth knowing](#settings-worth-knowing)
7. [State, storage, and worktrees](#state-storage-and-worktrees)
8. [Gotchas](#gotchas)
9. [Diagnostics and recovery](#diagnostics-and-recovery)

---

## Mental model

It is not another agent. It is a runtime layered on the normal pi session, with four roles:

| Role | Responsibility |
| --- | --- |
| You | Own intent. Start, pause, resume, focus, clear, tweak goals. |
| Executing agent | Works the focused goal with its normal tools; reports terminal outcomes. |
| Auditor agent | An independent in-memory pi session that checks whether a completion claim actually satisfies the goal. |
| Runtime | Goal state, tool surface, prompts, ledger, dashboard widget, auto-continuation. |

The user owns intent; the executing agent does the work; the auditor independently verifies;
the runtime coordinates and records.

Tools the model gets: `create_goal`, `get_goal`, `update_goal`, `set_goal_tasks`,
`update_goal_task`. In a fresh session with no goal focused, only `create_goal` and `get_goal`
are advertised; the rest appear with an active goal. During a guided draft they are replaced by
`goal_question`, `goal_questionnaire`, and `propose_goal_draft`. Ordinary work tools
(`read`, `edit`, `bash`, …) are never touched by the extension.

---

## Typical use

Say you have a pending chore: the Karabiner-Elements rules live only in
`~/.config/karabiner/karabiner.json`, which is not tracked.

```
/goal Add the Karabiner-Elements rules to dotfiles. The Option+Shift+N window-move
and Option+HJKL focus/swap/fill rules currently live only in ~/.config/karabiner/
karabiner.json, which is not tracked. Track them, add a README section explaining
the SE/event-tap reasoning, and make sure `stow karabiner` links them correctly on
a fresh machine.
```

**1. Draft.** You are in a temporary draft profile — the agent asks focused questions instead of
starting work (e.g. "both Karabiner profiles, or only the active one?", "README in the package or
in the root docs?").

**2. Proposal.** One confirmation dialog with the full objective *and* the task tree, plus optional
completion requirements:

```
Add Karabiner rules to dotfiles
├─ Inspect karabiner.json and identify machine-specific parts
├─ Add karabiner/.config/karabiner/karabiner.json to the repo
├─ Document the SE / HID-layer reasoning
└─ Verify stow links it
Completion requirement: `stow -n karabiner` reports no conflicts, and no
API-key-like or per-machine values are committed.
```

Pick **Confirm** (creates and focuses the goal atomically) or **Continue Chatting** (keeps the
draft).

**3. Work.** The agent works normally, tracking progress through `set_goal_tasks` /
`update_goal_task`. When a turn ends productively the runtime **auto-continues** — you do not
re-prompt. That is the whole point versus plain chat.

**4. Steer mid-flight.** `Esc` pauses. `/goal-tweak also add a check that karabiner.json has no
absolute paths` revises the plan through a confirmation. `/goal-pause` and `/goal-resume` stop and
restart. If it needs a decision from you it goes `blocked` and waits there.

**5. Completion and audit.** The agent calls `update_goal(complete)`; an independent pi agent
session then reviews the objective, tasks, recorded evidence, completion requirements, and the
actual workspace. Approved → archived. Rejected → the goal stays open with feedback about the
unmet requirement.

**6. Later sessions.** `/goal-list` shows open goals, `/goal-focus` switches, `/goal-status
verbose` shows storage location and effective settings.

### When it fits

Good: multi-step work you would otherwise babysit across turns, work you will resume tomorrow,
work where "done" is checkable (tests pass, report has every required section) — that is what
lets the auditor say something meaningful.

Poor: one-shot questions, exploratory "look into X" with no definable end, or work where you want
to approve every step.

---

## Regular vs ordered goals

| | Command | Use for |
| --- | --- | --- |
| Regular | `/goal [idea]` | Outcomes where the agent should choose and adapt the plan — features, debugging, research, docs |
| Sisyphus | `/sisyphus <ordered steps>` | A fixed sequence you do not want re-planned — migrations, staged refactors, release procedures |

`/goal-direct <objective>` and `/sisyphus-direct <objective>` skip the draft and start immediately.
Use `/sisyphus-direct` when you already have the ordered steps.

---

## Commands

| Command | What it does |
| --- | --- |
| `/goal [idea]` | Discuss, plan, confirm a regular goal |
| `/sisyphus [idea]` | Discuss, plan, confirm an ordered goal |
| `/goal-direct <objective>` | Create and start a regular goal immediately |
| `/sisyphus-direct <objective>` | Create and start an ordered goal immediately |
| `/goal-list` | List open goals |
| `/goal-status` | Show the focused goal and its progress (`verbose`, `health` sub-forms) |
| `/goal-focus` | Choose an open goal to work on |
| `/goal-unfocus` | Leave the goal open without focusing on it |
| `/goal-tweak <change>` | Revise the current goal with the agent |
| `/goal-pause` / `/goal-resume` | Stop / restart work |
| `/goal-clear` | Archive the focused goal after confirmation |
| `/goal-cancel` | Cancel an unconfirmed draft |
| `/goal-settings` | Configure goal behaviour and the auditor |
| `/goal-recovery` | Check for problems; `repair` offers repairs after confirmation |
| `/goal-refresh` | Reload saved goals and settings after external changes |

These are TUI commands. In `pi --print` they produce no output, so verification has to happen in an
interactive session (or through the model tools).

---

## Dashboard and keys

The dashboard above the editor shows status, task progress, current task, elapsed time, and token
usage. Audit progress and results appear there too.

| Key | Action |
| --- | --- |
| `Ctrl+Shift+T` | Expand the dashboard: full task tree, completion requirements, evidence, recent activity |
| `Ctrl+Shift+A` | Toggle auditing for the focused goal |
| `Esc` | Pause active work (in the expanded dashboard: collapse the view) |

Token usage shown is cumulative across goal turns.

---

## Settings worth knowing

`/goal-settings` changes these; you can save defaults for all projects, override per project, or
remove an override to inherit. The same values can live in `.pi/pi-goal-x-settings.json`.

| Setting | What it controls |
| --- | --- |
| `maxAutonomousRuns` | Extension-started runs per creation or `/goal-resume` period. **Unset means unlimited; `0` disables automatic continuation.** Editing it does not reset usage; `/goal-resume` renews the period. |
| `strictExecutionContract` | Opt-in ready/wait protocol: one missing-decision repair, then pause. Defaults to `false`. New `wait` declarations require this mode. |
| `disableTasks` | Turn task lists off |
| `subtaskDepth` | Limit subtask nesting |
| `disableContracts` | Turn goal and task completion requirements off |
| `hideUnfocusedPrompt` | Stop the `[PI GOAL UNFOCUSED]` reminder when a session has no focused goal but open goals exist |
| Auditor disabled / provider / model / thinking level | Who reviews completed work, and how hard it thinks |

Token budgets are changed through the tweak flow, not directly:

```
/goal-tweak set the token budget to 50000
/goal-tweak remove the token budget
```

A budget is a **total lifetime limit**, not an extra allocation; consumed tokens and completed
work are preserved. A goal stopped only by its budget can resume after the limit is raised.

---

## State, storage, and worktrees

Default root: `<cwd>/.pi/goals`, holding:

```text
.pi/goals/active_goal_<timestamp>_<id>.md     # one file per open goal
.pi/goals/archived/goal_<timestamp>_<id>.md   # archived goals
.pi/goals/goal_events.jsonl                   # append-only ledger, 18 event types
.pi/goals/.locks/                             # goal locks
.pi/goals/.metadata/                          # pool snapshot
```

Each goal file carries extension-owned metadata plus a user-editable `# Goal Prompt`
section. The runtime re-reads the focused file before acting, so an external edit wins over
stale in-memory state. The ledger is never rewritten in place and feeds auditor-rejection
memory and compaction summaries.

Because the root is per working directory, `.pi/goals/` reappears in every repo you use
`/goal` in.

- Add `.pi/goals/` to `.gitignore` in repos where you use goals.
- Aim several worktrees at one pool with `goalsRoot` (project or global settings) or the
  `PI_GOAL_ROOT` environment variable. Precedence: environment → project → global → default.
  Existing goals are not moved automatically; reopen the session or run `/goal-refresh` after
  changing roots. Focus stays session-local.
- `/goal-status verbose` prints the effective storage location.

---

## Gotchas

- **Auto-continuation is unlimited by default.** The agent will keep starting runs toward the
  goal without asking. Cap it in `/goal-settings` (for example `maxAutonomousRuns: 20`).
- **Unproductive loops are possible.** Run limits and token budgets are the guards.
- **The auditor costs a model call** and is an independent session — it can reject work you
  thought was finished. That is the feature, but it is not free.
- **Waits need pi open.** Timer-driven waits only fire while pi is running, and a wait belongs to
  the session that declared it; another session needs an explicit resume.
- **`blocked` is user-owned.** Recovery from a blocker is yours, not the runtime's.
- **State is invisible to git by default.** See the `.gitignore` note above.

---

## Diagnostics and recovery

```
/goal-status            # focused goal and progress
/goal-status verbose    # effective settings + storage location
/goal-status health     # problem check
/goal-recovery          # problem check
/goal-recovery repair   # offers repairs, asks before applying
/goal-refresh           # reload saved goals and settings
```
