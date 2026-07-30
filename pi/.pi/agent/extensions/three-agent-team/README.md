# Three-Agent Team Pi Extension

Deterministic runtime orchestration for a configurable Architect → Builder → Reviewer workflow.

## Installation

**With dotfiles:** `./install.sh pi-agent` installs the `pi` Stow package and runs `npm ci`.

**Standalone:**

```bash
# Copy or symlink the extension into Pi's extension directory
ln -s "$(pwd)" ~/.pi/agent/extensions/three-agent-team

# Install the one runtime dependency
cd ~/.pi/agent/extensions/three-agent-team && npm install --omit=dev
```

The only runtime dependency is `yaml`. The extension loads when Pi starts — no additional configuration needed.

## Skills

Companion skills instruct the AI agent how to use these extension commands:

| Skill | Purpose | Key commands used |
|---|---|---|
| `init-three-agent-team` | Set up repo scaffolding (team/ dir, validator, prompts, AGENTS.md) — run once per repo | `/team-new`, `/team-go`, `/team-enqueue` |
| `team-from-plan` | Read a plan/PRD, decompose into task manifest, and import via the durable queue | `/team-import` |

Skills provide **agent-facing workflow instructions** ("read this plan, produce a YAML manifest, then call `/team-import`"). The extension provides the **runtime implementation** (journaled transaction, contract rendering, validation, commit creation, queue enrollment). Both layers are required: the skill instructs, the extension executes.

## Commands

- `/team-config` — show the resolved role models, output limits, attempt ceilings, and timeouts.
- `/team-new <task-id> -- <request>` — select the configured Architect, create strict task templates, and begin contract discussion.
- `/team-grill-me <task-id>` — select the configured Architect and stress-test an unauthorized `DISCUSSING` contract.
- `/team-repair <task-id>` — start a fresh Architect session to repair an invalid unauthorized contract.
- `/team-validate <task-id>` — deterministically test pre-go eligibility.
- `/team-go <task-id>` — snapshot runtime choices, validate, authorize, enter team inference mode, and start immediate sequential execution.
- `/team-enqueue <task-id> [--after <task-id>[,<task-id>...]]` — approve a clean, committed task for deferred FIFO execution; queued tasks require `commit_on_success: true`.
- `/team-import team/plan.yaml` — preview: displays manifest digest, tasks, dependencies, and the exact approval command. No side effects.
- `/team-import team/plan.yaml --approve sha256:<64-hex> --head <40-hex>` — approval: executes the journaled transaction with journaled logical atomicity. Renders contracts from an atomically published immutable bundle, validates, creates an exact single-parent Git commit via a private index, enrolls all tasks in the durable FIFO queue, and recovers deterministically across crashes.
- `/team-queue` — show the durable queue, dependencies, attempts, and barrier state.
- `/team-pause` — prevent the next queue claim without interrupting an already running task.
- `/team-continue` — explicitly start or continue durable queue reconciliation and dispatch.
- `/team-dequeue <task-id>` — tombstone a queued entry only if it has never been claimed and has no dependents.
- `/team-resume <task-id>` — resume an authorized `BLOCKED` or crash-interrupted `EXECUTING` task using its task-local runtime snapshot. Invoking it on a legacy authorized task explicitly approves one-time migration of the current `HEAD` and authorized brief into the external authorization record.
- `/team-unblock <task-id> [notes]` — discuss owner-led recovery and finalize it only after the exact `finalize recovery` message.
- `/team-discard <task-id>` — archive an inactive task without deleting its evidence.
- `/team-status <task-id>` — show persisted state.
- `/team-report <task-id>` — publish the durable completion report into the current session without invoking an agent.
- `/team-cancel` — cancel the active child role and block the task.

Press Tab after `/team-new ` to insert the current local-date prefix (for example, `2026-07-22-`). If a slug is typed first, completion prepends that date. Task-oriented commands complete existing directories under `team/tasks/` and show each persisted state.

Plain `go` is intentionally rejected. Direct `subagent` calls are blocked in initialized team repositories.

## Durable queue contract

The queue is additive: `/team-go` retains the immediate single-task path, while `/team-enqueue` approves a draft for later execution. Enrollment requires a valid unauthorized `DISCUSSING` task, no stale external authorization, a full clean `HEAD`, no staged, unstaged, intent-to-add, or untracked files, no in-progress Git operation, and all task files already committed at `HEAD`. Queued tasks require `commit_on_success: true`; push and deployment remain unsupported. Dependencies must name earlier, non-dequeued entries. Repeating an identical administrative command is an idempotent no-op; conflicting immutable inputs fail closed.

Enrollment is approval, not execution authorization. The task stays repository-local `DISCUSSING` with `PENDING`, null `authorization_head`, null `contract_digest`, and null `execution_authorized_at`. `QUEUED` is deliberately not a `status.yaml` task state. The external queue freezes the approved draft digest, future authorized-contract digest, baseline, completion policy, dependency list, owner, and FIFO sequence. Only when the entry is the runnable head does the fenced dispatcher bind it to the exact clean current `HEAD`, materialize the exact marker ``AUTHORIZED at <timestamp> by owner command `/team-enqueue``` and matching status fields, and create the immutable external authorization record. Queue metadata alone can never satisfy execution validation.

Queue and authorization state live below the OS account's passwd-derived fixed `~/.local/state/pi-three-agent-team` root, keyed by canonical repository identity. Environment variables cannot redirect this trust root. Directories and files are owner-only (`0700` and `0600`), writes are durable and atomic, and kernel advisory locks are never broken by file age.

### Queue states

| State | Allowed next state | Meaning |
|---|---|---|
| `QUEUED` | `RUNNING`, `DEQUEUED` | Approved but never dispatched |
| `RUNNING` | `BLOCKED`, `COMPLETED` | One immutable dispatch attempt owns the FIFO head |
| `BLOCKED` | `RUNNING` after explicit matching owner recovery | Queue-wide barrier; never skipped |
| `COMPLETED` | none | Exact completion commit recorded; advances expected head |
| `DEQUEUED` | none | Never-dispatched tombstone; does not authorize execution |

Each initial or recovery attempt is append-only and advances in order:

```text
CLAIMED → AUTHORIZING → AUTHORIZED → EXECUTING → VERIFIED → COMMITTING → COMPLETED
```

Any nonterminal phase may end at terminal `BLOCKED`. A claimed attempt is never reset to `QUEUED`, reused, or silently retried. The earliest nonterminal FIFO entry is the only runnable entry; `RUNNING` and `BLOCKED` are barriers for everything behind them. `/team-pause` lets the current attempt reach its normal terminal or blocked outcome but prevents another claim. `/team-dequeue` is forbidden after the first claim. After restart, run `/team-queue`, resolve any barrier with the owner-led `/team-unblock` flow, then run `/team-continue`; startup and lease expiry never imply permission to rerun stale work.

The dispatcher lease coordinates queue ownership; the separately acquired host-global inference lease controls model capacity. Both renew independently. A monotonically increasing fencing token plus the long-lived repository execution lock prevents an expired dispatcher from authorizing, writing evidence, or committing after takeover. Ambiguous stale `RUNNING` work, an uncertain live child, or mismatched journal/repository state becomes `BLOCKED`; arbitrary current `HEAD` is never adopted.

### Exact queued execution and completion

`/team-continue` retains its Pi command context while it drains FIFO entries until idle, paused, or blocked. After deferred authorization, the dispatcher records `EXECUTING`, then the workflow acquires the separate host-global inference lease and runs Builder followed by Reviewer. Every role process starts through a stop-before-exec launcher: PID and process-start identity are journaled under the current attempt and fence before the executable receives `SIGCONT`. Queue-lease, repository-lock, or inference-lease loss aborts the workflow and process group.

Reviewer approval freezes the complete reviewed worktree into an isolated temporary Git index using an explicit path universe. Verification may subsequently change only the named extension-owned evidence files `status.yaml`, `verification.log`, and `completion-report.md`. Any other post-review path change blocks completion. The extension creates an exact single-parent commit with `git commit-tree`, journals its tree, parent, subject, and commit SHA in `COMMITTING`, installs it with `git update-ref` compare-and-swap, normalizes only the real index, and verifies a clean worktree. It never invokes `git reset --hard` and never adopts arbitrary current `HEAD`.

An executor-less dispatcher invocation remains available only as a fail-closed test/installation diagnostic and records the historical blocker before model execution. Production `/team-continue` always supplies the fenced executor.

## Configuration

The host-level configuration is:

```text
~/.config/pi-three-agent-team/config.json
```

`PI_THREE_AGENT_CONFIG` may point to another file. The stowed configuration is shared by local and remote clients. It defines providers, all three role models, context/output limits, thinking levels, attempt ceilings, role/inactivity timeouts, queue lease/heartbeat/lock timing, and the acquire/renew/release commands for the host-global inference lease. Queue dispatcher leases and inference leases are separate; queue timing is not copied into task-local role snapshots.

The current profile uses:

- Architect: `pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL`
- Builder: `pi-llama/pi/Qwen3.6-27B-MTP-UD-Q5_K_XL`
- Reviewer: `pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL`
- Output allowance: 32768 tokens per model response

Changing future role models requires configuration and router-preset edits, not extension source changes. At authorization or first legacy-task resume, the extension writes a non-secret `runtime-config.json` into the task. That snapshot keeps provider/model identities, token metadata, and bounded limits stable for the task even when host defaults later change.

## Runtime behavior

The extension bypasses adaptive routing and starts isolated Pi child sessions with exact configured CLI model arguments. It generates a temporary child `PI_CODING_AGENT_DIR`, including a role-specific model catalog, so output limits are enforced without mutating global Pi settings and without read-only settings-lock warnings.

Children run sequentially with extensions and skills disabled. Each Builder or Reviewer cycle uses one persistent Pi session. A provider/model-verified `length` stop after measurable progress is persisted and automatically continued in that same session. It consumes one bounded attempt rather than blocking immediately. Repeated output-limit stops still fail closed when the configured cumulative attempt ceiling is exhausted.

Builder children run inside Bubblewrap with a synthetic `/dev`, hidden DBus sockets, a read-only host filesystem, and only the repository plus `/tmp` writable. Reviewer children receive no direct `edit` or `write` tools, but their `bash` restriction remains prompt-enforced rather than a technical read-only boundary. Dedicated npm, UV, and XDG caches live under `/tmp`.

A confirmed exact-model, tool-productive inactivity timeout is also persisted and retried in the same session. Wrong provider/model identity, non-retryable transport/process errors, empty no-progress responses, validator failures, exhausted ceilings, and missing required artifacts remain fail-closed. Every attempt records requested/response identity, stop reason, tool count, stderr, and final output.

Selecting a model from a lifecycle-managed provider such as `pi-llama` asks the shared `pi-inference` client to make team mode ready. Interactive managed-model turns acquire an expiring lease. Acquisition failure calls Pi's real agent abort path, and a final `before_provider_request` gate refuses any managed-provider request without confirmed healthy ownership. An authorized workflow acquires one host-global lease before Builder execution, renews it for the full Builder → Reviewer lifecycle, aborts before its local safety deadline if renewal fails, and releases it after completion, block, cancellation, or shutdown. Local clients use the manager's mode-0600 Unix socket; remote clients use the separately authenticated HTTPS control endpoint. Legacy configurations without all three lease commands retain the old one-shot `enterTeamCommand` behavior. `restoreStudioAfterRun` remains false by default; use `pi-inference studio` explicitly when returning to Studio.

## Contract

Repositories must contain:

- `team/validate_goal_contract.py` (an agent-facing convenience copy; extension runtime gates use the trusted bundled validator)
- `team/agents/team-builder.md`
- `team/agents/team-reviewer.md`
- a strict task under `team/tasks/<task-id>/`

Runtime authorization and execution gates always invoke the bundled validator from the global installation, never a Builder-writable repository copy. The discussion baseline may remain an ancestor while Goal Contract and reference commits advance `HEAD`. At immediate `/team-go`, or at fenced dispatch after `/team-enqueue`, the extension records the exact `authorization_head` and a SHA-256 digest of the authorized brief in task metadata and an immutable extension-owned record. The external record is outside the Builder-writable repository. Execution validation accepts only the exact immediate owner-message marker or queued owner-command marker and still requires matching timestamp, `HEAD`, brief digest, status fields, and external record. Snapshot drift fails closed. Immediate `/team-go` and queued execution share the same fenced workflow and exact-tree completion boundary. Queued tasks require commit-on-success; push and deployment are refused.

## Development

```bash
# Full CI suite
npm run test:three-agent-team                    # all node + validator + inference tests
npm run test:team-import-crash-matrix            # 9 SIGKILL/matrix crash tests
npm run test:team-import-clean-install           # clean-install smoke test

# Individual suites (from extension directory)
cd pi/.pi/agent/extensions/three-agent-team
npm run test:node                                # 144 unit + integration tests
npm run test:validator                           # 11 Python validator tests
npm run test:crash-matrix                        # crash recovery tests
npm run test:clean-install                       # extension-load smoke test
npm run test:production                          # handler + crash tests
npm run test:unit                                # core + queue + manifest tests
npm run test:integration                         # integration tests

# Type check
npx tsc --noEmit --skipLibCheck --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2023 --types node pi/.pi/agent/extensions/three-agent-team/*.ts pi/.pi/agent/extensions/three-agent-team/test/*.ts

# Load extension
pi -e ./index.ts --list-models
```

Use `PI_THREE_AGENT_PI_BIN` only in tests to replace the spawned Pi executable.
