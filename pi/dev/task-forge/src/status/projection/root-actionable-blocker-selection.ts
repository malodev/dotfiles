import { selectBlockerResolutionMode } from "../../blocker-resolution-mode.ts";
import type { Blocker, BlockerCategory, BlockerResolutionMode, RunSnapshot } from "../../types.ts";
import { classifyStatusBlockedTask, parseDependencyBlockedReason } from "../blocker-classification.ts";

export interface RootActionableBlockerProjection {
  blockerIds: string[];
  primaryBlocker?: Blocker;
  primaryBlockerCategory?: BlockerCategory;
  remediationMode?: BlockerResolutionMode;
  remediationDirection?: "retry" | "patch/replan";
  downstreamImpactTaskIds: string[];
}

const MAX_UPSTREAM_RESOLUTION_DEPTH = 12;

function isDependencyBlocker(blocker: Pick<Blocker, "taskId" | "category" | "reason"> | undefined) {
  if (!blocker) return false;
  return classifyStatusBlockedTask({
    taskId: blocker.taskId,
    blocker: {
      category: blocker.category,
      reason: blocker.reason,
    },
  }) === "dependency_blocked";
}

function remediationDirectionFromMode(mode: BlockerResolutionMode | undefined): "retry" | "patch/replan" | undefined {
  if (!mode) return undefined;
  return mode === "retry" || mode === "manual_override" ? "retry" : "patch/replan";
}

function inferRemediationMode(blocker: Blocker, snapshot: RunSnapshot): BlockerResolutionMode {
  const runtime = snapshot.taskState[blocker.taskId];
  return blocker.remediation?.mode ?? selectBlockerResolutionMode({
    category: blocker.category,
    reason: blocker.reason,
    suggestion: blocker.suggestion,
    diagnosticClassification: runtime?.diagnostic?.classification,
    diagnosticNotes: runtime?.diagnostic?.notes,
    blockedTasks: blocker.blockedTasks,
  });
}

const CATEGORY_PRIORITY: Record<BlockerCategory, number> = {
  validation_contract: 0,
  plan_contract: 1,
  runtime: 2,
  environment: 3,
  unknown: 4,
  dependency: 5,
};

interface RootResolution {
  rootTaskId: string;
  confidence: "high" | "low";
}

function stableSortTaskIds(taskIds: Iterable<string>) {
  return [...new Set(taskIds)].sort((a, b) => a.localeCompare(b));
}

function stableUniqueTaskIds(taskIds: Iterable<string>) {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const taskId of taskIds) {
    if (seen.has(taskId)) continue;
    seen.add(taskId);
    ordered.push(taskId);
  }
  return ordered;
}

function getTaskPriority(taskId: string, getBlockerForTask: (candidateTaskId: string) => Blocker | undefined) {
  const blocker = getBlockerForTask(taskId);
  return blocker ? (CATEGORY_PRIORITY[blocker.category] ?? CATEGORY_PRIORITY.unknown) : CATEGORY_PRIORITY.unknown;
}

export function projectRootActionableBlocker(snapshot: RunSnapshot | null): RootActionableBlockerProjection {
  if (!snapshot) {
    return {
      blockerIds: [],
      downstreamImpactTaskIds: [],
    };
  }

  const unresolvedBlockers = snapshot.blockers.filter((blocker) => !blocker.resolvedAt);
  const unresolvedBlockerByTaskId = new Map(unresolvedBlockers.map((blocker) => [blocker.taskId, blocker]));
  const tasksById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const blockerIds = stableSortTaskIds([
    ...unresolvedBlockers.map((blocker) => blocker.taskId),
    ...(snapshot.pendingHumanIntervention ? [snapshot.pendingHumanIntervention.taskId] : []),
  ]);

  const getBlockerForTask = (taskId: string): Blocker | undefined => {
    return unresolvedBlockerByTaskId.get(taskId) ?? snapshot.taskState[taskId]?.blocker;
  };

  const buildSyntheticRootBlocker = (taskId: string): Blocker => {
    const runtime = snapshot.taskState[taskId];
    const taskStatus = runtime?.status ?? "blocked";
    const statusReason = runtime?.error?.trim()
      ? runtime.error.trim()
      : `Task ${taskId} is ${taskStatus} without an unresolved blocker record.`;

    return {
      taskId,
      category: "unknown",
      reason: statusReason,
      suggestion: `Inspect ${taskId} logs/output, resolve root cause, then rerun /forge execute.`,
      blockedTasks: [taskId],
    };
  };

  if (blockerIds.length === 0) {
    return {
      blockerIds,
      downstreamImpactTaskIds: [],
    };
  }

  const rootMemo = new Map<string, RootResolution>();

  const findRootBlockerTask = (taskId: string, depth = 0, visiting = new Set<string>()): RootResolution => {
    const memoized = rootMemo.get(taskId);
    if (memoized) return memoized;

    if (depth >= MAX_UPSTREAM_RESOLUTION_DEPTH || visiting.has(taskId)) {
      const cyclicResolution: RootResolution = { rootTaskId: taskId, confidence: "low" };
      rootMemo.set(taskId, cyclicResolution);
      return cyclicResolution;
    }

    const blocker = getBlockerForTask(taskId);
    if (!blocker) {
      const missingResolution: RootResolution = { rootTaskId: taskId, confidence: "low" };
      rootMemo.set(taskId, missingResolution);
      return missingResolution;
    }

    if (!isDependencyBlocker(blocker)) {
      const directResolution: RootResolution = { rootTaskId: taskId, confidence: "high" };
      rootMemo.set(taskId, directResolution);
      return directResolution;
    }

    visiting.add(taskId);

    const metadataDeps = (tasksById.get(taskId)?.dependencies ?? []).filter((depId) => {
      const depStatus = snapshot.taskState[depId]?.status;
      if (depStatus === "blocked" || depStatus === "failed") return true;
      return Boolean(getBlockerForTask(depId));
    });

    const parsedReasonDeps = parseDependencyBlockedReason(blocker.reason).upstreamTaskIds;
    const metadataFirstTaskIds = [
      ...stableSortTaskIds(metadataDeps),
      ...stableSortTaskIds(parsedReasonDeps),
    ].filter((upstreamId) => upstreamId !== taskId);
    const candidateUpstreamTaskIds = stableUniqueTaskIds(metadataFirstTaskIds);

    if (candidateUpstreamTaskIds.length === 0) {
      visiting.delete(taskId);
      const unresolvedResolution: RootResolution = { rootTaskId: taskId, confidence: "low" };
      rootMemo.set(taskId, unresolvedResolution);
      return unresolvedResolution;
    }

    let bestCandidate: RootResolution | undefined;

    for (const upstreamTaskId of candidateUpstreamTaskIds) {
      const upstreamBlocker = getBlockerForTask(upstreamTaskId);

      if (!upstreamBlocker) {
        const upstreamStatus = snapshot.taskState[upstreamTaskId]?.status;
        if (upstreamStatus === "failed") {
          const failedRootResolution: RootResolution = { rootTaskId: upstreamTaskId, confidence: "high" };
          visiting.delete(taskId);
          rootMemo.set(taskId, failedRootResolution);
          return failedRootResolution;
        }

        if (upstreamStatus === "blocked") {
          const blockedUpstreamResolution: RootResolution = { rootTaskId: upstreamTaskId, confidence: "low" };
          if (!bestCandidate) {
            bestCandidate = blockedUpstreamResolution;
          }
        }

        continue;
      }

      const upstreamResolution = findRootBlockerTask(upstreamTaskId, depth + 1, visiting);
      const upstreamRootBlocker = getBlockerForTask(upstreamResolution.rootTaskId);
      if (!upstreamRootBlocker) {
        if (upstreamResolution.confidence === "high" && snapshot.taskState[upstreamResolution.rootTaskId]?.status === "failed") {
          visiting.delete(taskId);
          rootMemo.set(taskId, upstreamResolution);
          return upstreamResolution;
        }
        continue;
      }

      if (upstreamResolution.confidence === "high" && !isDependencyBlocker(upstreamRootBlocker)) {
        visiting.delete(taskId);
        rootMemo.set(taskId, upstreamResolution);
        return upstreamResolution;
      }

      if (!bestCandidate) {
        bestCandidate = upstreamResolution;
      } else {
        const confidenceRank = upstreamResolution.confidence === "high" ? 0 : 1;
        const bestConfidenceRank = bestCandidate.confidence === "high" ? 0 : 1;
        if (confidenceRank < bestConfidenceRank) {
          bestCandidate = upstreamResolution;
          continue;
        }

        if (confidenceRank === bestConfidenceRank) {
          const upstreamPriority = getTaskPriority(upstreamResolution.rootTaskId, getBlockerForTask);
          const bestPriority = getTaskPriority(bestCandidate.rootTaskId, getBlockerForTask);
          if (upstreamPriority < bestPriority) {
            bestCandidate = upstreamResolution;
            continue;
          }
          if (upstreamPriority === bestPriority && upstreamResolution.rootTaskId.localeCompare(bestCandidate.rootTaskId) < 0) {
            bestCandidate = upstreamResolution;
          }
        }
      }
    }

    visiting.delete(taskId);

    if (!bestCandidate) {
      const fallbackResolution: RootResolution = { rootTaskId: taskId, confidence: "low" };
      rootMemo.set(taskId, fallbackResolution);
      return fallbackResolution;
    }

    rootMemo.set(taskId, bestCandidate);
    return bestCandidate;
  };

  const impactByRoot = new Map<string, Set<string>>();
  const effectiveRootByBlockerId = new Map<string, string>();

  for (const blockerId of blockerIds) {
    const rootResolution = findRootBlockerTask(blockerId);
    const effectiveRootId = rootResolution.confidence === "high" ? rootResolution.rootTaskId : blockerId;

    effectiveRootByBlockerId.set(blockerId, effectiveRootId);

    const impacted = impactByRoot.get(effectiveRootId) ?? new Set<string>();
    if (blockerId !== effectiveRootId) impacted.add(blockerId);
    impactByRoot.set(effectiveRootId, impacted);
  }

  const compareCandidateTaskIds = (left: string, right: string) => {
    const impactDelta = (impactByRoot.get(right)?.size ?? 0) - (impactByRoot.get(left)?.size ?? 0);
    if (impactDelta !== 0) return impactDelta;

    const leftPriority = getTaskPriority(left, getBlockerForTask);
    const rightPriority = getTaskPriority(right, getBlockerForTask);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;

    return left.localeCompare(right);
  };

  const primaryFromPending = snapshot.pendingHumanIntervention
    ? getBlockerForTask(effectiveRootByBlockerId.get(snapshot.pendingHumanIntervention.taskId) ?? snapshot.pendingHumanIntervention.taskId)
      ?? getBlockerForTask(snapshot.pendingHumanIntervention.taskId)
    : undefined;

  const directCandidates = stableSortTaskIds(
    unresolvedBlockers
      .filter((blocker) => !isDependencyBlocker(blocker))
      .map((blocker) => blocker.taskId),
  ).sort(compareCandidateTaskIds);

  const dependencyFallbackCandidates = stableSortTaskIds(
    unresolvedBlockers
      .filter((blocker) => isDependencyBlocker(blocker))
      .map((blocker) => effectiveRootByBlockerId.get(blocker.taskId) ?? blocker.taskId),
  ).sort(compareCandidateTaskIds);

  const selectedPrimaryTaskId = primaryFromPending?.taskId
    ?? directCandidates[0]
    ?? dependencyFallbackCandidates[0]
    ?? blockerIds[0];

  const primaryBlocker = getBlockerForTask(selectedPrimaryTaskId)
    ?? buildSyntheticRootBlocker(selectedPrimaryTaskId)
    ?? unresolvedBlockers[0];

  if (!primaryBlocker) {
    return {
      blockerIds,
      downstreamImpactTaskIds: [],
    };
  }

  const remediationMode = inferRemediationMode(primaryBlocker, snapshot);

  return {
    blockerIds,
    primaryBlocker,
    primaryBlockerCategory: primaryBlocker.category,
    remediationMode,
    remediationDirection: remediationDirectionFromMode(remediationMode),
    downstreamImpactTaskIds: stableSortTaskIds(impactByRoot.get(primaryBlocker.taskId) ?? []),
  };
}
