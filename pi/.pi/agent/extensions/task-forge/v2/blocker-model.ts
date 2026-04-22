import type { Blocker, BlockerCategory, BlockerResolutionMode, RemediationRecord, RunSnapshot } from "./types.ts";
import { classifyBlockerEvidence } from "./blocker-classifier.ts";

export const BLOCKER_CATEGORIES = [
  "environment",
  "dependency",
  "validation_contract",
  "plan_contract",
  "runtime",
  "unknown",
] as const satisfies readonly BlockerCategory[];

export const BLOCKER_RESOLUTION_MODES = [
  "retry",
  "patch_task_contract",
  "patch_test_spec",
  "replan_task",
  "replan_subgraph",
  "manual_override",
] as const satisfies readonly BlockerResolutionMode[];

function isBlockerCategory(value: unknown): value is BlockerCategory {
  return typeof value === "string" && (BLOCKER_CATEGORIES as readonly string[]).includes(value);
}

function isBlockerResolutionMode(value: unknown): value is BlockerResolutionMode {
  return typeof value === "string" && (BLOCKER_RESOLUTION_MODES as readonly string[]).includes(value);
}

export function inferBlockerCategory(blocker: { reason: string; suggestion?: string; category?: BlockerCategory }): BlockerCategory {
  if (isBlockerCategory(blocker.category)) return blocker.category;
  return classifyBlockerEvidence(blocker);
}

export function createBlocker(input: {
  taskId: string;
  reason: string;
  suggestion: string;
  blockedTasks: string[];
  category?: BlockerCategory;
  remediation?: RemediationRecord;
}): Blocker {
  return {
    taskId: input.taskId,
    reason: input.reason,
    suggestion: input.suggestion,
    blockedTasks: input.blockedTasks,
    category: input.category ?? inferBlockerCategory({ reason: input.reason, suggestion: input.suggestion }),
    remediation: input.remediation,
  };
}

export function createRemediationRecord(input: {
  mode: BlockerResolutionMode;
  category: BlockerCategory;
  rationale: string;
  durabilityCommitRef?: string;
  durabilityCommittedAt?: string;
}): RemediationRecord {
  return {
    mode: input.mode,
    category: input.category,
    rationale: input.rationale,
    durabilityCommitRef: input.durabilityCommitRef,
    durabilityCommittedAt: input.durabilityCommittedAt,
  };
}

export function normalizeRemediationRecord(value: unknown, fallbackCategory: BlockerCategory): RemediationRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<RemediationRecord>;
  if (typeof record.rationale !== "string" || !record.rationale.trim()) return undefined;

  return {
    mode: isBlockerResolutionMode(record.mode) ? record.mode : "retry",
    category: isBlockerCategory(record.category) ? record.category : fallbackCategory,
    rationale: record.rationale,
    durabilityCommitRef: typeof record.durabilityCommitRef === "string" ? record.durabilityCommitRef : undefined,
    durabilityCommittedAt: typeof record.durabilityCommittedAt === "string" ? record.durabilityCommittedAt : undefined,
  };
}

export function normalizeBlocker(value: unknown): Blocker {
  const blocker = value as Partial<Blocker>;
  const normalized = createBlocker({
    taskId: String(blocker.taskId ?? ""),
    reason: String(blocker.reason ?? "Blocked"),
    suggestion: String(blocker.suggestion ?? "Needs review"),
    blockedTasks: Array.isArray(blocker.blockedTasks) ? blocker.blockedTasks.filter((entry: unknown): entry is string => typeof entry === "string") : [],
    category: isBlockerCategory(blocker.category) ? blocker.category : undefined,
  });

  if (typeof blocker.resolvedBy === "string") normalized.resolvedBy = blocker.resolvedBy;
  if (typeof blocker.resolvedAt === "string") normalized.resolvedAt = blocker.resolvedAt;
  normalized.remediation = normalizeRemediationRecord(blocker.remediation, normalized.category);
  return normalized;
}

export function migrateSnapshotBlockers<TSnapshot extends Pick<RunSnapshot, "blockers" | "taskState">>(snapshot: TSnapshot): TSnapshot {
  snapshot.blockers = snapshot.blockers.map((blocker: Blocker) => normalizeBlocker(blocker));

  for (const task of Object.values(snapshot.taskState) as Array<RunSnapshot["taskState"][string]>) {
    if (task?.blocker) {
      task.blocker = normalizeBlocker(task.blocker);
    }
  }

  return snapshot;
}
