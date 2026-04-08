---
name: pi-skill-creator
description: Create new pi skills, refine existing skills, and structure skill folders for pi. Use when the user wants to build a new skill, turn a workflow into a reusable skill, improve a skill description for better triggering, reorganize SKILL.md and references, or adapt third-party skills to pi's skill format.
license: Derived local adaptation for pi from the installed skill-creator reference and pi skill documentation.
compatibility: Designed for pi skills in ~/.pi/agent/skills, ~/.agents/skills, .pi/skills, and .agents/skills. Uses pi-compatible file operations only.
---

# Pi Skill Creator

This skill helps create and improve **pi-native skills**.

It is intentionally simpler and more portable than the original `skill-creator` reference. Use it to design, write, review, and iterate on skills that follow pi's documented skill structure.

## When to use

Use this skill when the user wants to:
- create a new pi skill from scratch
- convert an existing workflow into a skill
- improve an existing `SKILL.md`
- split a large skill into `references/`, `scripts/`, and assets
- rewrite a third-party skill so it works better in pi
- improve a skill's trigger description
- add project-local or global skills in the correct folder

## What a good pi skill looks like

A pi skill should usually be a directory like this:

```text
skill-name/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

Only `SKILL.md` is required.

## Core workflow

When building or improving a skill, follow this sequence.

### 1. Capture intent
Understand:
1. What task the skill should help with
2. When it should trigger
3. What output or behavior is expected
4. Whether the task is objective, subjective, or mixed
5. Whether the skill should be global or project-local

If the user is asking to “turn this into a skill”, extract the workflow from the current conversation first.

### 2. Decide the scope
Determine whether the skill should be:
- **small and direct** — a single focused workflow
- **structured with references** — a skill with variants or detailed docs
- **script-assisted** — if deterministic or repetitive steps are better handled by code

Do not overbuild. Start as small as possible.

### 3. Design the trigger description
The frontmatter `description` is the main trigger mechanism.
It should clearly say:
- what the skill does
- when to use it
- what kinds of user requests should activate it

Good descriptions are specific and practical, not abstract.

### 4. Write the skill
Create:
- frontmatter
- clear markdown instructions
- references only when needed
- scripts only when they add real value

Prefer imperative, practical instructions.

### 5. Test the skill
Create 2–5 realistic prompts that a real user might type.
Use them to check:
- would the description trigger the skill?
- is the skill understandable?
- are the instructions too vague, too long, or too rigid?
- does the structure encourage good execution?

### 6. Iterate
Improve based on:
- ambiguity
- undertriggering or overtriggering
- redundant instructions
- missing examples
- poor structure
- instructions that assume unavailable tools

## Pi-specific rules

### Skill placement
Use one of these locations depending on scope:
- Global: `~/.pi/agent/skills/`
- Project: `.pi/skills/`
- Alternative locations supported by pi: `~/.agents/skills/`, `.agents/skills/`

### Naming
The skill directory name and frontmatter `name` must match.

Use:
- lowercase letters
- numbers
- hyphens

Avoid:
- spaces
- uppercase
- underscores
- decorative names

### Progressive disclosure
Keep `SKILL.md` focused.
If the skill becomes large:
- move details into `references/`
- point clearly to which reference to read and when

### Relative paths
All paths mentioned in the skill should be relative to the skill directory whenever possible.

Example:
```markdown
See [reference guide](references/guide.md).
Run `python scripts/process.py input.json`.
```

### Pi compatibility first
Do not assume:
- Claude-only tools
- special browser-review pipelines
- proprietary task notifications
- platform-specific packaging formats
- unavailable benchmark viewers

If a workflow depends on external tools, say so explicitly under setup or compatibility.

## Writing guidance

### Keep the body practical
Prefer:
- short sections
- clear headings
- explicit sequences
- examples of good inputs and outputs

Avoid:
- long philosophical detours
- environment-specific instructions unless necessary
- giant mandatory procedures for small skills

### Explain why
Try to explain why an instruction matters instead of only writing rigid rules.

### Avoid overfitting
A skill should generalize beyond the examples used to design it.

## Recommended skill template

```markdown
---
name: skill-name
description: What the skill does and when to use it. Include concrete trigger contexts.
compatibility: Optional environment or dependency note.
---

# Skill Name

## Overview
What this skill helps accomplish.

## When to use
- Situation 1
- Situation 2
- Situation 3

## Workflow
1. Step one
2. Step two
3. Step three

## Output expectations
Describe the expected output format or result.

## References
See [deeper guide](references/guide.md) when needed.
```

## Testing checklist

When reviewing a skill, check:
- Is the description specific enough to trigger correctly?
- Is the skill too broad or too narrow?
- Does `SKILL.md` stay readable?
- Are references split sensibly?
- Are tool assumptions explicit?
- Does the skill use relative paths correctly?
- Does the directory name match the frontmatter `name`?

## Output modes for this skill

When asked to create or improve a skill, produce one of these:

### A. Draft mode
Provide:
- proposed skill name
- description
- folder structure
- draft `SKILL.md`

### B. Refactor mode
Provide:
- what is wrong with the current skill
- a rewritten structure
- changes to frontmatter
- suggested references/scripts split

### C. Review mode
Provide:
- compliance check against pi skill rules
- triggering quality review
- clarity review
- portability review
- concrete improvements

## Reference files

For more detail, use:
- [pi-skill-checklist](references/pi-skill-checklist.md)
- [description-patterns](references/description-patterns.md)
- [skill-review-rubric](references/skill-review-rubric.md)

## Default behavior

If the user is vague, default to:
1. interview briefly
2. propose a minimal skill
3. place it in the right location
4. keep `SKILL.md` concise
5. create references only if they add real clarity
