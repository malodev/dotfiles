import type { BlockerCategory, BlockerResolutionMode } from "./types.ts";

export interface BlockerResolutionModeSelectionInput {
  category: BlockerCategory;
  reason?: string;
  suggestion?: string;
  resolution?: string;
  diagnosticClassification?: string;
  diagnosticNotes?: string;
  blockedTasks?: string[];
}

const RETRY_OVERRIDE_PATTERNS = [
  "force retry",
  "retry only",
  "override to retry",
  "explicit retry override",
] as const;

const TEST_SPEC_PATTERNS = [
  "test spec",
  "acceptance signal",
  "acceptance command",
  "validation command",
  "generated tests",
  "test file",
  "test contract",
] as const;

const SUBGRAPH_PATTERNS = [
  "subgraph",
  "subtree",
  "dependency chain",
  "multiple tasks",
  "affected task subtree",
  "planner",
] as const;

function includesAny(haystack: string, patterns: readonly string[]) {
  return patterns.some((pattern) => haystack.includes(pattern));
}

export function hasExplicitRetryOverride(resolution: string | undefined) {
  const normalized = String(resolution ?? "").toLowerCase();
  return includesAny(normalized, RETRY_OVERRIDE_PATTERNS);
}

export function selectBlockerResolutionMode(input: BlockerResolutionModeSelectionInput): BlockerResolutionMode {
  if (hasExplicitRetryOverride(input.resolution)) {
    return "retry";
  }

  const combined = [
    input.reason,
    input.suggestion,
    input.resolution,
    input.diagnosticClassification,
    input.diagnosticNotes,
    ...(input.blockedTasks ?? []),
  ].join("\n").toLowerCase();

  switch (input.category) {
    case "environment":
    case "dependency":
    case "runtime":
    case "unknown":
      return "retry";
    case "validation_contract":
      return includesAny(combined, TEST_SPEC_PATTERNS) ? "patch_test_spec" : "patch_task_contract";
    case "plan_contract":
      if (includesAny(combined, SUBGRAPH_PATTERNS) || (input.blockedTasks?.length ?? 0) > 1) {
        return "replan_subgraph";
      }
      return "replan_task";
  }
}
