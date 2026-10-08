# Foreman — spec

Pi extension that turns an idea, an intent, or a PRD into a working first version (MVP), using
weak local models that can run **one at a time** on a single GPU.

Replaces `three-agent-team`, which is over-built for one user on one machine. Foreman keeps the
part that works (contract → build → test → review, with deterministic gates) and drops the
distributed-systems machinery (fencing, epochs, journals, tombstones, digest approvals).

## Principles

1. **Deterministic gates beat model judgment.** A task is done when its success-test commands pass
   and the Reviewer approves, in that order. Weak models drift, so tests are the authority.
2. **One model at a time is a scheduling problem.** All GPU handling lives in one small module.
   Nothing else knows models are swapped.
3. **State is plain files.** `foreman/plan.md`, `foreman/tasks.yaml`, `foreman/state.json`. A human
   can read and edit them. No hidden state, no journals.
4. **Few commands, no ceremony.** Running `/foreman run` is the approval. No hashes to paste.
5. **Fail closed, never retry silently.** Ambiguous state after a crash becomes `blocked`.

## Non-goals (v1)

Parallel tasks, push or deploy, multi-repo, dynamic insertion into a running queue, dashboards,
notifications. Foreman commits locally on a work branch; the owner merges.

## Commands

| Command | Behavior |
|---|---|
| `/foreman plan <idea \| path.md>` | Architect discusses (optionally grilled), then writes `foreman/plan.md` and `foreman/tasks.yaml`. Validates every task. No execution. |
| `/foreman run` | Validate `tasks.yaml`, then drain tasks in order until done, blocked, or paused. |
| `/foreman status` | Table of tasks with state, attempts, last failure. |
| `/foreman unblock <id> [note]` | Reset a blocked task to `pending`; the note is passed to the Builder. |
| `/foreman pause` | Stop after the current task; do not interrupt it. |

Owner edits `tasks.yaml` by hand between `plan` and `run`. That is the review step.

## Task contract (`tasks.yaml`)

```yaml
- id: t01-scaffold
  goal: One or two sentences of what must be true when done.
  depends_on: []
  files: [package.json, src/index.ts]       # expected scope, advisory
  success_tests:                              # real runnable commands, exit 0 = pass
    - npm test
    - npx tsc --noEmit
```

The validator rejects: placeholder commands, empty tests, unknown dependencies, dependency cycles,
dependencies listed after their dependents. Reuse the existing rules in
`skills/init-three-agent-team/assets/validate_goal_contract.py` (port what applies; the brief.md
heading rules are not needed because the contract is YAML, not markdown).

## State (`foreman/state.json`)

Each task: `pending | running | done | blocked`, attempt count, last failure output path, commit sha.
Written by atomic replace (write temp, rename). On startup any `running` task becomes `blocked`
with reason `interrupted`. No other recovery logic.

## Task cycle

```
Builder(model B) ── edits in sandbox ──►  success_tests (no model loaded)
     ▲                                          │ red: failure output → Builder, attempt++
     └──────────────────────────────────────────┘
                                                │ green
                                        Reviewer(model R) ──► approve → git commit on work branch
                                                │ reject: notes → Builder, attempt++
```

- Attempt cap per task (default 4 build attempts total). Exceeding it blocks the task and stops
  the run. Same cap style for reviewer verdict retries.
- Builder gets edit/write/bash tools in the sandbox; Reviewer gets read-only tools.
- Commit is plain `git commit` on `foreman/<run-id>` branch, created at first `run`. Never pushes,
  never resets the owner's branch.

## GPU / model scheduling (`gpu.ts`)

Findings from reading `pi-inference` (manager `pi_inference_host/manager.py`):

- The manager grants one expiring **card lease** per mode (`team`, `ds4`, `qwen-flash`, `studio`).
- In `team` mode the llama.cpp **router** loads the model named by each request. The lease does not
  choose weights, and releasing it is not an unload.
- The old extension released and re-acquired the lease around every Builder/Reviewer switch and
  on every red test cycle, which bought nothing.

Design:

- Take **one lease for the whole run** with a renew heartbeat; release at the end or on abort.
- Expose a single `withModel(role, fn)`:
  - If the role's model equals the currently loaded one, run `fn` directly.
  - Otherwise run `fn` after recording the switch; the router loads on the first request.
- Tolerate a slow first request after a switch: model-load timeout is separate from the normal
  request timeout (default 300s) and a renewal failure during a load does not abort the run
  until the lease actually lapses.
- Reviewer defaults to the **Builder's model** with a different prompt, so a normal cycle has zero
  swaps. Test runs need no model at all. Configuring a different Reviewer model is supported.
- Non-managed providers (frontier API for the Architect) skip the lease entirely.

Verified in `pi-llama-router.service`: the router runs with `--models-max 1 --models-autoload
--parallel 1`. Exactly one model is resident, a request naming another model swaps weights, and
requests are serialized. There is no idle-unload flag, so weights stay loaded between requests.
`--parallel 1` also means the router itself enforces one role at a time.

## Roles and config

Three roles: `architect`, `builder`, `reviewer`. Config in `foreman.json` (global default in the
extension dir, per-project override at `.pi/foreman.json`):

```json
{
  "roles": {
    "architect": { "provider": "…", "model": "…" },
    "builder":   { "provider": "…", "model": "…" },
    "reviewer":  { "same_as": "builder" }
  },
  "limits": { "buildAttempts": 4, "reviewAttempts": 2, "modelLoadTimeoutSeconds": 300 },
  "gpu": { "managedProviders": ["…"], "leaseTtlSeconds": 300 }
}
```

The Architect model is chosen by the owner, with no built-in default. The decomposition step is
the hardest reasoning and runs once, so a stronger model there pays off most.

Role prompts are markdown files with frontmatter for tools (pattern borrowed from task-forge):
`agents/architect.md`, `agents/builder.md`, `agents/reviewer.md`.

## Reuse from three-agent-team

| Piece | Where | Action |
|---|---|---|
| Contract validator rules | `skills/init-three-agent-team/assets/validate_goal_contract.py` | Port applicable rules to a small TS or Python validator |
| Sandbox (bubblewrap args) | `three-agent-team/runner.ts` (`PI_THREE_AGENT_BWRAP_BIN`, ~line 132) | Lift the argv builder |
| Builder/Reviewer prompts | `skills/init-three-agent-team/assets/team-builder.md`, `team-reviewer.md` | Trim and adapt |
| Architect workflow prompt | `.../assets/team-workflow.md` | Adapt for YAML output |
| `pi-inference` client call shape | `pi/.local/lib/pi_inference/client.py` | Thin wrapper: acquire, renew, release |

As built: `role-launcher.py` and the journaled process identity were dropped; the bubblewrap argv
was rewritten in `sandbox.ts`, and the Reviewer now runs in a sandbox with the repository mounted
read-only, so its read-only access is enforced by the kernel rather than by its prompt.

Not reused: queue, import journal, durable state, epochs, authorization records, amendment manifests,
the `commit-tree`/`update-ref` machinery. Note `role-launcher.py` is a journaling stop-before-exec
helper, **not** the sandbox; the bubblewrap logic is in `runner.ts`.

## Module layout (target ~2–3k lines with tests)

```
foreman/
  index.ts          command wiring only
  plan.ts           architect step, writes plan.md + tasks.yaml
  tasks.ts          parse + validate tasks.yaml
  state.ts          state.json read/atomic-write, startup recovery
  cycle.ts          build → test → review loop for one task
  gpu.ts            lease + withModel
  sandbox.ts        bubblewrap argv, role process spawning
  git.ts            branch + commit
  config.ts         foreman.json resolution
  agents/           architect.md, builder.md, reviewer.md
  test/             tests cross the same interfaces as callers
```

## Build order

1. `tasks.ts` + validator, with tests. Nothing else works without a trustworthy contract.
2. `state.ts` and startup recovery.
3. `sandbox.ts` and `git.ts`.
4. `gpu.ts` (after checking the router questions above).
5. `cycle.ts` with fake role runners so the loop is testable without a GPU.
6. `plan.ts` and the Architect prompt.
7. `index.ts` wiring and a smoke test on a toy PRD.

## Decisions

1. Validator: ported to TypeScript (`tasks.ts`). One runtime.
2. Work happens on a `foreman/<timestamp>` branch in the same repo. Runtime files live in
   `foreman/.run/` and are excluded through `.git/info/exclude`, so they never enter a commit.
3. Grilling is part of the Architect conversation, not a separate flag.

## Watching the UI

`/foreman preview` runs `foreman/preview.json`'s command in a sandbox with the repository read-only, on its
own port and data dir, restarted by a debounced file watcher; `/foreman recordings` opens the videos,
screenshots and traces that each task's tests wrote to `test-results/` (copied to `foreman/.run/artifacts/`
after every test run; `test-results/` is cleared before each so recordings are not misattributed). The
test browser is headless; showing it live would need a virtual display streamed to the owner, or access to
the owner's desktop session, and was deliberately not built.

## Known limits

- The sandbox mounts the host read-only, but hides credentials the roles never need: the
  `pi-inference` control token (it can switch modes and release leases), the real pi `auth.json`,
  `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.config/gh`, `~/.config/gcloud`,
  `.netrc`, `.git-credentials`, `.npmrc`. Symlinked paths are hidden through their real target.
  The model API key stays readable because pi fetches it inside the sandbox, and each role gets a
  private copy of `models.json` and `auth.json`. That copy is not filtered per provider, so a role
  can still read every provider key it contains.
- `/tmp` is writable in both sandboxes. A repository located under `/tmp` is therefore writable by
  the Reviewer too.
- Nothing has been run against the real GPU, `pi-inference`, or a real model. The role runner is
  tested against a fake `pi` under real bubblewrap; the lease client is tested against a fake
  command runner.
