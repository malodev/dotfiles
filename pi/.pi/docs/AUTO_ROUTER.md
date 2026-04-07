# Auto-Router Extension

Automatic model routing for pi based on prompt analysis.

- **File:** `~/.pi/agent/extensions/auto-router.ts`
- **Loaded:** automatically at startup (auto-discovery)
- **Status bar:** shows the active route label in the footer

---

## How it works

The extension operates in two **modes** and exposes a toggle to switch between them.

### Mode `local` (default)

On every interactive prompt, the extension reads the text **before** it reaches the agent, classifies the task via keyword matching, and calls `pi.setModel()` + `pi.setThinkingLevel()` to switch to the best model. If the primary provider is unavailable or has no API key, it tries the next candidate in the fallback chain automatically.

```
user types prompt
       │
       ▼
  input event (extension intercepts)
       │
       ▼
  classifyTask(prompt) → route name
       │
       ▼
  applyRoute() → tries candidates[0], [1], [2] … until one succeeds
       │
       ▼
  pi.setModel() + pi.setThinkingLevel()
       │
       ▼
  agent runs with the selected model
```

### Mode `orauto`

The model is set **once** to `openrouter/auto` (2M context, 30K output). From that point on, every prompt is sent to OpenRouter which selects the best available model server-side using its own routing logic. The extension's `input` handler becomes a no-op — no keyword matching, no `setModel()` calls.

```
/route mode orauto
       │
       ▼
  pi.setModel(openrouter/auto)   ← done once
       │
  user types any prompt
       │
       ▼
  OpenRouter picks model internally
       │
       ▼
  agent runs with OR-selected model
```

Switch back at any time with `/route mode local`.

Routing is **skipped** for:
- Slash commands (`/route`, `/model`, etc.)
- Non-interactive sources (RPC, extension-injected messages)
- When auto-routing is toggled OFF
- When mode is `orauto` (OpenRouter handles it)

---

## Routes

### 🔴 `surgical` — Refactoring & deep debugging
**Thinking:** `high`

Triggered by: `refactor`, `architect`, `redesign`, `migration`, `legacy`, `ristruttura`, `race condition`, `deadlock`, `memory leak`, `security audit`, `vulnerability`, `multi-file`, `cross-module`, `breaking change`, `review critica`, `analisi codice complessa`

| Priority | Provider | Model |
|----------|----------|-------|
| 1 | `anthropic` | `claude-opus-4-6` |
| 2 | `github-copilot` | `claude-opus-4.6` |
| 3 | `google-antigravity` | `claude-opus-4-6-thinking` |
| 4 | `openrouter` | `anthropic/claude-opus-4.6` |

---

### 🔴 `general` — Agentic workflows & reasoning
**Thinking:** `medium`

Triggered by: `computer use`, `gui`, `desktop`, `automation`, `browser`, `playwright`, `selenium`, `agent`, `workflow`, `multi-step`, `orchestr`, `pipeline complessa`, `ragiona`, `reason`, `analisi profonda`, `spiega perché`

| Priority | Provider | Model |
|----------|----------|-------|
| 1 | `openai-codex` | `gpt-5.4` |
| 2 | `github-copilot` | `gpt-5.4` |
| 3 | `openrouter` | `openai/gpt-5.4` |

---

### 🟡 `daily` — Everyday coding *(default)*
**Thinking:** `medium`

Triggered by: everything that does not match a more specific route.

| Priority | Provider | Model |
|----------|----------|-------|
| 1 | `anthropic` | `claude-sonnet-4-6` |
| 2 | `github-copilot` | `claude-sonnet-4.6` |
| 3 | `google-antigravity` | `claude-sonnet-4-6` |
| 4 | `openrouter` | `anthropic/claude-sonnet-4.6` |

---

### 🟡 `polyglot` — Multi-language & tool coordination
**Thinking:** `medium`

Triggered by: `python.*typescript`, `rust.*go`, `java.*kotlin`, `multiple languages`, `polyglot`, `converti/convert/translate/transpile/port … da/from/to`, `mcp`, `tool coordination`, `multi-tool`

| Priority | Provider | Model |
|----------|----------|-------|
| 1 | `google-antigravity` | `gemini-3.1-pro-high` |
| 2 | `openrouter` | `google/gemini-3.1-pro-preview` |
| 3 | `github-copilot` | `gemini-3.1-pro-preview` |

---

### 🟢 `terminal` — Shell, CI/CD, DevOps
**Thinking:** `off`

Triggered by: `bash`, `shell`, `terminal`, `chmod`, `chown`, `grep`, `sed`, `awk`, `curl`, `wget`, `docker`, `compose`, `kubernetes`, `k8s`, `helm`, `ci/cd`, `pipeline`, `github actions`, `deploy`, `nginx`, `apache`, `systemctl`, `cron`, `ssh`, `scp`, `makefile`, `cmake`, `cargo build`, `npm run`, `yarn`, `pnpm`, `git rebase/bisect/cherry/stash/merge/conflict`

| Priority | Provider | Model |
|----------|----------|-------|
| 1 | `openai-codex` | `gpt-5.3-codex` |
| 2 | `github-copilot` | `gpt-5.3-codex` |
| 3 | `openrouter` | `openai/gpt-5.3-codex` |

---

### 🟢 `speed` — Boilerplate & simple tasks
**Thinking:** `off`

Triggered by: `boilerplate`, `scaffold`, `genera`, `template`, `stub`, `placeholder`, `semplice`, `simple`, `quick`, `fast`, `veloce`, `rapido`, `banale`, `crea componente`, `genera file`, `init`, `starter`

| Priority | Provider | Model |
|----------|----------|-------|
| 1 | `openrouter` | `x-ai/grok-4.1-fast` |

---

### 🎨 `uiux` — UI/UX & frontend components
**Thinking:** `medium`

Triggered by: `figma`, `mockup`, `wireframe`, `prototype`, `sketch`, `ui`, `ux`, `user interface`, `user experience`, `design system`, `landing page`, `hero`, `banner`, `card`, `modal`, `sidebar`, `navbar`, `footer`, `css`, `tailwind`, `styled-components`, `emotion`, `sass`, `scss`, `animation`, `transition`, `hover`, `responsive`, `breakpoint`, `color palette`, `typography`, `font`, `spacing`, `layout`, `grid`, `flexbox`, `dark mode`, `light mode`, `theme`, `brand`, `visual`

| Priority | Provider | Model |
|----------|------------|-------|
| 1 | `openai-codex` | `gpt-5.4` |
| 2 | `github-copilot` | `gpt-5.4` |
| 3 | `openrouter` | `qwen/qwen3.6-plus:free` |
| 4 | `openrouter` | `openai/gpt-5.4` |
| 5 | `anthropic` | `claude-sonnet-4-6` |

> **Why:** GPT-5.4 leads BridgeBench UI Bench and has native computer use (can see rendered output). Qwen 3.6 Plus is #2 on UI generation benchmarks and is free. Claude Sonnet 4.6 as final fallback for its strong instruction-following on design specs.

---

### 🔵 `budget` — Docs, tests, formatting
**Thinking:** `medium`

Triggered by: `docstring`, `jsdoc`, `comment`, `readme`, `documentation`, `documenta`, `unit test`, `test case`, `spec`, `jest`, `vitest`, `pytest`, `coverage`, `format`, `lint`, `prettier`, `eslint`, `rubocop`, `black`, `traduc`, `i18n`, `localiz`

| Priority | Provider | Model |
|----------|----------|-------|
| 1 | `openrouter` | `deepseek/deepseek-v3.2` |

---

### 🔵 `explore` — Long-context exploration *(manual only)*
**Thinking:** `medium`

Use `/route explore` to activate. Good for throwing an entire repo into context for free-form analysis.

| Priority | Provider | Model |
|----------|----------|-------|
| 1 | `opencode-go` | `kimi-k2.5` |
| 2 | `openrouter` | `moonshotai/kimi-k2.5` |

---

### 🔵 `glm` — Long-horizon planning *(manual only)*
**Thinking:** `medium`

Use `/route glm` to activate. GLM-5 leads YC-Bench (long-horizon planning simulation).

| Priority | Provider | Model |
|----------|----------|-------|
| 1 | `opencode-go` | `glm-5` |

---

## Commands

| Command | Description |
|---------|-------------|
| `/route` | Show current status: auto-routing on/off and active route |
| `/route toggle` | Toggle auto-routing ON / OFF |
| `/route mode` | Show current routing mode (`local` or `orauto`) |
| `/route mode local` | Use local keyword-based classification (default) |
| `/route mode orauto` | Delegate all routing to `openrouter/auto` |
| `/route list` | List all routes with their label and provider chain |
| `/route surgical` | Force Opus 4.6 and disable auto-routing |
| `/route daily` | Force Sonnet 4.6 and disable auto-routing |
| `/route general` | Force GPT-5.4 and disable auto-routing |
| `/route terminal` | Force GPT-5.3-Codex and disable auto-routing |
| `/route polyglot` | Force Gemini 3.1 Pro and disable auto-routing |
| `/route speed` | Force Grok 4.1 and disable auto-routing |
| `/route budget` | Force DeepSeek V3.2 and disable auto-routing |
| `/route explore` | Force Kimi K2.5 and disable auto-routing |
| `/route uiux` | Force GPT-5.4 / Qwen 3.6 Plus and disable auto-routing |
| `/route glm` | Force GLM-5 and disable auto-routing |

> **Note:** forcing a route via `/route <name>` disables auto-routing so the model stays fixed. Use `/route toggle` to re-enable it.

---

## Manual model cycling (Ctrl+P)

The `enabledModels` list in `settings.json` defines the 13 models available for `Ctrl+P` / `Shift+Ctrl+P` cycling:

```
anthropic/claude-opus-4-6
anthropic/claude-sonnet-4-6
github-copilot/claude-opus-4.6
github-copilot/claude-sonnet-4.6
openai-codex/gpt-5.4
openai-codex/gpt-5.3-codex
google-antigravity/gemini-3.1-pro-high
google-antigravity/claude-opus-4-6-thinking
openrouter/x-ai/grok-4.1-fast
openrouter/moonshotai/kimi-k2.5
openrouter/deepseek/deepseek-v3.2
opencode-go/glm-5
opencode-go/kimi-k2.5
```

`Ctrl+P` always works regardless of auto-routing state.

---

## Thinking levels

| Level | When |
|-------|------|
| `off` | Terminal work, boilerplate, speed-first tasks |
| `medium` | Default for most tasks |
| `high` | Complex refactoring, architecture, security |

Change the current thinking level with **`Shift+Tab`** without affecting the route.

---

## Adding or modifying routes

Edit `~/.pi/agent/extensions/auto-router.ts`:

**1. Add a new route** — add an entry to `ROUTES`:

```typescript
myroute: {
  label: "🟣 My Model — description",
  thinking: "medium",
  candidates: [
    ["provider-id", "model-id"],
    ["fallback-provider", "fallback-model-id"],
  ],
},
```

**2. Change the default** — the `daily` route is the catch-all default returned by `classifyTask` when no other pattern matches. Edit its `candidates` array to change the default model.

**3. Add a trigger keyword** — add a regex pattern to the relevant `if` block inside `classifyTask()`.

**4. Change thinking level** — edit the `thinking` field of the route. Valid values: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`.

After editing, run `/reload` in pi to apply changes without restarting.

---

## Limitations

### Mode `local`
- Classification is **keyword-based heuristics** — it works well for clear-cut cases but will occasionally pick the wrong route for ambiguous prompts. Use `/route <name>` to override.
- A provider candidate is skipped if `modelRegistry.find()` returns nothing (model not in the built-in list) or if `pi.setModel()` returns `false` (no API key configured). Make sure the relevant API keys are set in `~/.pi/agent/auth.json`.
- The `speed` and `glm` routes have **a single candidate** with no fallback — if that provider is unavailable, the router emits a warning and the model does not change.
- Auto-routing fires on the **raw input text**, before skill and template expansion, so `/skill:name` prompts are not expanded when the classifier runs.

### Mode `orauto`
- Requires a valid `OPENROUTER_API_KEY` — switching mode will fail with an error if no key is found.
- OpenRouter's internal routing logic is **opaque** — you cannot control which model it picks or inspect it from pi.
- The selected model may change between prompts even within the same session, which can affect context continuity for models that benefit from consistent reasoning style.
- `openrouter/auto` bills at the rate of whichever model OR selects — costs are unpredictable. Monitor spend on the OpenRouter dashboard.
- Thinking level is fixed at `medium` when switching to `orauto`. Adjust manually with `Shift+Tab` after switching if needed.
- Mode is **session-scoped** — it resets to `local` on restart.
