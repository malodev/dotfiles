# Repository Guidelines

## Project Overview

**auto-router** is a pi.dev extension that automatically selects the best LLM model and thinking level based on prompt content. Runtime behavior lives in `index.ts`; route metadata, model tiers, escalation policy, and profiles live in `auto-router.json`.

The current design is **budget-first with escalation**: use cheap/appropriate tiers first, then escalate within the active profile when repeated failure language appears.

## Configuration Model

`auto-router.json` follows a `task-forge`-style model:

1. **`routes`** — shared route metadata: labels, thinking levels, keywords, manual-only flags.
2. **`profiles.<name>.modelTiers`** — reusable model pools for that profile.
3. **`profiles.<name>.routeAssignment`** — route-to-tier mapping.
4. **`tierRules`** — prompt-keyword rules that override a route's base tier.
5. **`escalation`** — repeated-failure tier escalation and profile-switch hints.

Every normal profile uses exactly four tiers:

```text
fast → coding → reasoning → endurance
```

Special profiles may use a wildcard assignment, for example `openrouter-auto` maps every route to `auto`.

## Routes

The default route set is intentionally small:

| Route | Purpose |
|------|---------|
| `critical` | Architecture, security, migrations, production incidents, high-risk refactors. |
| `coding` | Normal implementation, debugging, integration, polyglot work. |
| `terminal` | Shell, CI, Docker, Kubernetes, Git, system commands. |
| `docs-tests` | Docs, tests, coverage, lint, i18n/localization. |
| `uiux` | UI, Figma, screenshots, design systems, visual work. |
| `explore` | Manual-only exploratory route. |
| `long-horizon` | Manual-only large artifact / long-running engineering route. |

Route names are config data, not TypeScript enums. If routes change, update `auto-router.json` and docs together.

## Profiles

Current profiles:

| Profile | Intent |
|---------|--------|
| `online` | Default. opencode-go primary, openai-codex fallback in every tier. |
| `offline` | Local-only Ollama models. No cloud-tagged Ollama models. |
| `copilot` | GitHub Copilot provider profile. |
| `gpt` | OpenAI-Codex-first profile. |
| `claude` | Anthropic-first profile, including Opus 4.7 for reasoning/endurance. |
| `openrouter-auto` | Wildcard profile: every route uses `openrouter/auto`. |

Removed concepts:
- No `orauto` runtime mode.
- No `opus` profile; premium Opus behavior belongs in the `claude` profile's higher tiers.
- No route named after a model family, e.g. no `glm` route.

## Escalation Behavior

Repeated failure language is tracked in session memory:

```text
still failing, still fails, same error, didn't work, doesn't work,
not fixed, failed again, failing again, still broken, regression,
stuck, try again, root cause
```

Policy:
- First failure prompt stays on the selected tier.
- Second failure prompt for the same route escalates one tier.
- Further failure prompts continue one tier at a time.
- Escalation stays active for that route until the route changes.
- At max tier, auto-router suggests the next profile from `profileEscalationHints`; it does not switch profiles automatically.

Example ladder:

```text
fast → coding → reasoning → endurance
```

## Tier Rules

`tierRules` are global ordered overrides. First match wins.

Current intent:
- Complex terminal work (`docker`, `k8s`, CI, Git surgery) uses `coding` instead of `fast`.
- Docs/lint uses `fast`; tests/coverage/regression use `coding`.
- Visual UI work (`figma`, screenshots, wireframes, visual regression) uses `reasoning` instead of `coding`.

Rules select a tier only; they do not change the route.

## Config Discovery

Mirrors the neighboring `task-forge` pattern:
1. `<cwd>/.pi/auto-router.json`
2. A descendant `.pi/auto-router.json` within depth 4
3. Global extension config at `~/.pi/agent/extensions/auto-router/auto-router.json`

## Runtime Commands

```text
/route on              Enable local keyword routing
/route off             Disable routing
/route pin <route>     Lock to a route from the active profile
/route unpin           Release pin
/route now             Show profile, mode, route, tier, escalation, config path
/route profile         Reload config and list profiles
/route profile <name>  Switch profile
/route reload          Reload auto-router.json
/route help            Show commands, profiles, and active routes
```

Common switches:

```text
/route profile offline          # Local/Ollama models
/route profile copilot          # GitHub Copilot provider
/route profile gpt              # OpenAI-Codex-first
/route profile claude           # Anthropic-first
/route profile openrouter-auto  # Every route uses openrouter/auto
/route profile online           # Default online mixed providers
```

## Architecture & Data Flow

```text
session_start
  → load auto-router.json
  → validate routes/tierRules/escalation/profiles
  → restore persisted RouterState
  → normalize legacy persisted modes to local/off
  → validate pin/lastAutoRoute against active profile

before_agent_start
  → if mode=off: skip
  → if pinnedRoute: keep pinned route
  → classify prompt against route keywords
  → select base tier from active profile routeAssignment
  → apply first matching tierRule, if any
  → apply repeated-failure escalation, if active
  → resolve tier to primary/failover candidates
  → set first available model + thinking level
```

## Key Files

| File | Purpose |
|------|---------|
| `index.ts` | Extension entry point, state machine, JSON loader/validator, classifier, tier selection, escalation, commands. |
| `auto-router.json` | Route metadata, tier rules, escalation policy, model tiers, and route assignments. |
| `routes.schema.ts` | TypeScript interfaces for JSON config shape. |
| `README.md` | User-facing usage and configuration guide. |

## Code Conventions & Patterns

- Keep routing logic in `index.ts`; keep provider/model data in `auto-router.json`.
- Keep profile tiers to at most two candidates: primary + failover.
- Do not add special modes for providers/model groups; add a profile or tier in JSON.
- Use `manualOnly: true` to exclude a route from auto-classification; use `/route pin <key>`.
- `keywords` are weighted `[keyword, weight]` pairs; higher score wins.
- `tierRules` are ordered and should remain sparse.
- `hysteresisCount`, failure counters, and active escalation are session-local and not persisted.
- `profileName`, `mode`, `pinnedRoute`, and `lastAutoRoute` are persisted via `pi.appendEntry()`.

## Runtime / Tooling Preferences

- Loaded directly by pi.dev as TypeScript; no local package manager or build step is configured.
- Runtime imports from `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` are provided by the pi.dev host.
- Uses Node built-ins (`node:fs/promises`, `node:fs`, `node:path`) to load JSON config.
- JSON is kept because no TOML/YAML parser dependency is available in this extension; readability comes from the tiered schema and candidate string format.

## Testing & QA

No test framework is configured. Manual verification:

1. Edit `auto-router.json`.
2. Run `/route reload`.
3. Run `/route profile` to confirm profiles and tier counts.
4. Run `/route profile offline`, `/route profile copilot`, `/route profile gpt`, `/route profile claude`, or `/route profile openrouter-auto`.
5. Run `/route now` to confirm active profile/config path/escalation state.
6. Send prompts matching configured keywords and watch the `auto-router` status label.
