/**
 * routes.config.ts
 * Route definitions for the auto-router extension.
 * Edit this file to add, remove, or tune routes without touching logic.
 *
 * Keyword weights:
 *   3 = strong domain-specific signal (e.g. "race condition", "sql injection")
 *   2 = medium signal, likely but not exclusive to this route
 *   1 = weak signal, tiebreaker only — use sparingly
 *
 * Fix #2: keywords are now [term, weight] pairs — generic words like "fix",
 * "add", "write" should never appear as weight-1 entries in multiple routes,
 * or they will cause unpredictable ties resolved by insertion order.
 */

import type { RouteConfig } from "./routes.schema";

export const ROUTES: Record<string, RouteConfig> = {

  // ── 🔴 TIER PREMIUM ────────────────────────────────────────────────────────

  surgical: {
    candidates: [
      ["google-antigravity", "claude-opus-4-6-thinking"],
      ["github-copilot",     "claude-opus-4.6"],
      ["anthropic",          "claude-opus-4-6"],
      ["openrouter",         "anthropic/claude-opus-4.6"],
      // fallback
      ["opencode-go",        "glm-5.1"],
      ["opencode-go",        "glm-5"],
      ["openrouter",         "minimax/minimax-m2.5"],
    ],
    thinking: "high",
    label: "🔴 Opus 4.6 — surgical",
    minPromptLength: 40,
    keywords: [
      ["refactor",             2], ["architect",            3],
      ["redesign",             2], ["legacy",               2],
      ["ristruttur",           2], ["race condition",       3],
      ["deadlock",             3], ["memory leak",          3],
      ["security audit",       3], ["vulnerability",        3],
      ["cross-module",         3], ["breaking change",      3],
      ["database migration",   3], ["schema migration",     3],
      ["analiz.*codice.*compless", 3],
    ],
  },

  general: {
    candidates: [
      ["openai-codex",  "gpt-5.4"],
      ["github-copilot","gpt-5.4"],
      ["openrouter",    "openai/gpt-5.4"],
      // fallback
      ["opencode-go",   "mimo-v2-pro"],
      ["opencode-go",   "glm-5.1"],
      ["openrouter",    "minimax/minimax-m2.7"],
    ],
    thinking: "medium",
    label: "🔴 GPT-5.4 — general",
    minPromptLength: 30,
    keywords: [
      ["computer use",    3], ["browser automation", 3],
      ["playwright",      3], ["selenium",           3],
      ["orchestrat",      3], ["multi-step",         2],
      ["workflow",        2], ["agent",               2],
      ["ragiona",         2], ["analiz.*profond",    3],
      ["spiega.*perché",  2], ["pipeline.*compless", 3],
    ],
  },

  // ── 🟡 TIER MID ────────────────────────────────────────────────────────────

  daily: {
    candidates: [
      ["google-antigravity", "claude-sonnet-4-6"],
      ["github-copilot",     "claude-sonnet-4.6"],
      ["anthropic",          "claude-sonnet-4-6"],
      ["openrouter",         "anthropic/claude-sonnet-4.6"],
      // fallback
      ["openrouter",         "minimax/minimax-m2.5"],
      ["openrouter",         "minimax/minimax-m2.7"],
      ["opencode-go",        "kimi-k2.5"],
    ],
    thinking: "medium",
    label: "🟡 Sonnet 4.6 — daily",
    minPromptLength: 10,
    keywords: [
      ["implement", 2], ["refactor", 1], ["explain", 2],
      ["add feature", 2], ["update", 1], ["create function", 2],
      ["write class", 2], ["fix bug", 2], ["debug", 2],
    ],
  },

  polyglot: {
    candidates: [
      ["google-antigravity", "gemini-3.1-pro-high"],
      ["openrouter",         "google/gemini-3.1-pro-preview"],
      ["github-copilot",     "gemini-3.1-pro-preview"],
      // fallback
      ["openrouter",         "minimax/minimax-m2.5"],
      ["opencode-go",        "kimi-k2.5"],
    ],
    thinking: "medium",
    label: "🟡 Gemini 3.1 Pro — polyglot",
    minPromptLength: 20,
    keywords: [
      ["python.*typescript", 3], ["rust.*go",        3],
      ["java.*kotlin",       3], ["swift.*objc",     3],
      ["multi-lang",         3], ["polyglot",        3],
      ["transpile",          3], ["port.*from",      2],
      ["convert.*language",  3], ["tool coordination",3],
      ["mcp",                2],
    ],
  },

  // ── 🟢 TIER VELOCITÀ ───────────────────────────────────────────────────────

  terminal: {
    candidates: [
      ["openai-codex",  "gpt-5.3-codex"],
      ["github-copilot","gpt-5.3-codex"],
      ["openrouter",    "openai/gpt-5.3-codex"],
      // fallback
      ["openrouter",    "minimax/minimax-m2.7"],
      ["openrouter",    "minimax/minimax-m2.5"],
    ],
    thinking: "off",
    label: "🟢 GPT-5.3-Codex — terminal",
    minPromptLength: 10,
    keywords: [
      ["bash",         3], ["chmod",       3], ["chown",      3],
      ["grep",         2], ["sed ",        2], ["awk ",       2],
      ["curl ",        2], ["wget ",       2], ["docker",     2],
      ["kubernetes",   3], ["k8s",         3], ["helm",       3],
      ["ci/cd",        3], ["github action",3], ["systemctl", 3],
      ["systemd",      3], ["cron",        2], ["makefile",   3],
      ["git rebase",   3], ["git bisect",  3], ["pipeline.*docker",3],
      ["pipeline.*ci", 3],
    ],
  },

  speed: {
    candidates: [
      ["openrouter", "x-ai/grok-4.1-fast"],
      // fallback
      ["openrouter", "minimax/minimax-m2.5-lightning"],
      ["opencode-go","kimi-k2.5"],
    ],
    thinking: "off",
    label: "🟢 Grok 4.1 — speed",
    minPromptLength: 10,
    keywords: [
      ["boilerplate",    3], ["scaffold",   3],
      ["starter kit",    3], ["stub",       2],
      ["placeholder",    2], ["veloce",     2],
      ["rapido",         2], ["quick fix",  2],
    ],
  },

  // ── 🔵 TIER ALTERNATIVO ────────────────────────────────────────────────────

  budget: {
    candidates: [
      ["openrouter", "deepseek/deepseek-v3.2"],
      // fallback
      ["openrouter", "minimax/minimax-m2.5"],
      ["opencode-go","glm-5.1"],
      ["opencode-go","glm-5"],
    ],
    thinking: "medium",
    label: "🔵 DeepSeek V3.2 — budget",
    minPromptLength: 10,
    keywords: [
      ["docstring",       3], ["jsdoc",       3], ["readme",       2],
      ["documentation",   2], ["unit test",   3], ["test case",    3],
      ["jest",            3], ["vitest",      3], ["pytest",       3],
      ["coverage",        2], ["lint",        2], ["prettier",     3],
      ["eslint",          3], ["i18n",        3], ["localiz",      3],
      ["traduc",          3], ["visual regression", 3],
    ],
  },

  uiux: {
    candidates: [
      ["openai-codex",  "gpt-5.4"],
      ["github-copilot","gpt-5.4"],
      ["openrouter",    "qwen/qwen3.6-plus:free"],
      ["openrouter",    "openai/gpt-5.4"],
      ["anthropic",     "claude-sonnet-4-6"],
      // fallback
      ["opencode-go",   "kimi-k2.5"],
      ["openrouter",    "minimax/minimax-m2.5"],
    ],
    thinking: "medium",
    label: "🎨 GPT-5.4 + Qwen — UI/UX",
    minPromptLength: 15,
    keywords: [
      ["figma",             3], ["mockup",          3], ["wireframe",    3],
      ["user interface",    3], ["design system",   3], ["landing page", 3],
      ["tailwind",          2], ["styled-components",3], ["sass",        2],
      ["css animation",     3], ["dark mode",       2], ["theme ui",     3],
      ["ui component",      3], ["ux flow",         3], ["ux pattern",   3],
      ["color palette",     2], ["typography",      2],
    ],
  },

  // ── 🔵 TIER MANUALE ────────────────────────────────────────────────────────
  // Le seguenti route non sono mai selezionate automaticamente.
  // Usare `/route pin <key>` per attivarle.

  explore: {
    candidates: [
      ["opencode-go",  "kimi-k2.5"],
      ["openrouter",   "moonshotai/kimi-k2.5"],
      // fallback
      ["opencode-go",  "glm-5.1"],
      ["opencode-go",  "mimo-v2-omni"],
    ],
    thinking: "medium",
    label: "🔵 Kimi K2.5 — explore",
    manualOnly: true,
  },

  glm: {
    candidates: [
      ["opencode-go",  "glm-5.1"],
      ["opencode-go",  "glm-5"],
      // fallback
      ["openrouter",   "minimax/minimax-m2.7"],
    ],
    thinking: "medium",
    label: "🔵 GLM-5.1 — long-horizon",
    manualOnly: true,
  },

};

/** Union of valid route keys, derived automatically from ROUTES. */
export type RouteKey =
  | "surgical" | "general" | "daily" | "polyglot"
  | "terminal" | "speed"   | "budget" | "uiux"
  | "explore"  | "glm";

/** Ordered list of auto-selectable routes (manualOnly excluded). */
export const AUTO_ROUTES: RouteKey[] = (Object.keys(ROUTES) as RouteKey[]).filter(
  (k) => !ROUTES[k].manualOnly
);
