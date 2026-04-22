# Auto-router benchmark checklist

Use this checklist to validate route selection, latency, and answer quality after changes to `agent/extensions/auto-router/routes.config.ts`.

## How to use

For each prompt:

- [ ] Run it through the auto-router
- [ ] Record the selected route
- [ ] Record the selected model/provider
- [ ] Judge latency
- [ ] Judge output quality
- [ ] Decide whether the route/model feels right  


---

## 1) Speed

Expected primary:

- `openai-codex/gpt-5.4-mini`  


### Prompt A

> scaffold a minimal typescript cli with commander, zod, and vitest. include package.json, tsconfig, src/index.ts, and one test.

- [ ] Route selected is `speed`
- [ ] Model selected matches expectation
- [ ] Response is fast
- [ ] Output is usable without much cleanup  


### Prompt B

> create a quick react settings page component with 3 toggles, one select, and local state only. keep it simple.

- [ ] Route selected is `speed`
- [ ] Model selected matches expectation
- [ ] Response is fast
- [ ] Output is appropriately lightweight  


### Prompt C

> generate a starter express route for file upload with multer and basic validation. no explanation.

- [ ] Route selected is `speed`
- [ ] Model selected matches expectation
- [ ] Response is fast
- [ ] Output is concise and correct  


---

## 2) Daily

Expected primary:

- `openai-codex/gpt-5.1-codex-mini`  


### Prompt A

> implement a debounce utility in typescript with cancel and flush methods, and explain the edge cases briefly.

- [ ] Route selected is `daily`
- [ ] Model selected matches expectation
- [ ] Code quality is solid
- [ ] Explanation is brief but useful  


### Prompt B

> fix this bug: my pagination resets to page 1 whenever filters change, but it should only reset when the search query changes.

- [ ] Route selected is `daily`
- [ ] Model selected matches expectation
- [ ] Bug reasoning looks sound
- [ ] Fix is practical  


### Prompt C

> add a feature flag wrapper around this function so it uses the new implementation only when `useNewRanking` is enabled.

- [ ] Route selected is `daily`
- [ ] Model selected matches expectation
- [ ] Output fits normal feature work
- [ ] No overengineering  


---

## 3) Terminal

Expected primary:

- `openai-codex/gpt-5.1-codex-mini`  


### Prompt A

> write a bash command to find all .ts files excluding node_modules and run eslint on them in batches.

- [ ] Route selected is `terminal`
- [ ] Model selected matches expectation
- [ ] Command is correct
- [ ] Output is concise  


### Prompt B

> give me a one-liner to list docker containers older than 24h and delete the stopped ones.

- [ ] Route selected is `terminal`
- [ ] Model selected matches expectation
- [ ] Command is plausible/safe
- [ ] Output is not overly verbose  


### Prompt C

> write a git command sequence to rebase my feature branch onto main and resolve by preferring incoming changes for package-lock.json only.

- [ ] Route selected is `terminal`
- [ ] Model selected matches expectation
- [ ] Sequence is operationally correct
- [ ] Output is practical  


---

## 4) Surgical

Expected primary:

- `opencode-go/glm-5.1`  


### Prompt A

> refactor this legacy authentication flow into separate modules for token issuance, session validation, and permission checks without changing public behavior. identify migration risks.

- [ ] Route selected is `surgical`
- [ ] Model selected matches expectation
- [ ] Refactor plan is deep and structured
- [ ] Risks are identified clearly  


### Prompt B

> redesign this data import pipeline to avoid race conditions between job retries and partial writes. include rollback strategy.

- [ ] Route selected is `surgical`
- [ ] Model selected matches expectation
- [ ] Reasoning is deep
- [ ] Rollback strategy is credible  


---

## 5) General

Expected primary:

- `opencode-go/mimo-v2-pro`  


### Prompt A

> analyze this multi-step workflow for browser automation, API polling, and file processing, and propose a robust orchestration plan with retry boundaries.

- [ ] Route selected is `general`
- [ ] Model selected matches expectation
- [ ] Planning quality is strong
- [ ] Multi-step orchestration is handled well  


### Prompt B

> I need an agent plan to inspect a large monorepo, identify stale packages, trace cross-package dependencies, and propose a safe cleanup strategy.

- [ ] Route selected is `general`
- [ ] Model selected matches expectation
- [ ] Large-codebase planning feels strong
- [ ] Cleanup strategy is realistic  


---

## 6) Polyglot

Expected primary:

- `opencode-go/glm-5.1`  


### Prompt A

> port this python data transformation pipeline to typescript while preserving edge-case behavior and testability.

- [ ] Route selected is `polyglot`
- [ ] Model selected matches expectation
- [ ] Porting quality is strong
- [ ] Edge cases are preserved  


### Prompt B

> compare this rust implementation and its go equivalent, explain behavioral differences, and propose a shared contract test suite.

- [ ] Route selected is `polyglot`
- [ ] Model selected matches expectation
- [ ] Comparison is accurate
- [ ] Contract-test idea is useful  


---

## 7) UI/UX

Expected primary:

- `opencode-go/kimi-k2.5`  


### Prompt A

> design a settings dashboard UI for a developer tool with dark mode, keyboard shortcut editor, and compact/comfortable density modes.

- [ ] Route selected is `uiux`
- [ ] Model selected matches expectation
- [ ] UI ideas are coherent
- [ ] Design output feels intentional  


### Prompt B

> propose a design system for a landing page with a code editor hero, feature cards, and a pricing section. focus on typography and color palette.

- [ ] Route selected is `uiux`
- [ ] Model selected matches expectation
- [ ] Typography/color suggestions are useful
- [ ] Design system feels consistent  


---

## 8) Budget

Expected primary:

- `opencode-go/minimax-m2.7`  


### Prompt A

> write jsdoc comments for these three utility functions and add simple vitest cases for edge conditions.

- [ ] Route selected is `budget`
- [ ] Model selected matches expectation
- [ ] Output is cheap-task appropriate
- [ ] Quality is sufficient  


### Prompt B

> generate eslint and prettier fixes for this file and explain only the non-obvious ones.

- [ ] Route selected is `budget`
- [ ] Model selected matches expectation
- [ ] Output is efficient
- [ ] Explanation is minimal and useful  


---

# Tuning notes

## If `speed` feels too expensive or too thoughtful

- [ ] Consider moving `gpt-5.1-codex-mini` above `gpt-5.4-mini`  


## If `daily` quality feels too weak

- [ ] Consider moving `gpt-5.4-mini` above `gpt-5.1-codex-mini`  


## If `terminal` is too verbose or slow

- [ ] Consider moving `gpt-5.3-codex-spark` above `gpt-5.4-mini`  


## If `general` needs stronger reasoning than context

- [ ] Consider moving `gpt-5.4` above `mimo-v2-pro`  


## If `surgical` should feel more Codex-like

- [ ] Consider moving `gpt-5.1-codex-max` above `glm-5.1`  


---

# Notes

- [ ] OpenRouter should remain fallback-only
- [ ] `explore` should never reference invalid `kimi-k2.7`
- [ ] Re-test after any candidate reordering
