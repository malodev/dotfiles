# Description Patterns

The description is the main trigger mechanism.

## Good pattern

```yaml
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents, forms, attachments, or scanned reports.
```

Why it works:
- says what the skill does
- says when to use it
- includes adjacent trigger contexts

## Weak pattern

```yaml
description: Helps with PDFs.
```

Why it fails:
- too vague
- poor trigger coverage

## Pattern for workflow skills

```yaml
description: Creates release notes from commits and PR summaries. Use when the user asks to draft changelogs, summarize releases, prepare version notes, or turn merged work into publishable release text.
```

## Pattern for project-local skills

```yaml
description: Design system and homepage guidance for the Floricoltura Martinelli WordPress site. Use when redesigning Elementor sections, choosing colors and typography, improving CTA structure, or replacing demo content with brand-consistent sections.
```

## Review questions
- Does this description mention both action and context?
- Would pi know when this should trigger?
- Is it too generic?
- Does it accidentally overlap too broadly with unrelated tasks?
