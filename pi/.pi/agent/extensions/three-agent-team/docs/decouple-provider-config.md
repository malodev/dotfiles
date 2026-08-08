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
team config keeps a minimal entry for each infrastructure provider.

Ds4 (DeepSeek v4) is the same category: a user-hosted model server where only
one model can be loaded on the GPU at a time. Both pi-llama and ds4 need the
lease mechanism (acquire/renew/release) to load/unload models on the GPU host
when tasks switch between models. They share the same `pi-inference` commands.

```json
{
  "version": 2,
  "infrastructure": {
    "pi-llama": {
      "baseUrl": "https://llm.malo.tn.it/v1",
      "credentialCommand": "~/.local/bin/pi-inference credential model-api"
    },
    "ds4": {
      "baseUrl": "https://llm.malo.tn.it/v1",
      "credentialCommand": "~/.local/bin/pi-inference credential model-api"
    }
  },
  "lifecycle": {
    "managedProviders": ["pi-llama", "ds4"],
    ...
  },
  "roles": { ... }
}
```

## Implementation steps

### Step 1 — Add provider→model parsing to config.ts ✅

**Goal:** `parseTeamConfig` accepts v2 format where `roles.<role>` is a
`provider/model` string instead of a full `RoleProfile` object.

**Done.** Added:
- `parseProviderModel(value)` — splits "pi-llama/pi/gemma-4-..." at first `/`
- `defaultRoleProfile(provider, model)` — sensible defaults for v2 roles
- `parseInfrastructure(value)` — converts infrastructure block to providers
- V1 backward compat: `parseTeamConfig` accepts both version 1 and 2
- V2 allows built-in providers not in the config (Anthropic, OpenAI, etc.)
- Tests: `config.test.ts` — 6 tests for v2 parsing

### Step 2 — Resolve model metadata from pi's registry ✅

**Goal:** When the extension needs a role's full model info (context window,
max tokens, thinking level), it resolves it from the running pi session's
model registry instead of from the team config.

**Done.** `writeChildAgentConfig` skips built-in providers (those not in
`config.providers`). The child pi session discovers Anthropic/OpenAI/etc.
from `builtinProviderCatalog` natively. Pi-llama models still get explicit
catalog entries from the infrastructure block. Default RoleProfile metadata
(contextWindow: 128000, maxTokens: 32768) is a placeholder — the child's
pi-ai fills in real values from the built-in catalog at model load time.

### Step 3 — Update /team-models to show all providers ✅

**Goal:** The picker shows every model from `ctx.modelRegistry.getAvailable()`,
not filtered to a single provider.

**Done.** Replaced `fetchAvailableModels` HTTP call with
`ctx.modelRegistry.getAll().map(m => \`${m.provider}/${m.id}\`)`.
Selection stored as full `provider/model` in `team/models.json`.
`resolveEffectiveConfig` and `effectiveModel` handle full provider/model
strings (split at first `/`).

### Step 4 — Migration path ✅

**Goal:** Existing v1 configs continue to work. New installations use v2.
The extension detects the version and normalizes.

**Done.** V1 backward compat confirmed — all 211 existing tests pass with
v1 config unchanged. V2 parsing works alongside v1. `parseTeamConfig` accepts
both versions. `parseRoles` auto-detects v1 (object) vs v2 (string) via
typeof check on the first role value, so even mixed-version scenarios degrade
gracefully.

### Step 5 — Tests ✅

- `config.test.ts`: 6 tests for v2 parsing, provider/model extraction,
  backward compat
- `project-config.test.ts`: 8 tests for override storage and resolution
  (updated for full provider/model strings)
- Full suite: 211/211 pass

### Step 6 — Update documentation ⬜

- `README.md`: new config v2 format, provider/model selection
- `CLAUDE.md`: architecture change — team config no longer owns provider definitions

### Step 7 — Add ds4 to managed providers and infrastructure ⬜

**Goal:** ds4 models get the same GPU load/unload lease mechanism as pi-llama.

The extension uses `pi-inference acquire --mode team` to load pi-llama models
on the GPU. The same `pi-inference` binary supports `--mode ds4` for ds4 models.
Both are user-hosted GPU servers where only one model fits at a time.

The current code acquires the lease once per workflow with a single hardcoded
mode (`--mode team` from `acquireTeamCommand`). For ds4 support, the lease must
switch modes when roles switch between providers:

1. Before each role runs: acquire lease with the provider's mode
   (pi-llama → `--mode team`, ds4 → `--mode ds4`)
2. The `before_provider_request` event (line 2425) already gates every request
   against `managedProviders` — it checks a lease is held
3. After the role completes: release the lease

Implementation:
- Add a mapping from provider to mode: `pi-llama → "team"`, `ds4 → "ds4"`
- Extend `acquireInferenceLease` to accept a `provider` parameter and append the
  right `--mode` flag to the acquire command
- In `runWorkflow` (index.ts line ~907): acquire/release the lease per-role instead
  of once at workflow start
- Add `"ds4"` to `lifecycle.managedProviders` in the host config
- Ensure ds4 is in the `infrastructure` block of v2 configs
- Verify: assign ds4 model to a role via `/team-models`, run `/team-go`,
  confirm the lease is acquired with `--mode ds4` and model loads on GPU

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
  which providers get lease management. Must include both pi-llama and ds4 —
  both are user-hosted GPU servers where only one model loads at a time.
  Anthropic, OpenAI, and other built-in providers don't need lease management
  and should not be in this list. Verify that the managed-provider gating in
  `index.ts` doesn't accidentally block non-managed providers.

## Sequence

```
Step 1 (config parsing)
  ↓
Step 2 (child catalog from registry)
  ↓  verify: child pi session uses Anthropic model
Step 3 (/team-models shows all models)
  ↓  verify: picker shows Anthropic + pi-llama + ds4
Step 4 (migration + backward compat)
  ↓
Step 5 (tests)
  ↓
Step 6 (docs)
  ↓
Step 7 (ds4 managed provider + lease)
```
