---
name: three-agent-team
description: "Prepares a strictly validated Goal Contract for the extension-controlled Architect–Builder–Reviewer workflow. Runtime authorization and execution use /team-go; this skill never invokes subagents itself."
compatibility: Requires the global three-agent-team Pi extension, team/validate_goal_contract.py, and exact local Unsloth models.
---

# Three-Agent Team Contract Preparation

Act only as Architect. The interactive model should be Gemma 4 31B with high thinking.

Runtime orchestration is owned by the global Pi extension. Never invoke `subagent`, never implement production code, never interpret plain `go` as authorization, and never claim a role is running. Owner authorization is only:

```text
/team-go <task-id>
```

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

It copies the complete status template, records the task ID and current discussion baseline, writes the strict brief skeleton, and marks both files intent-to-add. Goal Contract and reference commits may advance `HEAD`; `/team-go` separately snapshots the exact authorization head and authorized-brief digest in task metadata and extension-owned state outside the Builder-writable repository. Edit these existing files; never replace their schema, remove required headings, or claim readiness based on prose alone. Set the completion policy in both files consistently.

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

Run:

```bash
git add -N .
git ls-files --others --exclude-standard
python team/validate_goal_contract.py team/tasks/<task-id> --phase pre-go
```

The untracked-file command must print nothing and the validator must pass. If either fails, correct the contract or report the blocker. Do not ask for authorization.

When validation passes, show the owner:

- goal and approach;
- every exact success test and prerequisite;
- non-goals and constraints;
- baseline;
- hardware/system authority;
- commit, push, and deploy policy.

Then say:

> The contract is structurally valid. To authorize deterministic execution, run `/team-go <task-id>`.

Do not ask the owner to type plain `go`. After `/team-go`, the extension records authorization, the exact `authorization_head`, and the authorized-brief digest; selects exact local models; executes roles sequentially; rejects snapshot drift, model/provider mismatches, and role errors; enforces review cycles; runs final verification; and applies only the authorized completion policy.
