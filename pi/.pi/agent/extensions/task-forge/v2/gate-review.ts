import type { TaskExecutionBlockerLike } from "./task-executor";
import type { TaskGateReviewResult } from "./task-success";
import type { TaskValidationContract } from "./validation";

export interface GateReviewTaskLike {
  id: string;
  title: string;
  taskMode: string;
  acceptanceCriteria: string[];
  outputManifest: string[];
  acceptanceSignal?: string;
  testCommand?: string;
  validation?: TaskValidationContract;
  coverageThreshold?: number;
  lastCoverage?: number;
  validationFramework?: string;
  validationOutput?: string;
  result?: string;
  testSpecRefs?: string[];
}

export interface GateReviewBlockerLike extends TaskExecutionBlockerLike {
  blockedTasks: string[];
}

export interface GateReviewHooks<TBlocker extends GateReviewBlockerLike = GateReviewBlockerLike> {
  runReviewer: (prompt: string, modelRole: "gateReviewer" | "integrationReviewer") => Promise<string>;
}

function extractJson(text: string): any | null {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidates = fenced ? [fenced[1], text] : [text];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim());
    } catch {}
  }
  return null;
}

export function requiresStrongGateReview(task: Pick<GateReviewTaskLike, "taskMode" | "coverageThreshold" | "acceptanceSignal" | "testSpecRefs">) {
  return task.taskMode === "iterative" || Boolean(task.coverageThreshold) || Boolean(task.acceptanceSignal) || Boolean(task.testSpecRefs?.length);
}

export function buildGateReviewPrompt(task: GateReviewTaskLike) {
  return [
    "# Validate task result",
    `Task: ${task.id} — ${task.title}`,
    `Mode: ${task.taskMode}`,
    "",
    "## Acceptance Criteria",
    ...task.acceptanceCriteria.map((value) => `- ${value}`),
    "",
    "## Output Manifest",
    ...(task.outputManifest.length ? task.outputManifest.map((value) => `- ${value}`) : ["- none specified"]),
    "",
    "## Acceptance Signal",
    task.acceptanceSignal || task.testCommand || task.validation?.command || "none",
    "",
    "## Manual Validation Notes",
    task.validation?.notes ?? "none",
    "",
    "## Coverage Threshold",
    task.coverageThreshold !== undefined ? String(task.coverageThreshold) : "none",
    "",
    "## Last Coverage",
    task.lastCoverage !== undefined ? String(task.lastCoverage) : "unknown",
    "",
    "## Validation Framework",
    task.validationFramework ?? "unknown",
    "",
    "## Validation Output",
    task.validationOutput ?? "",
    "",
    "## Worker Result",
    task.result ?? "",
    "",
    "Return:",
    '{ "passed": boolean, "notes": string, "blocker": {"reason": string, "suggestion": string, "blockedTasks": [] } | null }',
  ].join("\n");
}

export async function runTaskGateReview<TTask extends GateReviewTaskLike, TBlocker extends GateReviewBlockerLike = GateReviewBlockerLike>(
  task: TTask,
  hooks: GateReviewHooks<TBlocker>
): Promise<TaskGateReviewResult<TBlocker>> {
  const raw = await hooks.runReviewer(
    buildGateReviewPrompt(task),
    requiresStrongGateReview(task) ? "integrationReviewer" : "gateReviewer",
  );
  const parsed = extractJson(raw);
  if (!parsed) {
    return { passed: true, notes: "Gate reviewer returned unparsable output; passing conservatively." };
  }

  const blocker = parsed.blocker
    ? {
        taskId: task.id,
        reason: parsed.blocker.reason || "Blocked",
        suggestion: parsed.blocker.suggestion || "Needs user guidance",
        blockedTasks: Array.isArray(parsed.blocker.blockedTasks) ? parsed.blocker.blockedTasks : [],
      } as TBlocker
    : undefined;

  return {
    passed: Boolean(parsed.passed),
    notes: String(parsed.notes ?? ""),
    blocker,
  };
}
