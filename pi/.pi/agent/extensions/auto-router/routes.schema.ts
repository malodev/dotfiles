/**
 * routes.schema.ts
 * Shared types for the auto-router extension.
 * Runtime route data is loaded from auto-router.json.
 */

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** A single provider+model candidate. */
export type Candidate = [provider: string, modelId: string];

/** JSON-friendly candidate form: either "provider/modelId" or [provider, modelId]. */
export type CandidateSpec = string | Candidate;

export interface RouteDefinition {
  /** Thinking level to apply when this route is selected. */
  thinking: ThinkingLevel;
  /** Human-readable label shown in status bar and notifications. */
  label: string;
  /** If true, this route is never selected automatically; use `/route pin <key>`. */
  manualOnly?: boolean;
  /** Weighted keyword patterns (lowercase) that trigger this route. */
  keywords?: [keyword: string, weight: number][];
  /** Minimum prompt length (chars) to consider this route. */
  minPromptLength?: number;
}

export interface RouteConfig extends RouteDefinition {
  /** Ordered list of [provider, modelId] pairs to try. */
  candidates: Candidate[];
  /** Effective tier selected for this route in the active profile. */
  tier: string;
}

export interface TierRuleConfig {
  /** Routes this rule may affect. Omit or use ["*"] to match all routes. */
  routes?: string[];
  /** Keyword strings that trigger this tier override. */
  keywords: string[];
  /** Tier selected when this rule matches. */
  tier: string;
}

export interface EscalationConfig {
  /** Number of failure/stuck prompts before tier escalation begins. */
  failureThreshold: number;
  /** Failure/stuck phrases that increment escalation memory. */
  failureKeywords: string[];
  /** Suggested next profile when the current profile is already at max tier. */
  profileEscalationHints?: Record<string, string>;
}

export interface RouterProfileConfig {
  /** Reusable model pools. Keep each list short: primary model plus at most one failover. */
  modelTiers: Record<string, CandidateSpec[]>;
  /** Route-to-tier mapping. Use "*" as a wildcard tier assignment for every route. */
  routeAssignment: Record<string, string>;
}

export interface AutoRouterConfig {
  /** Profile selected when no persisted profile exists. Must exist in profiles. */
  defaultProfile: string;
  /** Ordered escalation ladder, e.g. fast → coding → reasoning → endurance. */
  tierLadder: string[];
  /** Repeated-failure escalation behavior. */
  escalation: EscalationConfig;
  /** Route metadata keyed by route name. Shared by every profile. */
  routes: Record<string, RouteDefinition>;
  /** Ordered tier override rules. First matching rule wins. */
  tierRules?: TierRuleConfig[];
  /** Named model groups. Switch at runtime with `/route profile <name>`. */
  profiles: Record<string, RouterProfileConfig>;
}
