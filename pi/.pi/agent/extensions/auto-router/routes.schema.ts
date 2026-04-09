/**
 * routes.schema.ts
 * Shared types for the auto-router extension.
 * Import from here in both routes.config.ts and index.ts.
 */

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface RouteConfig {
  /** Provider id as registered in pi (e.g. "anthropic", "openai") */
  provider: string;
  /** Model id as registered in pi's model registry */
  modelId: string;
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
   * Keyword patterns (lowercase) that trigger this route.
   * Matched against the user's prompt before sending to the LLM.
   */
  keywords?: string[];
  /**
   * Minimum prompt length (chars) to consider this route.
   * Useful to avoid routing short clarification messages to heavy models.
   */
  minPromptLength?: number;
}
