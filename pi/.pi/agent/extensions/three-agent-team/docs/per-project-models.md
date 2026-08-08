# Plan — Per-project model overrides via `/team-models`

## Goal

Let the owner change Architect/Builder/Reviewer models on a per-project basis
through slash commands, without editing `~/.config/pi-three-agent-team/config.json`.
The override persists in the repository and travels with it.

## Current state

Models are read from a single host-level config file
(`~/.config/pi-three-agent-team/config.json` or `$PI_THREE_AGENT_CONFIG`).
`config.ts > loadTeamConfig()` returns a `TeamConfig` with `roles` mapping each
role to a `RoleProfile` (provider, model, context window, etc.). At task
authorization time, the resolved roles are snapshotted into the task-local
`runtime-config.json` and never change for that task.

## Design

### Storage — `team/models.json`

A lightweight file in the repository root, carrying only role→model overrides:

```json
{
  "version": 1,
  "roles": {
    "architect": { "model": "gemma-4-31B-it-qat-UD-Q4_K_XL" },
    "builder": null,
    "reviewer": { "model": "Qwen3.6-27B-MTP-UD-Q5_K_XL" }
  }
}
```

- `null` or absent key = no override (use host default)
- The `model` field must name a model available under the role's configured
  provider. Changing providers is out of scope — the provider is host-level
  infrastructure.
- The file is committed (`git add team/models.json`), so overrides travel with
  the project.

### Resolution order

```
Host config (~/.config/pi-three-agent-team/config.json)
    │
    ▼
TeamConfig (baseline roles)
    │
    ▼  overlay
Project override (team/models.json)      ← only changes role.model
    │
    ▼
Effective config used by /team-models, /team-go, /team-enqueue
    │
    ▼  snapshotted at authorization
Task runtime-config.json                 ← frozen, never changes mid-task
```

### Commands

| Command | Behavior |
|---|---|
| `/team-models` | Show effective models for all three roles, marking which come from host vs. project override |
| `/team-models architect <model-id>` | Set project-level override for Architect. Validates the model exists under the Architect's provider. |
| `/team-models builder <model-id>` | Same for Builder |
| `/team-models reviewer <model-id>` | Same for Reviewer |
| `/team-models architect --reset` | Remove the override; falls back to host default |
| `/team-models builder --reset` | Same |
| `/team-models reviewer --reset` | Same |

Example output of `/team-models`:

```
Effective models for this project:

  Architect  gemma-4-31B-it-qat-UD-Q4_K_XL      (project)
  Builder    Qwen3.6-27B-MTP-UD-Q5_K_XL          (host default)
  Reviewer   gemma-4-31B-it-qat-UD-Q4_K_XL       (host default)

Project overrides: team/models.json
Host config:       ~/.config/pi-three-agent-team/config.json
```

## Implementation

### 1. New module: `project-config.ts`

- `readProjectOverrides(repo)` — reads `team/models.json`, returns
  `Partial<Record<TeamRole, { model: string }>>` or empty if file missing
- `writeProjectOverride(repo, role, model)` — writes or removes one override
- `resolveEffectiveConfig(hostConfig, overrides)` — returns a new `TeamConfig`
  with role models overlaid

### 2. Modify: `config.ts`

- `loadTeamConfig` accepts an optional `projectOverrides` parameter
- `roleModel()` and `expectedIdentity()` already work off `config.roles` — no
  changes needed once the effective config is resolved

### 3. New command handler: `index.ts > /team-models`

- Parse args: `/team-models [architect|builder|reviewer [<model-id>|--reset]]`
- Resolution: for setting, validate the model exists in the provider's model
  list. For now, accept any non-empty model ID and let the runtime validate at
  dispatch time (the provider will error if the model is unknown).
- Idempotent: setting the same model twice is a no-op.

### 4. Tests: `project-config.test.ts`

Test cases:
- Empty repo (no `team/models.json`) → default overrides object, all host
- Write an override → file created, effective config reflects it
- Write a second override → file updated, both roles overridden
- Reset one role → `null` in JSON, effective config falls back to host
- Invalid model ID → error
- Malformed JSON → error, does not corrupt existing file

### 5. Wiring

- `configuredTeam` in `index.ts` already loads the host config at startup.
  After this change, it also reads project overrides and resolves the effective
  config.
- `/team-go`, `/team-enqueue`, `/team-continue` already use
  `loadOrCreateTaskConfig()` which snapshots the effective config at
  authorization time — no changes needed.
- `/team-config` already shows role models — it will naturally show the
  resolved effective models.

## Assessment: per-role companion commands

### `/team-architect`, `/team-builder`, `/team-reviewer`

**As model selectors:** Thin aliases for `/team-models <role>`. They add
discoverability but also ambiguity — a user might think `/team-architect`
starts an Architect session, not sets a model. One command with subcommands
(`/team-models architect <model>`) is clearer and avoids the namespace tax.

**As session starters:** A different feature. Starting a standalone Architect
session outside the task workflow could be useful (e.g., discussing a contract
concept before creating a task), but that's orthogonal to model selection.
It would need its own design — how does a standalone session relate to the
queue? Does it produce a task? Is it just a chat?

**Recommendation:** Do not add per-role commands now. `/team-models` covers
model selection cleanly. If standalone role sessions are needed later, design
them as a separate feature with clear semantics.

## Sequence

1. `project-config.ts` — read/write/resolve
2. `config.ts` — overlay support in `loadTeamConfig`
3. `index.ts` — `/team-models` command handler + wiring at startup
4. `project-config.test.ts` — tests for the new module
5. `README.md` — document `/team-models`
6. `CLAUDE.md` — add `project-config.ts` to architecture map

## Constraints

- Does not change the provider — only the model within an existing provider
- Overrides take effect at the *next* task authorization, not mid-execution.
  A running task continues with its snapshotted config.
- The file `team/models.json` must be committed for overrides to persist
  across clones. The command handles the git add/commit.
- Provider validation is deferred to runtime — if a model ID doesn't exist
  under that provider, the child session will fail at startup with a clear
  error.
