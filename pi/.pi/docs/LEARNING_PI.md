# Learning Pi — Personal Reference

Personal notes compiled from exploration sessions.

---

## Table of Contents

1. [Themes](#themes)
2. [oh-pi Extension Suite](#oh-pi-extension-suite)
3. [Ant Colony — Multi-Agent Swarm](#ant-colony--multi-agent-swarm)
4. [Subagents — Chains & Parallel](#subagents--chains--parallel)
5. [Planning Mode](#planning-mode)
6. [Spec-Driven Development](#spec-driven-development)
7. [Settings — Global vs Project](#settings--global-vs-project)
8. [Editor Tips](#editor-tips)
9. [Dotfiles Setup](#dotfiles-setup)

---

## Themes

Available themes from `@ifi/oh-pi-themes`:

| Theme | Description |
|---|---|
| `cyberpunk` | Neon, high contrast |
| `nord` | Cool blue-grey ← current |
| `gruvbox-dark` | Warm retro |
| `tokyo-night` | Dark purple/blue |
| `catppuccin-mocha` | Soft pastel dark |
| `oh-p-dark` | oh-pi dark default |
| `dark` / `light` | Built-in pi defaults |

### Switching themes

**Via TUI:** `/settings` → Theme

**Via `settings.json`:**
```json
{ "theme": "tokyo-night" }
```

**Via CLI (one-off):**
```bash
pi --theme cyberpunk
```

---

## oh-pi Extension Suite

Installed packages and what they provide:

### `@ifi/oh-pi-extensions` — Core extensions

| Extension | What it does |
|---|---|
| `git-guard` | Warns before destructive git ops |
| `safe-guard` | *(disabled by default)* Prompts before risky shell commands |
| `auto-session-name` | Auto-names sessions from context |
| `compact-header` | Slimmer TUI header |
| `custom-footer` | Customizable status bar |
| `bg-process` | Tracks background processes |
| `usage-tracker` | Token/cost tracking per session |
| `scheduler` | `schedule_prompt` tool for reminders and recurring checks |
| `btw` / `qq` | `/btw` or `/qq` side-conversation without interrupting flow |
| `watchdog` / `safe-mode` | `/watchdog`, `/safe-mode` runtime protection |
| `auto-update` | Keeps oh-pi packages up to date |

### `@ifi/oh-pi-prompts` — Slash prompt shortcuts

`/review`, `/fix`, `/explain`, `/refactor`, `/test`, `/commit`, `/document`, `/optimize`, `/security`, `/pr`

### `@ifi/oh-pi-skills` — On-demand skill instructions

`web-search`, `web-fetch`, `debug-helper`, `git-workflow`, `context7`, `glassmorphism`, `claymorphism`, `neubrutalism`, `liquid-glass`, `grill-me`, `improve-codebase-architecture`, `request-refactor-plan`, `rust-workspace-bootstrap`, `flutter-serverpod-mvp`, `write-a-skill`, `btw`, `quick-setup`

### `@ifi/pi-web-remote` — Web session sharing ⚠️

`/remote` starts a local API server. **Currently broken** — the hosted UI at `pi-remote.dev` has no DNS record (domain not deployed yet). The API itself works:

```bash
TOKEN="your-token"
curl http://192.168.1.103:3100/api/health
curl -H "Authorization: Bearer $TOKEN" http://192.168.1.103:3100/api/session/messages
```

Fix when available: install `cloudflared` or `tailscale` for tunnel support — pi auto-detects them.

---

## Ant Colony — Multi-Agent Swarm

Multi-agent system where specialized ants work in parallel on a goal.

### Castes

| Caste | Role |
|---|---|
| **Scout** | Explores codebase, maps structure, identifies entry points |
| **Worker** | Does the actual implementation work (most ants are workers) |
| **Soldier** | Reviews quality, validates output, catches issues |
| **Drone** | Coordination/admin tasks |

### Worker classes (auto-classified by task keywords)

| Class | Keywords | Use case |
|---|---|---|
| `design` | ui, ux, css, figma, theme, color, typography, component | UI/styling work |
| `multimodal` | image, video, audio, vision, ocr, caption, embedding | Media/vision tasks |
| `review` | review, qa, validate, verify, audit, test, lint, check | Quality checks |
| `backend` | *(everything else)* | Default implementation |

### Commands

```
/colony                  ← launch a colony (prompts for goal)
/colony-status           ← check running colony progress
/colony-stop             ← stop the active colony
/colony-resume           ← resume a stopped colony
/colony-count <n>        ← set max concurrent ants
Ctrl+Shift+C             ← shortcut for /colony
```

### Model assignment

Model resolution order per ant:
1. Worker class model override (e.g., `designWorkerModel`)
2. `workerModel` fallback
3. Session default model

**Current setup:** No overrides configured — all ants use `anthropic/claude-sonnet-4-6`.

To set models per caste, ask pi to call `ant_colony` with overrides:
```
"use Opus for scout and soldier, Sonnet for workers"
```

Or pass directly:
```json
{
  "scoutModel": "anthropic/claude-opus-4-6",
  "soldierModel": "anthropic/claude-opus-4-6",
  "workerModel": "anthropic/claude-sonnet-4-6",
  "designWorkerModel": "google-antigravity/gemini-3.1-pro-high"
}
```

Model format: `provider/model-id`

### Workspace modes

| Mode | Behavior |
|---|---|
| **Worktree** (default) | Isolated git worktree — ants don't touch current branch |
| **Shared** | Ants work directly in current working directory |

---

## Subagents — Chains & Parallel

Delegate tasks to specialized agents with `/run`, `/chain`, `/parallel`.

```bash
/run scout "audit the codebase"
/chain scout "analyze auth" -> planner "design refactor" -> worker
/parallel scanner "find security issues" -> reviewer "check style"
/agents          # browse/manage agents in TUI overlay (Ctrl+Shift+A)
```

### Inline per-step overrides

```bash
/chain scout[model=anthropic/claude-opus-4-6] "deep scan" -> planner[reads=scan.md]
/run scout[output=context.md] "summarize"
/chain scout "analyze" -> planner --bg    # run in background
```

| Key | Example | Description |
|---|---|---|
| `output` | `output=context.md` | Write results to file |
| `reads` | `reads=a.md+b.md` | Read files before executing |
| `model` | `model=anthropic/claude-opus-4-6` | Override model for step |
| `skills` | `skills=planning+review` | Override skills |

### Agent scopes

| Scope | Location |
|---|---|
| Builtin | Bundled with package |
| User | `~/.pi/agent/agents/{name}.md` |
| Project | `~/.pi/agent/subagents/project-agents/<workspace>/agents/{name}.md` |

---

## Planning Mode

Structured plan-first workflow with file-backed state.

```
/plan              ← start planning (or open actions if already active)
Alt+P              ← toggle without sending text
/plan <file-path>  ← use specific file as plan
/plan <dir-path>   ← create timestamped plan in that dir
```

While active: persistent banner shows plan file path.

Exiting `/plan`: prefills editor with plan summary.

Override the default plan prompt globally:
```
~/.pi/agent/PLAN.prompt.md
```

---

## Spec-Driven Development

Spec-first workflow inspired by GitHub spec-kit, native in pi.

### Philosophy

Write requirements → plan → tasks → code. All state in version-controlled files in your repo.

### Scaffold layout (created by `/spec init`)

```
repo/
├── .specify/
│   ├── memory/
│   │   ├── constitution.md      # project governance & principles
│   │   └── pi-agent.md          # pi-native agent context
│   ├── templates/
│   │   ├── commands/            # workflow template per step (customizable)
│   │   └── *.md                 # file templates
│   └── extensions.yml
└── specs/
    └── 001-feature-name/        # auto-numbered from branch
        ├── spec.md
        ├── plan.md
        ├── tasks.md
        ├── research.md
        ├── data-model.md
        ├── quickstart.md
        ├── contracts/
        └── checklists/
```

### Workflow steps

| Step | Purpose |
|---|---|
| `constitution` | Project governance, principles, tech choices |
| `specify` | Natural language → formal spec, auto-creates branch + dir |
| `clarify` | Up to 5 critical questions (scope > security > UX > tech) |
| `checklist` | Quality checklists for requirement validation |
| `plan` | Technical design: research, data model, contracts |
| `tasks` | Break plan into independently testable user stories |
| `analyze` | Read-only design analysis |
| `implement` | Execute tasks, mark `[x]` as done, checklist-gated |

### Commands

```
/spec init
/spec constitution <principles>
/spec specify <feature description>
/spec clarify [focus]
/spec checklist [domain]
/spec plan <technical context>
/spec tasks [context]
/spec analyze [focus]
/spec implement [focus]
/spec status
/spec next
/spec list
/spec help
```

### Key design decisions

- **Templates are yours after init** — `.specify/templates/` is never overwritten
- **Branch = active feature** — active feature detected from git branch name
- **Checklist-gated implement** — warns on incomplete checklists (overridable)
- **No external scripts** — pi uses its own tools (read, edit, write, bash)

### Example flow

```bash
/spec init
/spec constitution "TypeScript, PostgreSQL, React. Must have automated tests."
/spec specify "Add user authentication with email/password and OAuth2"
/spec clarify
/spec checklist security
/spec plan "Auth backend with JWT, frontend login form, rate limiting"
/spec tasks
/spec implement
```

---

## Settings — Global vs Project

### Two scopes

| File | Scope | When active |
|---|---|---|
| `~/.pi/agent/settings.json` | Global — all projects | Always |
| `.pi/settings.json` | Project — this repo only | When pi runs in/under that dir |

Pi loads both and **merges** them. Project settings win on conflicts. Nested objects are deep-merged.

### Merge example

```json
// ~/.pi/agent/settings.json
{ "theme": "nord", "compaction": { "enabled": true, "reserveTokens": 16384 } }

// .pi/settings.json (project)
{ "compaction": { "reserveTokens": 8192 } }

// effective result in that project
{ "theme": "nord", "compaction": { "enabled": true, "reserveTokens": 8192 } }
```

### Rule of thumb

- **`~/.pi/agent/settings.json`** = personal defaults, goes in dotfiles
- **`.pi/settings.json`** = repo-specific overrides, can be committed to that repo

### Override the agent dir

```bash
export PI_CODING_AGENT_DIR="$HOME/.config/pi-agent"
```

---

## Editor Tips

### Word navigation (built-in)

| Action | Keys |
|---|---|
| Word left | `Alt+Left`, `Ctrl+Left`, `Alt+B` |
| Word right | `Alt+Right`, `Ctrl+Right`, `Alt+F` |
| Line start | `Ctrl+A` |
| Line end | `Ctrl+E` |
| Delete word left | `Ctrl+W`, `Alt+Backspace` |
| Delete word right | `Alt+D` |
| Delete to line start | `Ctrl+U` |
| Delete to line end | `Ctrl+K` |
| Multi-line | `Shift+Enter` |

### External editor — `Ctrl+G`

Opens current input in `$VISUAL` / `$EDITOR`. Full editor power, mouse support, etc. Content returns to pi on save+quit.

```bash
# ~/.zshrc
export VISUAL=nvim
export EDITOR=nvim
```

### File references

Type `@` in editor to fuzzy-search and insert a file reference. Pi reads the file and includes it in the message.

### Reusable prompts

Put templates in `~/.pi/agent/prompts/`:

```markdown
<!-- ~/.pi/agent/prompts/mycommand.md -->
Do X with this context: $ARGUMENTS
```

Use as `/mycommand some detail`.

### Pipe content from shell

```bash
cat file.ts | pi -c           # continue last session with file as input
pi "explain: $(cat foo.ts)"
pi --dir ~/dotfiles           # start with specific working directory
```

---

## Dotfiles Setup

Pi config managed via GNU Stow in `~/dotfiles/pi/`.

### What's tracked

```
dotfiles/pi/
├── .gitignore
└── .pi/
    ├── docs/
    │   └── LEARNING_PI.md        # ← this file
    └── agent/
        ├── settings.json
        ├── models.json
        ├── keybindings.json
        ├── pi-sub-bar-settings.json
        └── extensions/
            └── auto-router.ts
```

### What's gitignored

```
.pi/agent/auth.json             # credentials
.pi/agent/sessions/             # session history
.pi/agent/scheduler/            # runtime state
.pi/agent/cache/                # cache
.pi/agent/git/                  # cloned packages
.pi/agent/npm/                  # installed npm packages
.pi/agent/pi-crash.log
.pi/agent/usage-tracker-*.json
```

### New machine setup

```bash
git clone <dotfiles-repo> ~/dotfiles
cd ~/dotfiles
stow pi        # creates all ~/.pi symlinks
pi update      # installs all packages listed in settings.json
pi             # ready
```

### Adding new files to track

```bash
# create/move file into dotfiles package
mv ~/.pi/agent/AGENTS.md ~/dotfiles/pi/.pi/agent/

# restow (safe, only adds missing links)
cd ~/dotfiles && stow pi

# commit
git -C ~/dotfiles add pi/ && git -C ~/dotfiles commit -m "..."
```
