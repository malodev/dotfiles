import type { RunSnapshot } from "../../../v2/types.ts";
import { projectRootActionableBlocker } from "../../status/projection/root-actionable-blocker-selection.ts";

export function renderRootActionableBlockerStatus(snapshot: RunSnapshot | null) {
  const projection = projectRootActionableBlocker(snapshot);
  const primary = projection.primaryBlocker;

  return [
    projection.blockerIds.length > 0 ? `blockers: ${projection.blockerIds.join(", ")}` : "blockers: none",
    primary ? `primary blocker: ${primary.taskId}` : "",
    primary && projection.primaryBlockerCategory ? `blocker category: ${projection.primaryBlockerCategory}` : "",
    primary && projection.remediationDirection ? `remediation direction: ${projection.remediationDirection}` : "",
    primary ? `blocker reason: ${primary.reason}` : "",
    primary ? `blocker suggestion: ${primary.suggestion}` : "",
    primary && projection.downstreamImpactTaskIds.length > 0
      ? `downstream impact: ${projection.downstreamImpactTaskIds.join(", ")}`
      : "",
    primary ? `next: /forge blocker ${primary.taskId} --resolve "..." then /forge execute` : "",
  ].filter(Boolean).join("\n");
}
