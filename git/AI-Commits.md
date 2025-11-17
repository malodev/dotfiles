# AI-Powered Conventional Commit Messages for Lazygit

## Overview

This guide provides a complete setup for using AI to generate conventional commit messages in lazygit, with support for multiple AI backends (remote and local) and automatic scope detection based on project structure.

## Key Concepts

### Two Complementary Approaches

1. **Explicit AI commit** (`ai-commit` script): Choose your AI model and get scoped commit messages
2. **Automatic AI suggestions** (Git hook): Get AI-generated messages on every normal `git commit` or lazygit `c`

### Why `llm` CLI?

- **`llm`** (by Simon Willison): Minimal, scriptable, plugin-based CLI for LLMs
  - Perfect for scripting and git hooks
  - Supports OpenAI-compatible APIs natively (no plugin needed)
  - Plugin ecosystem for local models (Ollama, MLX, GGUF, etc.)
- **`aichat`** (optional): Rich TUI for interactive AI conversations
  - Can be configured to use the same backends as `llm`
  - Great for general coding questions and refactoring

### GitHub Copilot Note

GitHub Copilot **cannot** be used directly with `llm` as it doesn't expose a generic chat API. Use Copilot in your editor (Neovim) or via `gh copilot` CLI separately.

---

## Complete Setup

### 1. Install `llm` and Plugins

```bash
# Install llm
pip install llm

# Install plugins for local models
llm install llm-ollama          # for Ollama
# Optional: llm-gguf, llm-mlx, etc.

# Install plugins for remote APIs (optional)
llm install llm-mistral
llm install llm-anthropic
llm install llm-openrouter
```

### 2. Configure AI Models

#### OpenAI-compatible APIs (no plugin needed)

```bash
# OpenAI
llm models create my-remote \
  --base-url https://api.openai.com/v1 \
  --api-key "$OPENAI_API_KEY" \
  --type openai

# LM Studio (local OpenAI-compatible server)
llm models create lmstudio:local \
  --base-url http://127.0.0.1:1234/v1 \
  --api-key "lmstudio" \
  --type openai

# Msty API (if OpenAI-compatible)
llm models create msty:chat \
  --base-url https://api.msty.ai/v1 \
  --api-key "$MSTY_API_KEY" \
  --type openai
```

#### Ollama (via plugin)

```bash
llm install llm-ollama
# Follow plugin docs to create models, e.g.:
# llm ollama models create llama3.2
# Then use: ollama:llama3.2
```

### 3. Create `ai-commit` Script

Create `~/bin/ai-commit`:

```bash
#!/usr/bin/env bash
set -euo pipefail

MODEL="${1:-my-remote}"      # default LLM model label configured in `llm`

# 1. Collect staged changes
DIFF=$(git diff --cached --no-color)
if [ -z "$DIFF" ]; then
  echo "No staged changes."
  exit 1
fi

STAGED_FILES=$(git diff --cached --name-only)

SCOPE=""

# ---------- Scope heuristics ----------

# Frontend (Astro, Next.js, React, Angular, generic SPA)
if echo "$STAGED_FILES" | grep -Eq '(^|/)(src/pages|pages|app)/'; then
  # Next.js pages/app router, Astro pages, generic pages
  SCOPE="pages"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(src/components|components)/'; then
  SCOPE="components"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(src/layouts|layouts)/'; then
  SCOPE="layout"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(src/hooks|hooks)/'; then
  SCOPE="hooks"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(src/context|context)/'; then
  SCOPE="state"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(src/styles|styles)/'; then
  SCOPE="style"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(public|static)/'; then
  SCOPE="assets"

# Angular-specific
elif echo "$STAGED_FILES" | grep -Eq '(^|/)src/app/'; then
  SCOPE="app"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)src/environments/'; then
  SCOPE="config"

# Backend (Express, Flask, generic API)
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(src/server|server|backend|api)/'; then
  SCOPE="api"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(routes|controllers)/'; then
  SCOPE="api"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(models|schemas)/'; then
  SCOPE="model"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)middleware/'; then
  SCOPE="middleware"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(config|settings)/'; then
  SCOPE="config"

# Flask-specific (common patterns)
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(app\.py|wsgi\.py)'; then
  SCOPE="app"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)blueprints?/'; then
  SCOPE="api"

# Java (Maven/Gradle, Spring, etc.)
elif echo "$STAGED_FILES" | grep -Eq '(^|/)src/main/java/'; then
  SCOPE="java"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)src/main/resources/'; then
  SCOPE="config"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)src/test/java/'; then
  SCOPE="test"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)src/integrationTest/java/'; then
  SCOPE="it"

# Cross-cutting / generic
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(tests?|__tests__|spec|specs)/'; then
  SCOPE="test"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(docs|documentation)/'; then
  SCOPE="docs"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(scripts|tools)/'; then
  SCOPE="scripts"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)\.github/'; then
  SCOPE="ci"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)(.husky|.github|.gitlab-ci\.yml|.circleci|ci)/'; then
  SCOPE="ci"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)package\.json|pnpm-lock\.yaml|yarn\.lock|pom\.xml|build\.gradle'; then
  SCOPE="deps"
fi

# ---------- Prompt building ----------
SCOPE_INSTRUCTION=""
if [ -n "$SCOPE" ]; then
  SCOPE_INSTRUCTION="Prefer using the scope \"$SCOPE\" unless it clearly does not fit."
fi

read -r -d '' PROMPT <<EOF || true
You are a commit message generator that strictly follows Conventional Commits.

Analyze this git diff and generate a conventional commit message.

Rules:
- Format: type(scope): subject
- Types: feat|fix|docs|style|refactor|perf|test|chore|ci|build
- The "scope" should reflect the area of the codebase touched by this change.
- Subject: imperative mood (e.g. 'add', 'fix', 'refactor'), no period at the end.
- Subject: max 72 characters.
- If needed, add a body:
  - Separate by a blank line after the subject line.
  - Wrap body lines at 72 characters.
- Do NOT include anything other than the final commit message.
$SCOPE_INSTRUCTION

Diff to analyze:
EOF

# ---------- Call LLM ----------
MSG=$(printf "%s\n\n%s\n" "$PROMPT" "$DIFF" | llm -m "$MODEL")

# ---------- Open in editor before committing ----------
TMPFILE=$(mktemp /tmp/ai-commit-msg.XXXXXX)
printf "%s\n" "$MSG" > "$TMPFILE"

# -e: open in $EDITOR; -F: use file as initial message
git commit -e -F "$TMPFILE"

rm -f "$TMPFILE"
```

Make it executable:

```bash
chmod +x ~/bin/ai-commit
```

### 4. Set Up Global Git Hook

#### 4.1 Configure Global Hooks Path

```bash
mkdir -p ~/.config/git/hooks
git config --global core.hooksPath ~/.config/git/hooks
```

#### 4.2 Create Global `prepare-commit-msg` Hook

Create `~/.config/git/hooks/prepare-commit-msg`:

```bash
#!/usr/bin/env bash
set -euo pipefail

COMMIT_MSG_FILE="$1"
COMMIT_SOURCE="${2:-}"

# If the commit message file already has content, assume some tool (like ai-commit)
# provided it and DO NOT override.
if [ -s "$COMMIT_MSG_FILE" ]; then
  exit 0
fi

# Only run for normal commits (no merge, squash, etc.)
if [ -z "$COMMIT_SOURCE" ]; then
  DIFF=$(git diff --cached --no-color)
  if [ -n "$DIFF" ]; then
    read -r -d '' PROMPT <<EOF2 || true
You are a commit message generator that strictly follows Conventional Commits.

Analyze this git diff and generate a conventional commit message.

Rules:
- Format: type(scope): subject
- Types: feat|fix|docs|style|refactor|perf|test|chore|ci|build
- Subject: imperative mood, no period at the end.
- Subject: max 72 characters.
- If needed, add a body:
  - Separate by a blank line after the subject line.
  - Wrap body lines at 72 characters.
- Do NOT include anything other than the final commit message.

Diff to analyze:
EOF2

    AI_MSG=$(printf "%s\n\n%s\n" "$PROMPT" "$DIFF" | llm -m my-remote)

    # Write the AI suggestion into the commit message file
    printf "%s\n" "$AI_MSG" > "$COMMIT_MSG_FILE"
  fi
fi
```

Make it executable:

```bash
chmod +x ~/.config/git/hooks/prepare-commit-msg
```

### 5. Configure Lazygit

Edit `~/.config/lazygit/config.yml`:

```yaml
customCommands:
  - key: "<c-a>"
    description: "AI commit (remote, scoped)"
    context: "files"
    command: "ai-commit my-remote"
    loadingText: "Generating AI commit message (remote)..."

  - key: "<c-l>"
    description: "AI commit (LM Studio, scoped)"
    context: "files"
    command: "ai-commit lmstudio:local"
    loadingText: "Generating AI commit message (LM Studio)..."

  - key: "<c-o>"
    description: "AI commit (Ollama, scoped)"
    context: "files"
    command: "ai-commit ollama:llama3.2"
    loadingText: "Generating AI commit message (Ollama)..."

  - key: "<c-m>"
    description: "AI commit (Msty, scoped)"
    context: "files"
    command: "ai-commit msty:chat"
    loadingText: "Generating AI commit message (Msty)..."
```

---

## Usage Workflows

### Fast Default Flow (Global Hook)

1. Stage files in lazygit (space key)
2. Press `c` to commit
3. Your editor opens with AI-generated conventional commit message
4. Edit if needed, save and close

### Explicit Model Selection Flow

1. Stage files in lazygit
2. Press:
   - `Ctrl+a` → remote model with scope inference
   - `Ctrl+l` → LM Studio local model
   - `Ctrl+o` → Ollama model
   - `Ctrl+m` → Msty model
3. Your editor opens with AI-generated scoped commit message
4. Edit if needed, save and close

### Manual Command Line

```bash
# Stage files
git add .

# Use ai-commit with specific model
ai-commit my-remote
ai-commit ollama:llama3.2
ai-commit lmstudio:local
```

---

## Scope Detection

The script automatically detects scopes based on file paths:

### Frontend (Astro, Next.js, React, Angular)

- `pages/`, `src/pages/`, `app/` → `pages`
- `components/`, `src/components/` → `components`
- `layouts/`, `src/layouts/` → `layout`
- `hooks/`, `src/hooks/` → `hooks`
- `context/`, `src/context/` → `state`
- `styles/`, `src/styles/` → `style`
- `public/`, `static/` → `assets`
- `src/app/` (Angular) → `app`
- `src/environments/` → `config`

### Backend (Express, Flask)

- `api/`, `server/`, `backend/` → `api`
- `routes/`, `controllers/` → `api`
- `models/`, `schemas/` → `model`
- `middleware/` → `middleware`
- `config/`, `settings/` → `config`
- `app.py`, `wsgi.py` → `app`
- `blueprints/` → `api`

### Java

- `src/main/java/` → `java`
- `src/main/resources/` → `config`
- `src/test/java/` → `test`
- `src/integrationTest/java/` → `it`

### Cross-cutting

- `tests/`, `__tests__/`, `spec/` → `test`
- `docs/`, `documentation/` → `docs`
- `scripts/`, `tools/` → `scripts`
- `.github/`, `ci/` → `ci`
- `package.json`, `pom.xml`, lock files → `deps`

---

## How It Works

### `git diff --cached`

- Shows **only staged changes** (what will be committed)
- Ignores unstaged changes in working directory
- Keeps commit messages focused and accurate

### Hook Interaction

- **`ai-commit` script**: Writes message to temp file → `git commit -e -F tmpfile` → hook sees non-empty file → exits early
- **Plain `git commit`**: Git creates empty message file → hook generates AI message → editor opens with suggestion
- **`git commit -m "..."`**: Message file is non-empty → hook exits early

### Global vs Per-Repo Hooks

- **Default**: Hooks are per-repo in `.git/hooks/`
- **Global**: Set `core.hooksPath` to `~/.config/git/hooks` to share hooks across all repos
- Global hooks apply to all repositories automatically

---

## Customization

### Add Custom Scopes

Edit the scope detection section in `~/bin/ai-commit`:

```bash
# Monorepo example
elif echo "$STAGED_FILES" | grep -Eq '(^|/)apps/mobile/'; then
  SCOPE="mobile"
elif echo "$STAGED_FILES" | grep -Eq '(^|/)packages/ui/'; then
  SCOPE="ui-lib"
```

### Change Default Model

Edit the `MODEL` default in `ai-commit` or the hook:

```bash
MODEL="${1:-ollama:llama3.2}"  # Use local by default
```

### Adjust Prompt

Modify the `PROMPT` variable to change AI behavior, e.g.:

- Add project-specific conventions
- Enforce stricter formatting
- Include emoji in commit types

---

## Benefits

✅ **Consistent conventional commits** across all projects  
✅ **Automatic scope detection** based on file paths  
✅ **Multiple AI backends** (remote and local)  
✅ **Always editable** before committing  
✅ **Works with existing workflows** (lazygit, CLI, IDEs)  
✅ **Global setup** applies to all repositories  
✅ **Flexible**: Choose explicit model or use default hook

---

This setup gives you the best of both worlds: quick AI-assisted commits for routine work, and explicit model selection with scope inference when you need more control.
