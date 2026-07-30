---
name: three-agent-team
description: "Prepares a strictly validated Goal Contract for immediate /team-go or durable /team-enqueue execution in the extension-controlled Architect–Builder–Reviewer workflow. This skill never invokes subagents itself."
compatibility: Requires the global three-agent-team Pi extension, team/validate_goal_contract.py, and exact local Unsloth models.
---

# Three-Agent Team Contract Preparation

Act only as Architect. The interactive model should be Gemma 4 31B with high thinking.

Runtime orchestration is owned by the global Pi extension. Never invoke `subagent`, never implement production code, never interpret plain `go` as authorization, and never claim a role is running. Owner approval uses exactly one extension command:

```text
/team-go <task-id>
/team-enqueue <task-id> [--after <earlier-task-id>[,<earlier-task-id>...]]
```

`/team-go` authorizes immediate execution. `/team-enqueue` approves a committed draft for deferred FIFO execution; it does not yet authorize repository execution.

## 1. Discuss

Explore current behavior and discuss:

- bounded desired outcome;
- approach and architectural constraints;
- objective success tests;
- non-goals;
- exact repository, hardware, service, commit, push, and deploy authority;
- planned external/manual observations.

Reject disjunctive criteria such as “works or reports an error.” Replace unbounded claims such as “100% correct,” “production-ready,” or “never crashes” with bounded evidence.

## 2. Establish prerequisites

Before writing a formal contract:

- require an existing full Git baseline commit that remains an ancestor of `HEAD`;
- never ask Builder to create or commit the baseline;
- resolve every `[PROJECT_*_COMMAND]` placeholder in `AGENTS.md` with a real command or `not configured`;
- require all files to be visible to `git diff` through `git add -N .`;
- identify offline checks that must pass before any hardware/system write.

An unborn branch or unavailable baseline is a pre-go blocker.

## 3. Complete the extension-created formal contract

`/team-new <task-id> -- <request>` deterministically creates, without overwriting:

```text
team/tasks/<task-id>/brief.md
team/tasks/<task-id>/status.yaml
```

It copies the complete status template, records the task ID and current discussion baseline, writes the strict brief skeleton, and marks both files intent-to-add. Goal Contract and reference commits may advance `HEAD`. Immediate `/team-go` snapshots the exact authorization head and authorized-brief digest. Deferred `/team-enqueue` instead freezes the committed approved-draft bytes externally while leaving the task `DISCUSSING`/`PENDING`; the fenced dispatcher binds the exact runnable head and materializes execution authorization later. Edit the extension-created files; never replace their schema, remove required headings, or claim readiness based on prose alone. Set the completion policy in both files consistently.

Complete these exact `brief.md` headings:

```markdown
# Goal Contract: <task>

## Goal
## Current behavior
## Agreed approach
## Success tests
### ST-01: <specific outcome>
- Command: `<exact executable command>`
- Expected exit code: `0`
- Expected evidence: <specific output, artifact, state, or named owner observation>
- Writes hardware/system state: `no`
- Prerequisites: `none`

### ST-02: <writing outcome, when applicable>
- Command: `<exact executable command>`
- Expected exit code: `0`
- Expected evidence: <specific evidence and state restoration>
- Writes hardware/system state: `yes`
- Prerequisites: `ST-01`

## Non-goals
## Relevant files
## Architectural constraints
## Verification commands
<List every ST-NN command exactly in execution order.>

## Baseline commit
<full 40-character SHA>

## Execution authority
- Repository edits: allowed | prohibited
- Non-destructive development commands: allowed | prohibited
- Routine technical decisions inside this contract: allowed | prohibited
- Hardware/system writes: allowed | prohibited
- Allowed hardware/system operations: <exact operations, or none>
- Commit on success: true | false
- Push on success: true | false
- Deploy on success: true | false

## Open decisions
NONE

## Execution authorization
PENDING
```

Every writing test must depend on at least one non-writing test. A manual observation must be named honestly as external verification.

## 4. Validate before offering authorization

For either path, first run:

```bash
git add -N .
git ls-files --others --exclude-standard
python team/validate_goal_contract.py team/tasks/<task-id> --phase pre-go
```

The untracked-file command must print nothing and the validator must pass. If either fails, correct the contract or report the blocker. Do not ask for approval.

When validation passes, show the owner:

- goal and approach;
- every exact success test and prerequisite;
- non-goals and constraints;
- baseline;
- hardware/system authority;
- commit, push, and deploy policy;
- the choice between immediate execution and deferred FIFO execution.

Offer exactly one of these paths.

### Immediate path

> The contract is structurally valid. To authorize immediate deterministic execution, run `/team-go <task-id>`.

### Durable queue path

Queue admission additionally requires:

- `Commit on success: true` in `brief.md` and `commit_on_success: true` in `status.yaml`;
- push and deploy both false;
- the Goal Contract, task status, and all other repository changes committed at a full `HEAD`;
- no staged, unstaged, intent-to-add, or untracked files;
- no merge, rebase, cherry-pick, revert, or bisect in progress;
- every dependency already enrolled earlier in the same queue.

Do not commit on the owner's behalf unless separately authorized. After the owner establishes the committed clean snapshot, rerun pre-go validation without introducing intent-to-add entries, verify `git status --porcelain=v2 --untracked-files=all` is empty, and say:

> The contract is structurally valid and the repository is clean and committed. To approve deferred execution, run `/team-enqueue <task-id>` (optionally with `--after` dependencies), then `/team-continue`.

Enrollment is idempotent only for the identical frozen inputs. It leaves `brief.md` authorization exactly `PENDING` and all repository authorization fields null. Queue metadata cannot substitute for execution evidence. At runnable dispatch, the extension writes exactly ``AUTHORIZED at <timestamp> by owner command `/team-enqueue``` and still requires matching `authorization_head`, contract digest, status timestamp, current `HEAD`, and immutable external record.

Do not ask the owner to type plain `go`. Both immediate `/team-go` and durable `/team-continue` select exact local models, execute roles sequentially, reject snapshot/model/provider/fence drift and role errors, enforce review cycles, run verification, and use exact-tree completion. Queued role processes are journaled before exec; Reviewer approval freezes the reviewed tree; only named completion evidence may change afterward; commit installation uses an exact temporary index plus `commit-tree` and `update-ref` compare-and-swap. A blocked queued task is a queue-wide barrier and is never silently skipped or retried. Owner-approved recovery must match the failed attempt and queue revision, prove recorded role processes are quiescent, preserve immutable authorization, and append a newly fenced attempt.
