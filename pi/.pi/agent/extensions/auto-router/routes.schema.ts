/**
 * routes.schema.ts
 * Shared types for the auto-router extension.
 * Import from here in both routes.config.ts and index.ts.
 */

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * A single provider+model candidate.
 * Candidates are tried in order; the first one whose model is found
 * and whose API key is available wins.
 */
export type Candidate = [provider: string, modelId: string];

export interface RouteConfig {
  /**
   * Ordered list of [provider, modelId] pairs to try.
   * The first available candidate is used; the rest are fallbacks.
   * Fix #1: replaces single provider/modelId with multi-candidate fallback chain.
   */
  candidates: Candidate[];
  /** Thinking level to apply when this route is selected */
  thinking: ThinkingLevel;
  /** Human-readable label shown in status bar and notifications */
  label: string;
  /**
   * If true, this route is never selected automatically.
   * It can only be activated via `/route pin <key>`.
   */
  manualOnly?: boolean;
  /**
   * Weighted keyword patterns (lowercase) that trigger this route.
   * Each entry is [keyword, weight]. Higher weight = stronger signal.
   * Fix #2: replaces flat string[] with weighted pairs to avoid
   * generic words ("fix", "add") dominating over specific ones.
   */
  keywords?: [keyword: string, weight: number][];
  /**
   * Minimum prompt length (chars) to consider this route.
   * Fix #7: avoid routing very short prompts to heavy models.
   * Recommended minimum: 10 for fast routes, 30+ for deep/surgical.
   */
  minPromptLength?: number;
}
