---
name: init-three-agent-team
description: Initializes an existing Git repository for the extension-controlled Architect–Builder–Reviewer workflow using validated Goal Contracts, exact local models, and structured handoffs. Use when the user asks to set up, bootstrap, install, or initialize the three-agent team in a repository.
compatibility: Requires Python 3, Git, Pi, and the global three-agent-team extension. Designed for sequential local-model execution on a single GPU.
---

# Initialize Three-Agent Team

Create a safe, auditable Architect → Builder → Reviewer workflow in an existing Git repository. Repository installation uses explicit file approval. A development task may run immediately after `/team-go`, or be durably approved and ordered after `/team-enqueue`; both paths require one validated owner-approved Goal Contract. Durable queue execution uses fenced deferred authorization, stop-before-exec role journaling, exact reviewed-tree completion, and owner-led blocked recovery.

## Safety contract

1. Resolve and display the target repository root.
2. Run the initializer without `--apply` first.
3. Show every proposed file and every existing file that will be skipped.
4. Ask for explicit approval before using `--apply`.
5. Never overwrite an existing file.
6. Never modify `~/.pi/agent/` directly.
7. Keep canonical Builder and Reviewer prompts versioned in the repository; runtime sessions are created directly by the global extension and are never delegated through adaptive routing.
8. Never initialize Git, commit, push, deploy, or run role inference during installation.

## Workflow

### 1. Verify prerequisites

Confirm:

- the target is the root of an existing Git repository;
- `pi` is available;
- the global `three-agent-team` extension exposes `/team-config`, `/team-new`, `/team-grill-me`, `/team-repair`, `/team-validate`, `/team-go`, `/team-enqueue`, `/team-queue`, `/team-pause`, `/team-continue`, `/team-dequeue`, `/team-resume`, `/team-unblock`, `/team-discard`, `/team-status`, `/team-report`, and `/team-cancel`;
- `/team-config` resolves valid Architect, Builder, and Reviewer profiles from `~/.config/pi-three-agent-team/config.json`;
- every configured provider/model ID is available exactly as configured.

If a configured model is unavailable, stop and report the missing prerequisite. Do not silently substitute another local or cloud model.

### 2. Preview repository changes

Resolve the target from the skill argument, defaulting to Pi's current repository root. From this skill directory, run:

```bash
python scripts/init_repository.py /path/to/repository
```

For the current repository, use:

```bash
python scripts/init_repository.py .
```

Present the output to the user. Existing files are always skipped, never replaced.

### 3. Apply after approval

Only after explicit installation approval, run:

```bash
python scripts/init_repository.py /path/to/repository --apply
```

Use `.` when initializing the current repository.

Read the result and report created and skipped files. Confirm the initializer reports successful validation of generated skill frontmatter and `team/validate_goal_contract.py` syntax. If validation fails, stop; do not claim initialization succeeded.

### 4. Verify canonical role definitions

Read and show the effective role configuration from:

```text
team/agents/team-builder.md
team/agents/team-reviewer.md
```

Do not register these definitions with the subagent extension. The global three-agent-team extension reads the canonical prompt bodies directly and creates isolated Pi child sessions with exact model and tool arguments, bypassing adaptive routing.

### 5. Verify without running a build

Confirm:

- `/team-config` reports the intended Builder and Reviewer provider/model IDs and token limits;
- role identities come from host configuration rather than copied prompt frontmatter;
- Builder receives code mutation tools;
- Reviewer receives no `edit` or `write` tool;
- execution is sequential and extension-controlled;
- `team/validate_goal_contract.py` exists;
- Pi's skill loader discovers `.pi/skills/three-agent-team/SKILL.md` without diagnostics after project trust/restart;
- Pi discovers the `/team-*` extension commands;
- no commit, push, deployment, or role inference occurred.

File existence alone is not successful verification. If the generated operational skill is not discoverable, report the exact loader diagnostic and stop. Do not spend model inference on a smoke task unless the user asks.

## Starting a task

After initialization, start Pi from the repository root and inspect the active role profile:

```text
/team-config
```

Then invoke. `/team-new` enters team inference mode and selects the configured Architect before starting discussion:

```text
/team-new <task-id> -- <task request>
```

Architect discusses and writes a structurally validated Goal Contract but never invokes roles. To stress-test an unauthorized contract one question at a time, optionally invoke:

```text
/team-grill-me <task-id>
```

After validation, choose one owner command:

```text
# Immediate execution
/team-go <task-id>

# Deferred FIFO execution; dependencies must already be earlier queue entries
/team-enqueue <task-id> [--after <task-id>[,<task-id>...]]
/team-continue
```

Queue enrollment is stricter: set `commit_on_success: true`, keep push/deploy false, commit the approved Goal Contract and every repository file, and require a completely clean Git checkout with no in-progress operation. Enrollment freezes approval externally but leaves repository `status.yaml` as unauthorized `DISCUSSING`/`PENDING`; `QUEUED` is not a repository task state. Dispatch later materializes the exact ``owner command `/team-enqueue``` authorization marker together with the full head/digest/status/external-record snapshot.

Use `/team-queue` to inspect durable order and barriers. `/team-pause` prevents the next claim but does not interrupt a running task. `/team-dequeue` applies only before any claim and only when no later entry depends on the task. A `BLOCKED` head stops the whole queue and requires explicit owner-led recovery; restart or lease expiry never silently retries it. Run `/team-continue` explicitly after restart or recovery. Recovery must match the failed attempt and queue revision, prove recorded role processes are quiescent, retain exact authorization evidence, and append a newly fenced attempt; never bypass the barrier with the immediate workflow or reset its evidence.

The extension runs Builder and Reviewer sequentially with exact local models until the task is `COMPLETED` or a genuine blocker is `BLOCKED`. Queued completion commits only the frozen reviewed tree and named evidence; unrelated Git changes block rather than being included. Plain `go` and direct `subagent` calls are intentionally rejected in initialized team repositories.

## Reference

Read [references/workflow.md](references/workflow.md) before adapting templates, operating or recovering the durable queue, diagnosing a state transition, or explaining why a safety constraint exists.
