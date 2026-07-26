# Three-Agent Team Pi Extension

Deterministic runtime orchestration for a configurable Architect → Builder → Reviewer workflow.

## Commands

- `/team-config` — show the resolved role models, output limits, attempt ceilings, and timeouts.
- `/team-new <task-id> -- <request>` — select the configured Architect, create strict task templates, and begin contract discussion.
- `/team-grill-me <task-id>` — select the configured Architect and stress-test an unauthorized `DISCUSSING` contract.
- `/team-repair <task-id>` — start a fresh Architect session to repair an invalid unauthorized contract.
- `/team-validate <task-id>` — deterministically test pre-go eligibility.
- `/team-go <task-id>` — snapshot runtime choices, validate, authorize, enter team inference mode, and start sequential execution.
- `/team-resume <task-id>` — resume an authorized `BLOCKED` or crash-interrupted `EXECUTING` task using its task-local runtime snapshot. Invoking it on a legacy authorized task explicitly approves one-time migration of the current `HEAD` and authorized brief into the external authorization record.
- `/team-unblock <task-id> [notes]` — discuss owner-led recovery and finalize it only after the exact `finalize recovery` message.
- `/team-discard <task-id>` — archive an inactive task without deleting its evidence.
- `/team-status <task-id>` — show persisted state.
- `/team-report <task-id>` — publish the durable completion report into the current session without invoking an agent.
- `/team-cancel` — cancel the active child role and block the task.

Press Tab after `/team-new ` to insert the current local-date prefix (for example, `2026-07-22-`). If a slug is typed first, completion prepends that date. Task-oriented commands complete existing directories under `team/tasks/` and show each persisted state.

Plain `go` is intentionally rejected. Direct `subagent` calls are blocked in initialized team repositories.

## Configuration

The host-level configuration is:

```text
~/.config/pi-three-agent-team/config.json
```

`PI_THREE_AGENT_CONFIG` may point to another file. The stowed configuration is shared by local and remote clients. It defines providers, all three role models, context/output limits, thinking levels, attempt ceilings, role/inactivity timeouts, and the acquire/renew/release commands for the host-global inference lease.

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

Runtime authorization and execution gates always invoke the bundled validator from the global installation, never a Builder-writable repository copy. The discussion baseline may remain an ancestor while Goal Contract and reference commits advance `HEAD`. At `/team-go`, the extension records the exact `authorization_head` and a SHA-256 digest of the authorized brief in both task metadata and an extension-owned record under the OS account's fixed `~/.local/state/pi-three-agent-team` directory (resolved from the passwd database, not Builder-controlled environment variables). The external record is outside the Builder-writable repository. Execution fails closed if `HEAD`, the brief, or the task metadata later drifts. The extension executes success tests in prerequisite order. V1 supports commit-on-success but deliberately refuses push or deployment.

## Development

```bash
node --test core.test.ts
python -m unittest discover -s ../../skills/init-three-agent-team/tests -v
pi -e ./index.ts --list-models
```

Use `PI_THREE_AGENT_PI_BIN` only in tests to replace the spawned Pi executable.
