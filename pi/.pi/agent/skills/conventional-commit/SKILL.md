---
name: conventional-commit
description: Analyzes git changes and creates conventional commits (type, scope, imperative description, descriptive body). If staging area is populated, produces one commit; if empty, groups unstaged/untracked files into logical clusters and makes multiple commits. Skips sensitive files (.env, keys, secrets). Use when user says "conventional commit", "commit this", "make a commit", "fai un commit", or asks to commit changes following a conventional commit style.
---

# Conventional Commit

## Workflow

### 1. Assess state

```bash
git status
git diff --staged          # if staged files exist
git diff                   # unstaged changes
```

### 2. Filter — never stage or commit

- `.env`, `.env.*`, `*.env`, `.env.local`
- `*.pem`, `*.key`, `*.p12`, `*.pfx`
- Files matching `*secret*`, `*credential*`, `*token*` (unless clearly safe)
- Anything in `.gitignore` that leaked into untracked

### 3A. Staged files present → one commit

Read `git diff --staged` in full, then:

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>

<body>
EOF
)"
```

### 3B. No staged files → multiple logical commits

Group files by cluster (see [REFERENCE.md](REFERENCE.md) §Grouping), then for each:

```bash
git add <files-in-cluster>
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>

<body>
EOF
)"
```

---

## Format at a glance

```
<type>(<scope>): <description>      ← max 72 chars
                                    ← blank line
<body>                              ← what + why, bullet list ok
                                    ← blank line (optional)
<footer>                            ← Closes #N  /  BREAKING CHANGE: ...
```

- **type** — `feat fix refactor perf test docs style build ci chore revert`
- **scope** — lowercase noun: `auth quiz grading snapshots db llm ui admin deps docker`
- **description** — imperative, lowercase, no period: "add validation", not "Added validation."
- **body** — explains *what* changed and *why*, not *how*; ~72 chars per line

Breaking change: `feat(auth)!: ...` + `BREAKING CHANGE: <explanation>` footer.

Full type list and examples → [REFERENCE.md](REFERENCE.md)
