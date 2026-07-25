# Project Agent Instructions

## Read first

- Read `CONTEXT.md` for domain language and architecture.
- Read relevant ADRs under `docs/adr/` before changing architectural boundaries.
- For team-managed work, follow `.pi/skills/three-agent-team/SKILL.md`.

## Project commands

Replace placeholders during repository setup:

- Install: `[PROJECT_INSTALL_COMMAND]`
- Focused tests: `[PROJECT_FOCUSED_TEST_COMMAND]`
- Full tests: `[PROJECT_FULL_TEST_COMMAND]`
- Type check: `[PROJECT_TYPECHECK_COMMAND]`
- Lint: `[PROJECT_LINT_COMMAND]`
- Build: `[PROJECT_BUILD_COMMAND]`

Do not claim verification unless the relevant command was executed successfully.

## Safety and scope

- Do not expose or commit secrets.
- Do not modify generated files unless the repository documents that workflow.
- Do not commit, push, or deploy unless explicitly authorized in the owner-approved Goal Contract or a later direct instruction.
- Do not delete directories or run destructive commands without separate explicit owner permission.
- Keep changes within the authorized Goal Contract.
- Record out-of-scope discoveries instead of fixing them silently.
