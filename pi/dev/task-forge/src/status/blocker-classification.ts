import type { BlockerCategory } from "../../src/types.ts";

export type StatusBlockerClassification = "human_intervention" | "direct_blocker" | "dependency_blocked" | "unknown";

export interface DependencyReasonParseResult {
  isDependencyBlocked: boolean;
  upstreamTaskIds: string[];
  matchedPattern?: string;
}

export interface StatusBlockerClassificationInput {
  taskId: string;
  blocker?: {
    category?: BlockerCategory;
    reason?: string;
  };
  pendingHumanInterventionTaskId?: string;
}

const DIRECT_BLOCKER_CATEGORIES: ReadonlySet<BlockerCategory> = new Set([
  "environment",
  "validation_contract",
  "plan_contract",
  "runtime",
]);

const DEPENDENCY_REASON_PATTERNS: ReadonlyArray<{ key: string; pattern: RegExp }> = [
  {
    key: "blocked_by_failed_dependency",
    pattern: /^\s*blocked by failed dependenc(?:y|ies)\s*[:\-]?\s*(.*)$/i,
  },
  {
    key: "blocked_by_dependency",
    pattern: /^\s*blocked by dependenc(?:y|ies)\s*[:\-]?\s*(.*)$/i,
  },
  {
    key: "blocked_by_upstream_dependency",
    pattern: /^\s*blocked by upstream dependenc(?:y|ies)\s*[:\-]?\s*(.*)$/i,
  },
  {
    key: "dependency_failed",
    pattern: /^\s*dependenc(?:y|ies) failed\s*[:\-]?\s*(.*)$/i,
  },
];

const TASK_ID_TOKEN = /\b(?:TF-?\d+[A-Za-z0-9-]*|T\d+[A-Za-z0-9-]*)\b/gi;

function normalizeTaskIdToken(taskId: string): string {
  return taskId.trim().toUpperCase();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = normalizeTaskIdToken(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

export function parseDependencyBlockedReason(reason: string | undefined | null): DependencyReasonParseResult {
  const rawReason = String(reason ?? "").trim();
  if (!rawReason) {
    return {
      isDependencyBlocked: false,
      upstreamTaskIds: [],
    };
  }

  for (const matcher of DEPENDENCY_REASON_PATTERNS) {
    const match = rawReason.match(matcher.pattern);
    if (!match) continue;

    const upstreamSegment = String(match[1] ?? "");
    const upstreamTaskIds = unique(upstreamSegment.match(TASK_ID_TOKEN) ?? []);

    return {
      isDependencyBlocked: true,
      upstreamTaskIds,
      matchedPattern: matcher.key,
    };
  }

  return {
    isDependencyBlocked: false,
    upstreamTaskIds: [],
  };
}

export function classifyStatusBlockedTask(input: StatusBlockerClassificationInput): StatusBlockerClassification {
  if (input.pendingHumanInterventionTaskId && input.pendingHumanInterventionTaskId === input.taskId) {
    return "human_intervention";
  }

  const category = input.blocker?.category;
  if (category === "dependency") return "dependency_blocked";
  if (category && DIRECT_BLOCKER_CATEGORIES.has(category)) return "direct_blocker";

  const dependencyReason = parseDependencyBlockedReason(input.blocker?.reason);
  if (dependencyReason.isDependencyBlocked) return "dependency_blocked";

  const reason = String(input.blocker?.reason ?? "").trim();
  if (!reason) return "unknown";

  if (category === "unknown") return "unknown";
  return "direct_blocker";
}
