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
    // Primary: glm-5.1 — best fit for long-horizon engineering, deep iterative work,
    //   large-output coding and "staircase" optimization loops
    // Primary fallback: mimo-v2-pro — 1M context when repo/session breadth matters more
    // Primary fallback: minimax-m2.7 — still 131K output, cheaper, good safety net
    // OR: Opus 4.6 / GPT-5.4 / o3-pro — premium deep-reasoning fallbacks
    // OR: z-ai/glm-4.6 — huge 204.8K output window when artifact size dominates
    // Note: z-ai/glm-5.1 on OR intentionally excluded here because max-out is only 4.1K
    candidates: [
      ["opencode-go", "glm-5.1"],
      ["opencode-go", "mimo-v2-pro"],
      ["opencode-go", "minimax-m2.7"],
      ["openrouter", "anthropic/claude-opus-4.6"],
      ["openrouter", "openai/gpt-5.4"],
      ["openrouter", "openai/o3-pro"],
      ["openrouter", "z-ai/glm-4.6"],
    ],
    thinking: "high",
    label: "🔴 GLM-5.1 — surgical",
    minPromptLength: 40,
    keywords: [
      ["refactor", 2], ["architect", 3],
      ["redesign", 2], ["legacy", 2],
      ["ristruttur", 2], ["race condition", 3],
      ["deadlock", 3], ["memory leak", 3],
      ["security audit", 3], ["vulnerability", 3],
      ["cross-module", 3], ["breaking change", 3],
      ["database migration", 3], ["schema migration", 3],
      ["analiz.*codice.*compless", 3],
    ],
  },

  general: {
    // Primary: mimo-v2-pro — best default large-context backbone on opencode-go
    // Primary fallback: glm-5.1 — stronger long-horizon agentic behavior for harder runs
    // Primary fallback: kimi-k2.5 — broad generalist fallback with multimodal support
    // OR: xiaomi/mimo-v2-pro — closest mirror of the primary profile on OR
    // OR: Gemini 3.1 Pro / Sonnet 4.6 / GPT-5.4 — high-end general agentic fallbacks
    candidates: [
      ["opencode-go", "mimo-v2-pro"],
      ["opencode-go", "glm-5.1"],
      ["opencode-go", "kimi-k2.5"],
      ["openrouter", "xiaomi/mimo-v2-pro"],
      ["openrouter", "google/gemini-3.1-pro-preview"],
      ["openrouter", "anthropic/claude-sonnet-4.6"],
      ["openrouter", "openai/gpt-5.4"],
    ],
    thinking: "medium",
    label: "🔴 MiMo-V2-Pro — general",
    minPromptLength: 30,
    keywords: [
      ["computer use", 3], ["browser automation", 3],
      ["playwright", 3], ["selenium", 3],
      ["orchestrat", 3], ["multi-step", 2],
      ["workflow", 2], ["agent", 2],
      ["ragiona", 2], ["analiz.*profond", 3],
      ["spiega.*perché", 2], ["pipeline.*compless", 3],
    ],
  },

  // ── 🟡 TIER MID ────────────────────────────────────────────────────────────

  daily: {
    // Primary: minimax-m2.7 — best everyday coding value on opencode-go
    // Primary fallback: kimi-k2.5 — broader assistant fallback when the task widens
    // OR: minimax/minimax-m2.7 — same family fallback via OR
    // OR: Gemini 2.5 Flash — strong cost/perf for routine coding
    // OR: Qwen3-Coder-Plus — coder-oriented large-context fallback
    // OR: Sonnet 4.6 — quality ceiling when the "daily" task turns non-routine
    candidates: [
      ["opencode-go", "minimax-m2.7"],
      ["opencode-go", "kimi-k2.5"],
      ["openrouter", "minimax/minimax-m2.7"],
      ["openrouter", "google/gemini-2.5-flash"],
      ["openrouter", "qwen/qwen3-coder-plus"],
      ["openrouter", "anthropic/claude-sonnet-4.6"],
    ],
    thinking: "low",
    label: "🟡 MiniMax M2.7 — daily",
    minPromptLength: 10,
    keywords: [
      ["implement", 2], ["explain", 2],
      ["add feature", 2], ["create function", 2],
      ["write class", 2], ["fix bug", 2],
      ["debug", 2], ["integrate", 2],
    ],
  },

  polyglot: {
    // Primary: kimi-k2.5 — best primary fit for broad multilingual / cross-stack work
    // Primary fallback: mimo-v2-pro — 1M context for large migration/porting sessions
    // Primary fallback: glm-5.1 — long-horizon translation / porting / orchestration
    // OR: Qwen3.6 Plus — strong multilingual + 1M context
    // OR: Gemini 3.1 Pro — strong multilingual generalist with large context
    // OR: Qwen3.5-397B — large open multilingual fallback
    candidates: [
      ["opencode-go", "kimi-k2.5"],
      ["opencode-go", "mimo-v2-pro"],
      ["opencode-go", "glm-5.1"],
      ["openrouter", "qwen/qwen3.6-plus"],
      ["openrouter", "google/gemini-3.1-pro-preview"],
      ["openrouter", "qwen/qwen3.5-397b-a17b"],
    ],
    thinking: "medium",
    label: "🟡 Kimi K2.5 — polyglot",
    minPromptLength: 20,
    keywords: [
      ["python.*typescript", 3], ["rust.*go", 3],
      ["java.*kotlin", 3], ["swift.*objc", 3],
      ["multi-lang", 3], ["polyglot", 3],
      ["transpile", 3], ["port.*from", 2],
      ["convert.*language", 3], ["tool coordination", 3],
      ["mcp", 2],
    ],
  },

  // ── 🟢 TIER VELOCITÀ ───────────────────────────────────────────────────────

  terminal: {
    // Primary: minimax-m2.7 thinking:off — best shell/CI default on opencode-go
    // Primary fallback: kimi-k2.5 — secondary primary if MiniMax is unavailable
    // OR: Grok Code Fast — most purpose-built terminal/code fast-path in the fallback set
    // OR: Qwen3-Coder-Plus — large-context coder fallback for bigger scripts
    // OR: Gemini 2.5 Flash — reliable fast general coding fallback
    // OR: minimax/minimax-m2.7 — same-family OR safety net
    candidates: [
      ["opencode-go", "minimax-m2.7"],
      ["opencode-go", "kimi-k2.5"],
      ["openrouter", "x-ai/grok-code-fast-1"],
      ["openrouter", "qwen/qwen3-coder-plus"],
      ["openrouter", "google/gemini-2.5-flash"],
      ["openrouter", "minimax/minimax-m2.7"],
    ],
    thinking: "off",
    label: "🟢 MiniMax M2.7 — terminal",
    minPromptLength: 10,
    keywords: [
      ["bash", 3], ["chmod", 3], ["chown", 3],
      ["grep", 2], ["sed ", 2], ["awk ", 2],
      ["curl ", 2], ["wget ", 2], ["docker", 2],
      ["kubernetes", 3], ["k8s", 3], ["helm", 3],
      ["ci/cd", 3], ["github action", 3], ["systemctl", 3],
      ["systemd", 3], ["cron", 2], ["makefile", 3],
      ["git rebase", 3], ["git bisect", 3], ["pipeline.*docker", 3],
      ["pipeline.*ci", 3],
    ],
  },

  speed: {
    // Primary: minimax-m2.7 thinking:off — best throughput/cost default
    // Primary fallback: kimi-k2.5 — second primary if needed
    // OR: Grok 4.1 Fast — strong cheap high-throughput fallback
    // OR: Gemini 2.5 Flash — reliable fast large-context fallback
    // OR: Nova 2 Lite — fast 1M-context fallback
    // OR: Qwen3.5 Flash — good throughput alternative
    candidates: [
      ["opencode-go", "minimax-m2.7"],
      ["opencode-go", "kimi-k2.5"],
      ["openrouter", "x-ai/grok-4.1-fast"],
      ["openrouter", "google/gemini-2.5-flash"],
      ["openrouter", "amazon/nova-2-lite-v1"],
      ["openrouter", "qwen/qwen3.5-flash-02-23"],
    ],
    thinking: "off",
    label: "🟢 MiniMax M2.7 — speed",
    minPromptLength: 10,
    keywords: [
      ["boilerplate", 3], ["scaffold", 3],
      ["starter kit", 3], ["stub", 2],
      ["placeholder", 2], ["veloce", 2],
      ["rapido", 2], ["quick fix", 2],
    ],
  },

  // ── 🔵 TIER ALTERNATIVO ────────────────────────────────────────────────────

  budget: {
    // Primary: minimax-m2.7 — cheapest sensible primary on opencode-go
    // OR: MiniMax M2.5 free — huge free output window
    // OR: Qwen3-Coder free — coding-oriented free fallback
    // OR: Step 3.5 Flash free — large free output fallback
    // OR: GPT-OSS-20B free — free reasoning-capable general fallback
    candidates: [
      ["opencode-go", "minimax-m2.7"],
      ["openrouter", "minimax/minimax-m2.5:free"],
      ["openrouter", "qwen/qwen3-coder:free"],
      ["openrouter", "stepfun/step-3.5-flash:free"],
      ["openrouter", "openai/gpt-oss-20b:free"],
    ],
    thinking: "off",
    label: "🔵 MiniMax M2.7 — budget",
    minPromptLength: 10,
    keywords: [
      ["docstring", 3], ["jsdoc", 3], ["readme", 2],
      ["documentation", 2], ["unit test", 3], ["test case", 3],
      ["jest", 3], ["vitest", 3], ["pytest", 3],
      ["coverage", 2], ["lint", 2], ["prettier", 3],
      ["eslint", 3], ["i18n", 3], ["localiz", 3],
      ["traduc", 3], ["visual regression", 3],
    ],
  },

  uiux: {
    // Primary: mimo-v2-omni — best first pick when images matter
    // Primary fallback: kimi-k2.5 — second multimodal primary
    // OR: xiaomi/mimo-v2-omni — closest mirror of the primary profile on OR
    // OR: Gemini 3.1 Pro / Sonnet 4.6 — strong multimodal design reasoning
    // OR: Qwen3-VL-235B thinking — dedicated large VL fallback
    candidates: [
      ["opencode-go", "mimo-v2-omni"],
      ["opencode-go", "kimi-k2.5"],
      ["openrouter", "xiaomi/mimo-v2-omni"],
      ["openrouter", "google/gemini-3.1-pro-preview"],
      ["openrouter", "anthropic/claude-sonnet-4.6"],
      ["openrouter", "qwen/qwen3-vl-235b-a22b-thinking"],
    ],
    thinking: "medium",
    label: "🎨 MiMo V2 Omni — UI/UX",
    minPromptLength: 15,
    keywords: [
      ["figma", 3], ["mockup", 3], ["wireframe", 3],
      ["user interface", 3], ["design system", 3], ["landing page", 3],
      ["tailwind", 2], ["styled-components", 3], ["sass", 2],
      ["css animation", 3], ["dark mode", 2], ["theme ui", 3],
      ["ui component", 3], ["ux flow", 3], ["ux pattern", 3],
      ["color palette", 2], ["typography", 2],
    ],
  },

  // ── 🔵 TIER MANUALE ────────────────────────────────────────────────────────
  // Non selezionate automaticamente. Attivare con `/route pin <key>`.

  explore: {
    // Primary: kimi-k2.5 + mimo-v2-omni — best for visual exploration / codebase discovery
    // OR: Gemini 3.1 Pro — very large multimodal context
    // OR: Sonnet 4.6 — high-quality multimodal fallback
    // OR: Qwen3-VL-235B thinking — large visual reasoning fallback
    candidates: [
      ["opencode-go", "kimi-k2.5"],
      ["opencode-go", "mimo-v2-omni"],
      ["openrouter", "google/gemini-3.1-pro-preview"],
      ["openrouter", "anthropic/claude-sonnet-4.6"],
      ["openrouter", "qwen/qwen3-vl-235b-a22b-thinking"],
    ],
    thinking: "medium",
    label: "🔵 Kimi K2.5 — explore",
    manualOnly: true,
  },

  glm: {
    // Primary: glm-5.1 — best opencode-go fit for long-horizon engineering work
    // Primary fallback: minimax-m2.7 — same 131K output class at much lower cost
    // Primary fallback: mimo-v2-pro — 1M context when breadth beats raw output length
    // OR: z-ai/glm-4.6 — best GLM-family OR candidate for giant single-artifact output
    // OR: z-ai/glm-5-turbo — faster supervised GLM fallback with 131K output
    // OR: minimax/minimax-m2.7 — similar output-window fallback
    // OR: Opus 4.6 — premium ceiling fallback
    // Note: z-ai/glm-5.1 intentionally excluded here because OR max-out is only 4.1K
    candidates: [
      ["opencode-go", "glm-5.1"],
      ["opencode-go", "minimax-m2.7"],
      ["opencode-go", "mimo-v2-pro"],
      ["openrouter", "z-ai/glm-4.6"],
      ["openrouter", "z-ai/glm-5-turbo"],
      ["openrouter", "minimax/minimax-m2.7"],
      ["openrouter", "anthropic/claude-opus-4.6"],
    ],
    thinking: "high",
    label: "🔵 GLM-5.1 — long-horizon",
    manualOnly: true,
  },

};

/** Union of valid route keys, derived automatically from ROUTES. */
export type RouteKey =
  | "surgical" | "general" | "daily" | "polyglot"
  | "terminal" | "speed" | "budget" | "uiux"
  | "explore" | "glm";

/** Ordered list of auto-selectable routes (manualOnly excluded). */
export const AUTO_ROUTES: RouteKey[] = (Object.keys(ROUTES) as RouteKey[]).filter(
  (k) => !ROUTES[k].manualOnly
);