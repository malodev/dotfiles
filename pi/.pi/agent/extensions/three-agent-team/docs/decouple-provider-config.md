# Plan — Decouple team config from provider duplication

## Problem

`~/.config/pi-three-agent-team/config.json` duplicates information pi already
owns — provider base URLs, auth, and model metadata. This forces every usable
provider to be manually mirrored in the team config, which is why `/team-models`
can only show models from the single `pi-llama` provider even though pi's global
registry has Anthropic, OpenAI, Gemini, and others.

The team config should say *which models to use*, not *how to reach each provider*.
Pi's model registry is the single source of truth for the latter.

## Target state

**Team config** shrinks to role→model selections plus team-specific settings:

```json
{
  "version": 2,
  "roles": {
    "architect": "pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL",
    "builder":   "anthropic/claude-sonnet-4-5",
    "reviewer":  "pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL"
  },
  "limits": { ... },
  "lifecycle": { "managedProviders": ["pi-llama"], ... },
  "queue": { ... }
}
```

No `providers` block. No `apiKey`, `baseUrl`, `contextWindow`, `maxTokens`.
Role profiles become a single `provider/model` string — the same format pi uses
everywhere. Limits, lifecycle, and queue timing stay (they're team-specific).

**Child sessions** inherit pi's provider catalog. A child running the Anthropic
Builder uses Anthropic's built-in provider definition and the parent's credential
store. A child running pi-llama roles uses the llma.cpp router config (the one
provider that still needs explicit baseUrl/credential-command — see below).

**`/team-models`** shows every model pi knows about via `ctx.modelRegistry`,
not just `pi-llama/*`. Selection works across all providers.

## Why pi-llama stays explicit

Standard providers (Anthropic, OpenAI, Gemini, etc.) are built into pi-ai.
Their base URLs and API shapes are known; only the API key varies per user.
That key lives in pi's credential store, which child sessions inherit.

Pi-llama is different: it's a user-operated llma.cpp router with a custom
base URL (`https://llm.malo.tn.it/v1`) and a credential command
(`!~/.local/bin/pi-inference credential model-api`). This information doesn't
exist in pi's built-in registry — it's user-specific infrastructure. So the
team config keeps a minimal pi-llama entry:

```json
{
  "version": 2,
  "infrastructure": {
    "pi-llama": {
      "baseUrl": "https://llm.malo.tn.it/v1",
      "credentialCommand": "~/.local/bin/pi-inference credential model-api"
    }
  },
  "roles": { ... }
}
```

## Implementation steps

### Step 1 — Add provider→model parsing to config.ts

**Goal:** `parseTeamConfig` accepts v2 format where `roles.<role>` is a
`provider/model` string instead of a full `RoleProfile` object.

**Checkpoint:** Existing tests pass with v1 configs; new tests pass with v2.
Backward compatible — v1 configs continue to work.

- Add `parseProviderModel(raw: string)` → `{ provider, model }`
- `loadTeamConfig` detects version and normalizes v1 roles into the v2 shape
- Internally, roles become `{ provider, model }` only — metadata (contextWindow,
  maxTokens, thinking) moves to a separate model-lookup step

### Step 2 — Resolve model metadata from pi's registry

**Goal:** When the extension needs a role's full model info (context window,
max tokens, thinking level), it resolves it from the running pi session's
model registry instead of from the team config.

**Checkpoint:** Child session model catalogs include correct metadata for each
provider's models. Tests verify metadata matches between pi registry and child.

- `writeChildAgentConfig` takes a model list, not a TeamConfig
- For each role's `provider/model`:
  - If the provider is built-in (Anthropic, OpenAI, etc.): use pi-ai's
    built-in model definition
  - If the provider is pi-llama: use the infrastructure block from the team
    config to build the model entry
- Auth for built-in providers: child inherits from parent's credential store
  (already the case — child pi reads the same `~/.pi/agent/auth.json`)
- Auth for pi-llama: child inherits the credential command pattern

### Step 3 — Update /team-models to show all providers

**Goal:** The picker shows every model from `ctx.modelRegistry.getAvailable()`,
not filtered to a single provider.

**Checkpoint:** `/team-models builder` shows Anthropic, OpenAI, Gemini, and
pi-llama models in one list.

- Replace `fetchAvailableModels(providerUrl, apiKey)` with
  `ctx.modelRegistry.getAvailable().map(m => `${m.provider}/${m.id}`)`
- Selection stored as full `provider/model` in `team/models.json`
- No HTTP call, no credential command execution — pure registry lookup

### Step 4 — Migration path

**Goal:** Existing v1 configs continue to work. New installations use v2.
The extension detects the version and normalizes.

**Checkpoint:** V1 config with explicit RoleProfiles loads without error.
V2 config with provider/model strings loads and resolves correctly.

- `loadTeamConfig` detects `version: 1` vs `version: 2`
- V1 path: parse as before, produce the internal `{ provider, model }` shape
- V2 path: parse the new shape directly
- Internal `TeamConfig` type gains `infrastructure?: Record<string, InfrastructureEntry>`
  for pi-llama and future custom providers

### Step 5 — Update tests

- `config.test.ts`: v2 parsing, provider/model extraction, backward compat
- `project-config.test.ts`: full provider/model strings in overrides
- `runner.test.ts` (if it exists): child catalog generation with mixed providers
- Integration tests: `/team-go` with a non-pi-llama model (mock or real)

### Step 6 — Update documentation

- `README.md`: new config v2 format, provider/model selection
- `CLAUDE.md`: architecture change — team config no longer owns provider definitions
- `PRD.md`: update requirements to reflect multi-provider support

## Risks

- **Child auth for non-pi-llama providers.** Pi child sessions already inherit
  the user's credential store. This should work automatically for standard
  providers. Verify early with a manual test: spawn a child pi session and run
  `/model` — if Anthropic models appear and are usable, auth inheritance works.

- **Model metadata mismatch.** The team config v1 had explicit contextWindow,
  maxTokens, and thinking settings per role. After the switch, these come from
  pi's model registry. They should match — verify the current values align.
  If some role needs a non-default maxTokens (e.g., 32768 instead of the model's
  default), that override stays in the team config as an optional field.

- **Lifecycle/managed providers.** The `lifecycle.managedProviders` list controls
  which providers get lease management. With Anthropic in the mix, this list
  doesn't need to change — Anthropic doesn't use pi-inference leases. But verify
  that the managed-provider gating in `index.ts` doesn't accidentally block
  non-pi-llama providers.

## Sequence

```
Step 1 (config parsing)
  ↓
Step 2 (child catalog from registry)
  ↓  verify: child pi session uses Anthropic model
Step 3 (/team-models shows all models)
  ↓  verify: picker shows Anthropic + pi-llama
Step 4 (migration + backward compat)
  ↓
Step 5 (tests)
  ↓
Step 6 (docs)
```
