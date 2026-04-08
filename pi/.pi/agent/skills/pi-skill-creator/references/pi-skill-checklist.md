# Pi Skill Checklist

Use this checklist when creating or reviewing a pi skill.

## Required
- Skill is in a directory containing `SKILL.md`
- Frontmatter contains `name`
- Frontmatter contains `description`
- Directory name matches `name`
- Name uses lowercase letters, numbers, hyphens only

## Trigger quality
- Description says what the skill does
- Description says when to use it
- Description includes realistic trigger contexts
- Description is not vague like "helps with X"

## Structure
- `SKILL.md` is readable and focused
- Large details moved into `references/`
- Scripts are placed in `scripts/` if needed
- Assets/templates are placed in `assets/` if needed
- Relative paths are used in references and commands

## Pi compatibility
- No unnecessary reliance on non-pi tooling
- External dependencies are explained clearly
- Instructions do not assume unavailable harness features
- Commands are realistic for the user's environment

## Quality
- The skill is not overfit to one example
- The workflow is clear
- Output expectations are explicit
- The user intent is not surprising or misleading
