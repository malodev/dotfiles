---
name: team-from-plan
description: Decompose a plan file into a strict YAML task manifest and import it into the three-agent team queue.
compatibility: Requires the global three-agent-team Pi extension, team/validate_goal_contract.py, and exact local Unsloth models.
---

# Three-Agent Team Plan Decomposition

Act only as Architect. Read the provided plan file (and optional PRD), cross-reference them, and decompose the requirements into a strict YAML manifest of three-agent tasks with proper dependencies and executable success tests.

## Input Arguments

- `<plan-file>`: Path to the plan file (required)
- `[<prd-file>]`: Path to the PRD file for additional context (optional)

## Workflow

### Phase 1: Generate Manifest

1. **Read the plan file** at the provided path
2. **Read the PRD file** (if provided) for additional context and validation
3. **Compute SHA-256 digests** of both input files using:
   ```bash
   sha256sum <file-path>
   ```
4. **Analyze the plan** and identify discrete tasks:
   - Each task should be a bounded, atomic unit of work
   - Tasks should have clear success criteria with executable test commands
   - Dependencies between tasks should be explicit (task B depends on task A)
   - Tasks should be strictly ordered so dependencies appear before dependents
5. **Generate and display the YAML manifest**: Produce a strict `team/plan.yaml` preview and show the proposed content to the owner for review. Only write the file after the owner confirms. The schema is:
   ```yaml
   version: 1
   sources:
     plan:
       path: <plan-file-path>
       sha256: <64-char-hex-digest>
     prd:  # optional
       path: <prd-file-path>
       sha256: <64-char-hex-digest>
   tasks:
     - id: 2026-07-28-setup-database-schema
       goal: <clear statement of what this task achieves>
       current_behavior: <describe observed baseline behavior>
       agreed_approach: <describe bounded implementation approach>
       success_tests:
         - id: ST-01
           title: <brief description of what this test verifies>
           command: <exact executable command>
           expected_exit_code: 0
           expected_evidence: <specific output or state>
           writes_hardware_or_system_state: false
           prerequisites: []  # list of other ST-NN IDs
       non_goals:
         - <explicit exclusion>
       relevant_files:
         - <path or discovery boundary>
       architectural_constraints:
         - <invariant or prohibited behavior>
       execution_authority:
         repository_edits: true
         non_destructive_development_commands: true
         routine_technical_decisions: true
         hardware_system_writes: false
         allowed_hardware_system_operations: []
       completion_policy:
         commit_on_success: true
         push_on_success: false
         deploy_on_success: false
       depends_on: []  # list of task IDs
   ```
   - Generate task IDs using the current date prefix (e.g., `2026-07-28-<slug>`)
   - Each task must have at least one success test with a real executable command
   - Dependencies must form a valid DAG (no cycles)
   - Dependencies must appear earlier in the tasks array than their dependents

### Phase 2: Review and Approve

6. **Preview the manifest** by running:
   ```
   /team-import team/plan.yaml
   ```
   This displays:
   - Manifest digest (sha256:...)
   - Initial HEAD commit
   - All tasks with their dependencies
   - Exact approval command

7. **Owner reviews** the preview output and verifies:
   - All tasks are present and correctly described
   - Dependencies form a valid DAG (no cycles)
   - Success tests are executable and verifiable
   - Task IDs follow the date-slug format

8. **Approve and import** by running the exact command shown in the preview:
   ```
   /team-import team/plan.yaml --approve sha256:<digest> --head <sha>
   ```
   This creates a journaled transaction that:
   - Renders all task contracts (brief.md + status.yaml)
   - Validates all tasks with the trusted validator
   - Creates an exact Git commit with all task files
   - Enqueues all tasks in the durable queue with dependencies
   - Completes the journal

## Task Decomposition Guidelines

- **Granularity**: Each task should be completable in a single Builder cycle (minutes to hours, not days)
- **Atomicity**: A task should produce a verifiable outcome (tests pass, feature works, etc.)
- **Dependencies**: If task B requires task A's output, B depends on A
- **Ordering**: Tasks with no dependencies can run in parallel; dependent tasks run sequentially
- **Naming**: Use descriptive slugs that reflect the task's purpose
- **Success Tests**: Each test must be a real executable command with specific expected output or exit code

## Output

After generating the manifest, provide a summary:

```
Created strict manifest at team/plan.yaml with N tasks:
1. <task-id-1> - <brief goal> (no dependencies, M success tests)
2. <task-id-2> - <brief goal> (depends on: <task-id-1>, M success tests)
...

Next steps:
1. Review the manifest and adjust if needed
2. Commit: git add team/plan.yaml && git commit -m 'chore(team): add task manifest'
3. Preview: /team-import team/plan.yaml
4. Approve: /team-import team/plan.yaml --approve sha256:<digest> --head <sha>
5. Execute: /team-continue
```

## Constraints

- Do not implement production code
- Do not invoke Builder or Reviewer roles
- Do not claim readiness until the manifest is written and summarized
- Do not execute `/team-import --approve` yourself; the owner must review the preview first
- All success tests must be real executable commands, not placeholders
- Completion policy must be commit_on_success: true, push/deploy: false (V1 constraint)
