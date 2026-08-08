---
name: team-amend-contracts
description: Correct the approved Goal Contracts of tasks already enrolled in the three-agent team queue but not yet dispatched, as one atomic amendment.
compatibility: Requires the global three-agent-team Pi extension and team/validate_goal_contract.py.
---

# Queued Contract Amendment

Act only as Architect. A batch of tasks is already enrolled in the durable queue, and one or more of their Goal Contracts is wrong. Produce a strict `team/amendment.yaml` describing the exact text edits, then hand the owner the preview command.

Use this when tasks are **enrolled but never dispatched**. If a task has been claimed, authorized, or executed, amendment is refused — that task needs `/team-unblock` or `/team-discard` instead.

## Why this exists

Enrolling a task freezes its approved-brief and contract digests in the queue. Editing `brief.md` afterwards makes the committed bytes disagree with the frozen digests, and the dispatcher fails closed with *"Deferred authorization snapshot drift"*. Without an amendment the only recovery is dequeuing every affected task in reverse dependency order and re-importing, which discards the queue epoch.

`/team-amend` applies the edits, re-validates **every** queued contract, commits exactly, and advances the queue to a new epoch carrying the corrected digests — as one journaled, crash-resumable transaction.

## Workflow

### Phase 1: Establish what is wrong and what is amendable

1. **Inspect the queue**: `/team-queue`. Note which entries are `QUEUED` with no attempts — only those can be amended.
2. **Read the affected contracts** at `team/tasks/<task-id>/brief.md`.
3. **Identify the exact defect**. Common cases: a success-test `Command` that is not executable, a command that disagrees with the `Verification commands` list, a placeholder that survived, an `Open decisions` section that is not `NONE`.

### Phase 2: Compute exact edits

Each edit is an `old_text` → `new_text` replacement that must match **exactly once** in the file. This is deliberate: an ambiguous edit is refused rather than guessed.

Two rules that catch most mistakes:

- **A command usually appears twice** — once in the `### ST-NN` block as `- Command: \`…\`` and once under `## Verification commands`. The validator requires them to agree, so correcting a command means **two edits**, each with enough surrounding text to be unique.
- **Include enough context to be unique.** Prefer `- Command: \`pytset -q\`` over `pytset -q`.

### Phase 3: Write the manifest

Show the proposed `team/amendment.yaml` to the owner and only write it after they confirm.

```yaml
version: 1
amendment_id: fix-success-test-commands
subject: "fix: correct success-test commands for queued tasks"
tasks:
  - 2026-08-02-first-task
edits:
  - path: team/tasks/2026-08-02-first-task/brief.md
    old_text: "- Command: `pytset -q`"
    new_text: "- Command: `pytest -q`"
  - path: team/tasks/2026-08-02-first-task/brief.md
    old_text: "1. `pytset -q`"
    new_text: "1. `pytest -q`"
```

Schema constraints, all enforced:

- `amendment_id` matches `^[a-z0-9][a-z0-9._-]*$` and names the journal — reusing an id resumes that amendment rather than starting a new one.
- `subject` is a single-line commit subject.
- `tasks` is non-empty, unique, and **every listed task must have at least one edit to its `brief.md`**.
- `edits[].path` must be `team/tasks/<listed-task-id>/brief.md`. No other file may be amended: `status.yaml` and the evidence files are extension-owned.
- `old_text` must be non-empty and differ from `new_text`. `new_text` may be empty to delete text.

### Phase 4: Hand off to the owner

1. **Commit the manifest**:
   ```bash
   git add team/amendment.yaml && git commit -m 'chore(team): add contract amendment'
   ```
2. **Preview** (no side effects):
   ```
   /team-amend team/amendment.yaml
   ```
   The preview prints the manifest digest, current `HEAD`, affected tasks, edited paths, the exact approval command, and a warning for any listed task that is no longer amendable.
3. **The owner approves** by running the exact command from the preview:
   ```
   /team-amend team/amendment.yaml --approve sha256:<digest> --head <sha>
   ```

Approval is bound to both the digest and the head: if the manifest or the repository moved since the preview, it is refused.

## What the extension does on approval

- Verifies the dispatcher is idle, the repository is strictly clean, and `HEAD` equals the queue's expected head.
- Verifies every named task is `QUEUED`, unclaimed, and unauthorized.
- Applies the edits and re-runs the bundled validator over **every** queued contract, not just the amended ones — a shared edit can break a task it never named.
- Creates an exact single-parent commit and advances the queue to a new epoch with the recomputed digests, journaled `PREPARED → GIT_INSTALLED → COMPLETED` so a crash resumes rather than corrupts.

## Output

After writing the manifest, summarize:

```
Created team/amendment.yaml — amendment '<amendment-id>' over N task(s):
1. <task-id> — <what is being corrected> (M edits)

Next steps:
1. Review the edits above
2. Commit: git add team/amendment.yaml && git commit -m 'chore(team): add contract amendment'
3. Preview: /team-amend team/amendment.yaml
4. Approve: /team-amend team/amendment.yaml --approve sha256:<digest> --head <sha>
5. Execute: /team-continue
```

## Constraints

- Do not implement production code
- Do not invoke Builder or Reviewer roles
- Do not run `/team-amend --approve` yourself; the owner must review the preview first
- Do not amend `status.yaml`, `verification.log`, `completion-report.md`, or any other extension-owned file
- Do not attempt to amend a task that has been claimed, authorized, or dispatched — use `/team-unblock` or `/team-discard`
- Every `old_text` must match its file exactly once; add surrounding context rather than guessing
