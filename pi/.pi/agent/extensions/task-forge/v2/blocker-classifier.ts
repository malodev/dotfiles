import type { BlockerCategory } from "./types.ts";

export interface BlockerEvidence {
  category?: BlockerCategory;
  diagnosticClassification?: string;
  reason?: string;
  suggestion?: string;
}

const VALIDATION_CONTRACT_PATTERNS = [
  "acceptance command",
  "acceptance signal",
  "validation command",
  "validation contract",
  "manual validation",
  "manual review",
  "not executable",
  "non-executable",
  "invalid executable",
  "prose",
  "command is prose",
  "executable/prose",
] as const;

const PLAN_CONTRACT_PATTERNS = [
  "test contract",
  "test spec",
  "generated tests",
  "generated test",
  "requirement",
  "requirements",
  "plan",
  "planner",
  "mismatch",
  "contradict",
  "conflict",
] as const;

const ENVIRONMENT_PATTERNS = [
  "environment",
  "transient",
  "timed out",
  "timeout",
  "econnrefused",
  "connection refused",
  "network",
  "dns",
  "working directory",
  "missing runtime",
  "binary mismatch",
  "permission denied",
  "service unavailable",
] as const;

function includesAny(haystack: string, patterns: readonly string[]) {
  return patterns.some((pattern) => haystack.includes(pattern));
}

export function classifyBlockerEvidence(evidence: BlockerEvidence): BlockerCategory {
  if (evidence.category) return evidence.category;

  const diagnosticClassification = String(evidence.diagnosticClassification ?? "").toLowerCase();
  const combined = `${String(evidence.reason ?? "")}\n${String(evidence.suggestion ?? "")}`.toLowerCase();

  if (combined.startsWith("blocked by failed dependency:")) return "dependency";

  if (diagnosticClassification === "requirement_or_plan_error") {
    if (includesAny(combined, VALIDATION_CONTRACT_PATTERNS)) return "validation_contract";
    return "plan_contract";
  }

  if (includesAny(combined, VALIDATION_CONTRACT_PATTERNS)) return "validation_contract";
  if (includesAny(combined, PLAN_CONTRACT_PATTERNS)) return "plan_contract";
  if (includesAny(combined, ENVIRONMENT_PATTERNS)) return "environment";
  if (combined.includes("runtime") || combined.includes("failure")) return "runtime";

  return "unknown";
}
