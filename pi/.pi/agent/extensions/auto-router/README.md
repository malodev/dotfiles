# auto-router

`auto-router` is a pi.dev extension that automatically switches the active LLM model and thinking level based on the prompt you send.

It is configured entirely through `auto-router.json`. The TypeScript code contains routing behavior; the JSON file contains model groups, route definitions, and profile choices.

## What It Does

On each prompt, auto-router can:

1. Classify the prompt by keyword signals.
2. Pick a route such as `coding`, `critical`, `terminal`, or `uiux`.
3. Resolve that route through the active profile, for example `online`, `offline`, or `openrouter-auto`.
4. Set the first available model candidate for that route.
5. Set the configured thinking level.

Example:

```text
Prompt: "fix this bug in the test suite"
  → matches route: docs-tests
  → active profile: online
  → tier: coding (docs-tests default) → tierRule: "regression" bumps to coding
  → candidates: opencode-go/kimi-k2.6, openai-codex/gpt-5.3-codex
  → first available model is selected
```

## Commands

Use `/route` inside pi.dev:

```text
/route on              Enable local keyword routing
/route off             Disable routing
/route pin <route>     Lock to one route from the active profile
/route unpin           Release a pinned route
/route now             Show current profile, mode, route, hysteresis, and config path
/route profile         Reload config and list available profiles
/route profile <name>  Switch profile
/route reload          Reload auto-router.json after editing
/route help            Show help, profiles, and active routes
```

Common profile switches:

```text
/route profile online           # Use online/API-backed models
/route profile offline          # Use local Ollama models
/route profile openrouter-auto  # Use openrouter/auto for every route
```

## Configuration File

The runtime looks for `auto-router.json` in this order:

1. `<cwd>/.pi/auto-router.json`
2. A descendant `.pi/auto-router.json` within depth 4
3. Global extension config: `~/.pi/agent/extensions/auto-router/auto-router.json`

This lets you keep a global default config while overriding it per project.

## Configuration Shape

`auto-router.json` has three main sections:

- `routes`: shared routing metadata (thinking level, keywords, label)
- `profiles`: model pools (`modelTiers`) and route-to-tier mappings (`routeAssignment`)
- `tierRules`: keyword-based tier overrides

Example:

```json
{
  "defaultProfile": "online",
  "tierLadder": ["fast", "coding", "reasoning", "endurance"],
  "routes": {
    "coding": {
      "thinking": "medium",
      "label": "🟡 coding",
      "keywords": [["implement", 2], ["fix bug", 2]],
      "minPromptLength": 10
    },
    "critical": {
      "thinking": "high",
      "label": "🔴 critical",
      "keywords": [["refactor", 2], ["architect", 3]],
      "minPromptLength": 30
    }
  },
  "profiles": {
    "online": {
      "modelTiers": {
        "fast": ["opencode-go/minimax-m2.7", "openai-codex/gpt-5.4-mini"],
        "coding": ["opencode-go/kimi-k2.6", "openai-codex/gpt-5.3-codex"]
      },
      "routeAssignment": {
        "coding": "coding",
        "critical": "reasoning",
        "terminal": "fast"
      }
    },
    "offline": {
      "modelTiers": {
        "fast": ["ollama/qwen3-coder"],
        "coding": ["ollama/deepseek-r1", "ollama/qwen3-coder"]
      },
      "routeAssignment": {
        "coding": "coding",
        "critical": "reasoning",
        "terminal": "fast"
      }
    },
    "openrouter-auto": {
      "modelTiers": {
        "auto": ["openrouter/auto"]
      },
      "routeAssignment": {
        "*": "auto"
      }
    }
  }
}
```

## Routes

A route describes the kind of work being requested. Current routes include:

| Route | Purpose |
|---|---|
| `critical` | Architecture, security, migrations, production incidents |
| `coding` | Normal implementation, debugging, integration |
| `terminal` | Shell, CI, Docker, Kubernetes, Git, system commands |
| `docs-tests` | Documentation, tests, coverage, lint, localization |
| `uiux` | UI, Figma, screenshots, design systems, visual work |
| `explore` | Manual-only exploratory route |
| `long-horizon` | Manual-only large artifact / long-running engineering route |

Each route can define:

```json
{
  "thinking": "medium",
  "label": "🟡 coding",
  "keywords": [["implement", 2]],
  "minPromptLength": 10,
  "manualOnly": false
}
```

### Keyword Weights

Keywords are weighted pairs:

```json
["architect", 3]
```

Suggested convention:

- `3`: strong, route-specific signal
- `2`: medium signal
- `1`: weak tiebreaker

The highest scoring route wins. If scores tie, route order in `routes` wins.

### Manual-only Routes

Set `manualOnly: true` to exclude a route from automatic classification:

```json
"long-horizon": {
  "thinking": "medium",
  "label": "🔵 long-horizon",
  "manualOnly": true
}
```

Activate manually:

```text
/route pin long-horizon
```

## Vocabulary: routes, tiers, profiles, rules

The config uses a small fixed vocabulary. These terms do different jobs:

| Term | What it means | Where it lives |
|---|---|---|
| `route` | The kind of work being requested: `coding`, `terminal`, `uiux`, `critical`, etc. | `routes` |
| `tier` | The strength/cost level to use inside a profile: `fast`, `coding`, `reasoning`, `endurance` | `tierLadder`, `profiles.<name>.modelTiers` |
| `profile` | A provider strategy or model family preference: `online`, `offline`, `gpt`, `claude`, etc. | `profiles` |
| `routeAssignment` | The default tier for each route in one profile | `profiles.<name>.routeAssignment` |
| `tierRule` | A keyword-based override that changes the tier for a route | `tierRules` |
| `escalation` | The repeated-failure policy that moves one tier higher | `escalation` |

Think of the routing decision in this order:

1. Classify the prompt into a `route`.
2. Read the active `profile`.
3. Look up that route's default tier in `routeAssignment`.
4. Apply the first matching `tierRule`, if any.
5. If the same route keeps failing, escalate one step up the tier ladder.
6. Use the active profile's models for the final tier.

Example:

- Active profile: `online`
- Prompt: "debug this Docker CI regression"
- Classified route: `terminal`
- Default tier from `routeAssignment`: `fast`
- Matching `tierRule`: Docker/CI/regression keywords push it to `coding`
- Final models: `online.modelTiers.coding`

### Prompt vocabulary: the words that trigger route switching

Route switching starts from prompt text. The router looks for weighted keywords in your prompt and picks the highest-scoring route.

That means the "vocabulary" that matters at runtime is mostly the words you use when asking for help.

Examples of prompt vocabulary by route:

| Route | Typical trigger words |
|---|---|
| `critical` | `architecture`, `security`, `migration`, `incident`, `root cause`, `memory leak` |
| `coding` | `implement`, `refactor`, `debug`, `api`, `typescript`, `python`, `sql`, `bug` |
| `terminal` | `bash`, `shell`, `docker`, `kubernetes`, `git rebase`, `makefile`, `systemd` |
| `docs-tests` | `readme`, `docstring`, `unit test`, `integration test`, `coverage`, `lint`, `i18n` |
| `uiux` | `figma`, `screenshot`, `wireframe`, `mockup`, `design system`, `landing page`, `visual regression` |
| `explore` | manual only; not selected by prompt vocabulary |
| `long-horizon` | manual only; not selected by prompt vocabulary |

A few practical examples:

- "debug this docker build in CI" → likely `terminal`
- "write unit tests for this parser" → likely `docs-tests`
- "implement this API endpoint in TypeScript" → likely `coding`
- "review this migration for breaking changes" → likely `critical`
- "match this Figma screenshot" → likely `uiux`

How to use this intentionally:

- If you want a route, say the domain words plainly.
- Put the strongest route words in the prompt itself, not only in attached context.
- Use specific words like `unit test`, `docker`, `migration`, or `figma` instead of generic words like `help` or `fix`.
- If auto-routing still picks the wrong route, pin it with `/route pin <route>`.

How to tune this in config:

- Edit `routes.<route>.keywords` to add, remove, or reweight trigger words.
- Increase a keyword weight when it should dominate weaker generic words.
- Use `minPromptLength` to stop very short prompts from triggering heavy routes too easily.
- Use `tierRules` when the route is correct but certain prompt words should change the tier.

### How to use the vocabulary when editing config

Use these rules when changing `auto-router.json`:

- Add or tune **keywords** when the router is choosing the wrong `route`.
- Change **`routeAssignment`** when one route is usually too weak or too expensive in a specific profile.
- Add a **`tierRule`** when a route is usually right, but a subset of prompts needs a stronger or cheaper tier.
- Edit **`modelTiers`** when you want different models for an existing tier.
- Switch **profiles** when you want a different provider strategy entirely.
- Use **escalation** only for repeated stuck/failure follow-ups, not for normal first-pass routing.

Practical examples:

- If `terminal` is generally fine but Kubernetes work needs stronger models, add a `tierRule`.
- If `uiux` is too expensive in `claude`, lower `profiles.claude.routeAssignment.uiux`.
- If `offline` should prefer a different local coding model, edit `profiles.offline.modelTiers.coding`.
- If a new kind of work does not fit any existing route, add a new `route`, then assign it in every profile.

### How to use it at runtime

You usually only need two actions:

1. Pick a `profile`:

```text
/route profile online
/route profile offline
/route profile claude
```

2. Let auto-router choose the `route` and `tier`, or pin a route manually:

```text
/route pin long-horizon
/route now
```

Use `/route now` to see the current profile, route, tier, escalation state, and config path.

## Profiles

A profile is a named provider strategy. It defines reusable model pools (`modelTiers`) and maps routes to tiers (`routeAssignment`).

```json
"online": {
  "modelTiers": {
    "fast": ["opencode-go/minimax-m2.7", "openai-codex/gpt-5.4-mini"],
    "coding": ["opencode-go/kimi-k2.6", "openai-codex/gpt-5.3-codex"]
  },
  "routeAssignment": {
    "coding": "coding",
    "terminal": "fast"
  }
}
```

Each tier candidate list is limited to at most two entries:

1. Primary model
2. Optional failover model

The first available candidate wins.

### Candidate Syntax

Preferred syntax:

```json
"provider/modelId"
```

Examples:

```json
"ollama/qwen3-coder"
"opencode-go/minimax-m2.7"
"openai-codex/gpt-5.4-mini"
"openrouter/anthropic/claude-sonnet-4.5"
```

The split happens at the first slash. This means OpenRouter model slugs with slashes still work:

```json
"openrouter/anthropic/claude-sonnet-4.5"
```

is interpreted as:

```json
["openrouter", "anthropic/claude-sonnet-4.5"]
```

Tuple syntax is also supported:

```json
["provider", "modelId"]
```

## OpenRouter Auto

There is no special OpenRouter Auto mode. It is just another profile:

```json
"openrouter-auto": {
  "modelTiers": {
    "auto": ["openrouter/auto"]
  },
  "routeAssignment": {
    "*": "auto"
  }
}
```

The `*` wildcard applies the same candidate list to every route.

Switch to it with:

```text
/route profile openrouter-auto
```

## Offline / Ollama Setup

The `offline` profile is intended for local models through Ollama or a compatible local provider.

Example:

```json
"offline": {
  "modelTiers": {
    "fast": ["ollama/gpt-oss:20b"],
    "coding": ["ollama/qwen3.6:35b-a3b-coding-nvfp4", "ollama/qwen3-coder-next-m3:latest"]
  },
  "routeAssignment": {
    "coding": "coding",
    "terminal": "fast",
    "docs-tests": "coding"
  }
}
```

Make sure model IDs match your local provider registry. For Ollama, check:

```text
ollama list
```

Then update `auto-router.json` and reload:

```text
/route reload
/route profile offline
```

## Hysteresis

Auto-router uses hysteresis to avoid rapidly switching routes from one prompt to the next.

Current behavior:

- The active route must hold for 2 turns before switching to a different route.
- If a new route would win too soon, the status label shows a pending transition.

This keeps model routing stable during short multi-turn edits.

## State Persistence

The extension persists these values through pi session entries:

- `mode`
- `profileName`
- `pinnedRoute`
- `lastAutoRoute`

It does not persist `hysteresisCount`; that value is session-local.

## Editing Workflow

1. Edit `auto-router.json`.
2. Run:

```text
/route reload
```

3. Check config and active profile:

```text
/route now
/route profile
```

4. Switch profiles if needed:

```text
/route profile offline
```

5. Send prompts matching route keywords and watch the `auto-router` status label.

## Development Notes

- Runtime logic is in `index.ts`.
- Config types are in `routes.schema.ts`.
- Model lists should stay in `auto-router.json`.
- No package manager or build step is configured for this extension.
- Runtime imports from `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` are provided by the pi.dev host.
