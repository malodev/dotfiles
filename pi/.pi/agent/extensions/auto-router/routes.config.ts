/**
 * routes.config.ts
 * Route definitions for the auto-router extension.
 * Edit this file to add, remove, or tune routes without touching logic.
 */

import type { RouteConfig } from "./routes.schema";

export const ROUTES = {
  fast: {
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    thinking: "off",
    label: "Fast (Haiku)",
    keywords: ["fix", "rename", "typo", "format", "lint", "quick", "simple"],
    minPromptLength: 0,
  },
  balanced: {
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    thinking: "low",
    label: "Balanced (Sonnet)",
    keywords: ["implement", "refactor", "explain", "write", "add", "update"],
    minPromptLength: 20,
  },
  deep: {
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    thinking: "high",
    label: "Deep (Sonnet + thinking)",
    keywords: ["architect", "design", "analyze", "debug", "investigate", "why", "how does"],
    minPromptLength: 40,
  },
  opus: {
    provider: "anthropic",
    modelId: "claude-opus-4-5",
    thinking: "high",
    label: "Opus (manual only)",
    manualOnly: true,
  },
} as const satisfies Record<string, RouteConfig>;

/** Union of valid route keys, derived automatically from ROUTES. */
export type RouteKey = keyof typeof ROUTES;

/** Ordered list of auto-selectable routes (manualOnly excluded). */
export const AUTO_ROUTES: RouteKey[] = (Object.keys(ROUTES) as RouteKey[]).filter(
  (k) => !ROUTES[k].manualOnly
);
