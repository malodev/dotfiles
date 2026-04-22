/**
 * routes.config.ts
 * Route definitions for the auto-router extension.
 * Edit this file to add, remove, or tune routes without touching logic.
 *
 * Primary models (all on opencode-go):
 *
 *   model            context   max-out  thinking  images
 *   glm-5.1          204.8K   131.1K   yes       no
 *   kimi-k2.5        262.1K    65.5K   yes       yes
 *   mimo-v2-omni     262.1K    64K     yes       yes
 *   mimo-v2-pro        1.0M    64K     yes       no
 *   minimax-m2.7     204.8K   131.1K   yes       no
 *
 * OpenRouter fallback slugs (from provided model list, verified April 2026):
 *
 *   Key selection criteria per route:
 *   surgical   → max reasoning depth + large output window
 *   general    → max context + agentic tool-use
 *   daily      → best coding value + cost
 *   polyglot   → multilingual strength + large context
 *   terminal   → fast + excellent tool-use, thinking:off preferred
 *   speed      → throughput, low latency, low cost
 *   budget     → free or near-free, sufficient for doc/test/lint
 *   uiux       → images:yes required
 *   explore    → images:yes + large context
 *   glm        → max output window for large artifact generation
 *
 * Keyword weights:
 *   3 = strong domain-specific signal (e.g. "race condition", "deadlock")
 *   2 = medium signal, likely but not exclusive to this route
 *   1 = weak tiebreaker — use sparingly, never in multiple routes
 */

import type { RouteConfig } from "./routes.schema";

export const ROUTES: Record<string, RouteConfig> = {

  // ── 🔴 TIER PREMIUM ────────────────────────────────────────────────────────

  surgical: {
    // Primary: glm-5.1 — SWE-Bench Pro 58.4, beats GPT-5.4 (57.7) and Opus 4.6 (57.3);
    //   1.700 tool calls autonomi, "staircase" optimization, 131K output window
    // OR: z-ai/glm-5.1 — same model via OpenRouter (max-out 4.1K on OR, use for
    //   shorter surgical tasks; primary opencode-go instance for long output)
    // OR: Opus 4.6 (1M ctx, 128K out, thinking, images) — KernelBench leader at 4.2x
    // OR: GPT-5.4 (1.1M ctx, 128K out, thinking) — strong reasoning + huge context
    // OR: DeepSeek R1-0528 (164K, 65K out, thinking) — cost-efficient deep reasoning
    // OR: grok-4.1-fast (2M ctx, thinking) — if context window is the bottleneck
    candidates: [
      ["opencode-go", "glm-5.1"],
      ["opencode-go", "mimo-v2-pro"],
      ["openrouter",  "z-ai/glm-5.1"],
      ["openrouter",  "anthropic/claude-opus-4.6"],
      ["openrouter",  "openai/gpt-5.4"],
      ["openrouter",  "deepseek/deepseek-r1-0528"],
      ["openrouter",  "x-ai/grok-4.1-fast"],
    ],
    thinking: "high",
    label: "🔴 GLM-5.1 — surgical",
    minPromptLength: 40,
    keywords: [
      ["refactor",           2], ["architect",         3],
      ["redesign",           2], ["legacy",            2],
      ["ristruttur",         2], ["race condition",    3],
      ["deadlock",           3], ["memory leak",       3],
      ["security audit",     3], ["vulnerability",     3],
      ["cross-module",       3], ["breaking change",   3],
      ["database migration", 3], ["schema migration",  3],
      ["analiz.*codice.*compless", 3],
    ],
  },

  general: {
    // Primary: mimo-v2-pro — 1M context, essential for large multi-file agent sessions
    // OR: grok-4.1-fast (2M ctx! thinking, images) — largest context window available
    // OR: z-ai/glm-5.1 — Terminal-Bench 2.0 63.5, MCP-Atlas 71.8, T3-Bench 70.6;
    //   strong agentic despite 4.1K max-out on OR (tool calls don't need long output)
    // OR: Gemini 3.1 Pro (1M ctx, thinking, images) — strong agentic + multimodal
    // OR: GPT-5.4 (1.1M ctx, thinking, images) — best computer use support
    // OR: Qwen3.6 Plus (1M ctx, thinking, images) — free, strong agentic
    candidates: [
      ["opencode-go", "mimo-v2-pro"],
      ["opencode-go", "glm-5.1"],
      ["openrouter",  "x-ai/grok-4.1-fast"],
      ["openrouter",  "z-ai/glm-5.1"],
      ["openrouter",  "google/gemini-3.1-pro-preview"],
      ["openrouter",  "openai/gpt-5.4"],
      ["openrouter",  "qwen/qwen3.6-plus"],
    ],
    thinking: "medium",
    label: "🔴 MiMo-V2-Pro — general",
    minPromptLength: 30,
    keywords: [
      ["computer use",       3], ["browser automation", 3],
      ["playwright",         3], ["selenium",           3],
      ["orchestrat",         3], ["multi-step",         2],
      ["workflow",           2], ["agent",              2],
      ["ragiona",            2], ["analiz.*profond",    3],
      ["spiega.*perché",     2], ["pipeline.*compless", 3],
    ],
  },

  // ── 🟡 TIER MID ────────────────────────────────────────────────────────────

  daily: {
    // Primary: minimax-m2.7 — best speed/quality balance for standard coding
    // OR: Sonnet 4.6 (1M ctx, 128K out, thinking, images) — best coding value
    // OR: DeepSeek V3.2 (164K, thinking) — ~90% GPT-5.4 quality at 1/50 cost
    // OR: MiniMax M2.7 on OR (same model, OR routing as fallback)
    // OR: MiniMax M2.5 (196K, 65K, thinking) — cheapest frontier-level coding
    candidates: [
      ["opencode-go", "minimax-m2.7"],
      ["opencode-go", "kimi-k2.5"],
      ["openrouter",  "anthropic/claude-sonnet-4.6"],
      ["openrouter",  "deepseek/deepseek-v3.2"],
      ["openrouter",  "minimax/minimax-m2.7"],
      ["openrouter",  "minimax/minimax-m2.5"],
    ],
    thinking: "medium",
    label: "🟡 MiniMax M2.7 — daily",
    minPromptLength: 10,
    keywords: [
      ["implement",      2], ["explain",         2],
      ["add feature",    2], ["create function",  2],
      ["write class",    2], ["fix bug",          2],
      ["debug",          2], ["integrate",        2],
    ],
  },

  polyglot: {
    // Primary: glm-5.1 — strongest multilingual training
    // OR: Gemini 3.1 Pro (1M ctx, thinking, images) — top multilingual benchmark scores
    // OR: Qwen3.5-397B (262K, 65K, thinking, images) — best open multilingual model
    // OR: DeepSeek V3.2 — strong cross-language reasoning at low cost
    candidates: [
      ["opencode-go", "glm-5.1"],
      ["opencode-go", "mimo-v2-pro"],
      ["openrouter",  "google/gemini-3.1-pro-preview"],
      ["openrouter",  "qwen/qwen3.5-397b-a17b"],
      ["openrouter",  "deepseek/deepseek-v3.2"],
    ],
    thinking: "medium",
    label: "🟡 GLM-5.1 — polyglot",
    minPromptLength: 20,
    keywords: [
      ["python.*typescript", 3], ["rust.*go",          3],
      ["java.*kotlin",       3], ["swift.*objc",       3],
      ["multi-lang",         3], ["polyglot",          3],
      ["transpile",          3], ["port.*from",        2],
      ["convert.*language",  3], ["tool coordination", 3],
      ["mcp",                2],
    ],
  },

  // ── 🟢 TIER VELOCITÀ ───────────────────────────────────────────────────────

  terminal: {
    // Primary: minimax-m2.7 thinking:off — fast, no reasoning overhead for shell/CI
    // OR: DeepSeek V3.2 (164K, thinking, excellent tool-use at $0.26/M input)
    // OR: Qwen3-Coder-Plus (1M ctx, 65K out) — large context for big scripts
    // OR: MiniMax M2.5 (196K, 65K, thinking) — cheap frontier fallback
    // OR: Step 3.5 Flash (262K, 65K, thinking) — fast MoE, 11B active params
    candidates: [
      ["opencode-go", "minimax-m2.7"],
      ["opencode-go", "glm-5.1"],
      ["openrouter",  "deepseek/deepseek-v3.2"],
      ["openrouter",  "qwen/qwen3-coder-plus"],
      ["openrouter",  "minimax/minimax-m2.5"],
      ["openrouter",  "stepfun/step-3.5-flash"],
    ],
    thinking: "off",
    label: "🟢 MiniMax M2.7 — terminal",
    minPromptLength: 10,
    keywords: [
      ["bash",          3], ["chmod",         3], ["chown",        3],
      ["grep",          2], ["sed ",          2], ["awk ",         2],
      ["curl ",         2], ["wget ",         2], ["docker",       2],
      ["kubernetes",    3], ["k8s",           3], ["helm",         3],
      ["ci/cd",         3], ["github action", 3], ["systemctl",   3],
      ["systemd",       3], ["cron",          2], ["makefile",     3],
      ["git rebase",    3], ["git bisect",    3], ["pipeline.*docker", 3],
      ["pipeline.*ci",  3],
    ],
  },

  speed: {
    // Primary: minimax-m2.7 thinking:off — maximize throughput for boilerplate
    // OR: MiniMax M2.5 (196K, 65K) — cheapest frontier, 80.2% SWE-bench
    // OR: Step 3.5 Flash (262K, 65K, thinking) — fast MoE for quick generation
    // OR: Qwen3-Coder-Flash (1M ctx, 65K) — large context if scaffold is huge
    // OR: DeepSeek V3.2 — reliable fast fallback at minimal cost
    candidates: [
      ["opencode-go", "minimax-m2.7"],
      ["opencode-go", "kimi-k2.5"],
      ["openrouter",  "minimax/minimax-m2.5"],
      ["openrouter",  "stepfun/step-3.5-flash"],
      ["openrouter",  "qwen/qwen3-coder-flash"],
      ["openrouter",  "deepseek/deepseek-v3.2"],
    ],
    thinking: "off",
    label: "🟢 MiniMax M2.7 — speed",
    minPromptLength: 10,
    keywords: [
      ["boilerplate",  3], ["scaffold",    3],
      ["starter kit",  3], ["stub",        2],
      ["placeholder",  2], ["veloce",      2],
      ["rapido",       2], ["quick fix",   2],
    ],
  },

  // ── 🔵 TIER ALTERNATIVO ────────────────────────────────────────────────────

  budget: {
    // Primary: minimax-m2.7 thinking:off — high-volume doc/test/lint at low cost
    // OR: MiniMax M2.5 free (196K, 196K out — enormous free output window)
    // OR: GLM-4.5 Air free (131K, 96K, thinking) — free with reasoning
    // OR: Qwen3-Coder free (262K, 262K out — largest free output window)
    // OR: Step 3.5 Flash free (256K, 256K out) — large free output
    candidates: [
      ["opencode-go", "minimax-m2.7"],
      ["opencode-go", "glm-5.1"],
      ["openrouter",  "minimax/minimax-m2.5:free"],
      ["openrouter",  "z-ai/glm-4.5-air:free"],
      ["openrouter",  "qwen/qwen3-coder:free"],
      ["openrouter",  "stepfun/step-3.5-flash:free"],
    ],
    thinking: "off",
    label: "🔵 MiniMax M2.7 — budget",
    minPromptLength: 10,
    keywords: [
      ["docstring",        3], ["jsdoc",        3], ["readme",         2],
      ["documentation",    2], ["unit test",    3], ["test case",      3],
      ["jest",             3], ["vitest",       3], ["pytest",         3],
      ["coverage",         2], ["lint",         2], ["prettier",       3],
      ["eslint",           3], ["i18n",         3], ["localiz",        3],
      ["traduc",           3], ["visual regression", 3],
    ],
  },

  uiux: {
    // Primary: kimi-k2.5 + mimo-v2-omni — only opencode-go models with images
    // OR: moonshotai/kimi-k2.5 (262K, thinking, images) — same model via OR
    // OR: Sonnet 4.6 (1M ctx, 128K out, thinking, images) — best UI reasoning
    // OR: Gemini 3.1 Pro (1M ctx, thinking, images) — strong multimodal + design
    // OR: Qwen3-VL-235B thinking (131K, 32K, thinking, images) — large VL model
    candidates: [
      ["opencode-go", "kimi-k2.5"],
      ["opencode-go", "mimo-v2-omni"],
      ["openrouter",  "moonshotai/kimi-k2.5"],
      ["openrouter",  "anthropic/claude-sonnet-4.6"],
      ["openrouter",  "google/gemini-3.1-pro-preview"],
      ["openrouter",  "qwen/qwen3-vl-235b-a22b-thinking"],
    ],
    thinking: "medium",
    label: "🎨 Kimi K2.5 — UI/UX",
    minPromptLength: 15,
    keywords: [
      ["figma",              3], ["mockup",           3], ["wireframe",      3],
      ["user interface",     3], ["design system",    3], ["landing page",   3],
      ["tailwind",           2], ["styled-components", 3], ["sass",          2],
      ["css animation",      3], ["dark mode",        2], ["theme ui",       3],
      ["ui component",       3], ["ux flow",          3], ["ux pattern",     3],
      ["color palette",      2], ["typography",       2],
    ],
  },

  // ── 🔵 TIER MANUALE ────────────────────────────────────────────────────────
  // Non selezionate automaticamente. Attivare con `/route pin <key>`.

  explore: {
    // kimi-k2.5: 262K + images — best for exploring unknown codebases visually
    // OR: mimo-v2-omni (OR variant, images + thinking)
    // OR: Gemini 3.1 Pro (1M ctx, images) — largest multimodal context
    // OR: Qwen3.5-397B (262K, thinking, images) — strong visual reasoning
    candidates: [
      ["opencode-go", "kimi-k2.5"],
      ["opencode-go", "mimo-v2-omni"],
      ["openrouter",  "moonshotai/kimi-k2.5"],
      ["openrouter",  "google/gemini-3.1-pro-preview"],
      ["openrouter",  "qwen/qwen3.5-397b-a17b"],
    ],
    thinking: "medium",
    label: "🔵 Kimi K2.5 — explore",
    manualOnly: true,
  },

  glm: {
    // Primary: glm-5.1 on opencode-go — 131K output, 1.700 tool calls, 8h autonomous;
    //   purpose-built for long-horizon engineering tasks (staircase optimization)
    // OR: z-ai/glm-5.1 — same model via OR; max-out 4.1K on OR limits output length
    //   but fine for iterative tool-call-heavy agentic loops (planning, not generation)
    // OR: z-ai/glm-4.6 — 205K ctx, 205K out! largest output window in GLM family on OR;
    //   use when the task requires generating very large single artifacts
    // OR: z-ai/glm-5-turbo — 203K ctx, 131K out, thinking; faster GLM-5 variant
    // OR: MiniMax M2.7 on OR (204K ctx, 131K out) — comparable output window, agentic
    // OR: Opus 4.6 (1M ctx, 128K out) — KernelBench 4.2x leader; quality ceiling
    candidates: [
      ["opencode-go", "glm-5.1"],
      ["opencode-go", "mimo-v2-pro"],
      ["openrouter",  "z-ai/glm-5.1"],
      ["openrouter",  "z-ai/glm-4.6"],
      ["openrouter",  "z-ai/glm-5-turbo"],
      ["openrouter",  "minimax/minimax-m2.7"],
      ["openrouter",  "anthropic/claude-opus-4.6"],
    ],
    thinking: "medium",
    label: "🔵 GLM-5.1 — long-horizon",
    manualOnly: true,
  },

};

/** Union of valid route keys, derived automatically from ROUTES. */
export type RouteKey =
  | "surgical" | "general" | "daily"   | "polyglot"
  | "terminal" | "speed"   | "budget"  | "uiux"
  | "explore"  | "glm";

/** Ordered list of auto-selectable routes (manualOnly excluded). */
export const AUTO_ROUTES: RouteKey[] = (Object.keys(ROUTES) as RouteKey[]).filter(
  (k) => !ROUTES[k].manualOnly
);
