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

Copy `foreman.example.json` to `~/.pi/agent/foreman.json` (global) and/or `.pi/foreman.json`
(per project, wins). Set `roles.builder`. `roles.reviewer` can be `{ "same_as": "builder" }`, which
avoids any model swap. `roles.architect` is optional; without it, planning uses your current model.
List local providers under `gpu.managedProviders` so Foreman takes a `pi-inference` lease for them.

## Develop

```bash
npm install
npm test           # node --test, no GPU needed
npm run typecheck
```
