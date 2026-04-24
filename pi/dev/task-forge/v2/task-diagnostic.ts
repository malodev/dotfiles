import type { TaskFailureDiagnosticDecision } from "./task-failure.ts";
import type { BlockerCategory, TaskValidationContract } from "./types.ts";
import { classifyBlockerEvidence } from "./blocker-classifier.ts";
import { materializeLegacyValidationFields, normalizeValidationContract } from "./validation.ts";

export interface DiagnosticTestSpecLike {
  taskId: string;
  testFiles?: Array<{
    path: string;
  }>;
  validation?: TaskValidationContract;
  acceptance_signal?: string;
  coverage_threshold?: number;
}

export interface DiagnosticTaskLike {
  id: string;
  retries: number;
  validation?: TaskValidationContract;
  acceptanceSignal?: string;
  coverageThreshold?: number;
  testSpecRefs?: string[];
}

export interface DiagnosticBlockerLike {
  taskId: string;
  category: BlockerCategory;
  reason: string;
  suggestion: string;
  blockedTasks: string[];
}

export function applyDiagnosticTestSpecRewrite<TTask extends DiagnosticTaskLike, TSpec extends DiagnosticTestSpecLike>(
  task: TTask,
  currentTestSpecs: TSpec[],
  rewrittenTestSpec: TSpec
) {
  const nextTestSpecs = currentTestSpecs.filter((spec) => spec.taskId !== task.id);
  nextTestSpecs.push(rewrittenTestSpec);

  const { validation } = normalizeValidationContract({
    validation: rewrittenTestSpec.validation,
    acceptanceSignal: rewrittenTestSpec.acceptance_signal,
    coverageThreshold: rewrittenTestSpec.coverage_threshold,
  });
  const legacyValidation = materializeLegacyValidationFields(validation);

  task.validation = validation;
  task.acceptanceSignal = legacyValidation.acceptanceSignal;
  task.coverageThreshold = legacyValidation.coverageThreshold;
  rewrittenTestSpec.validation = validation;
  rewrittenTestSpec.acceptance_signal = legacyValidation.acceptanceSignal;
  rewrittenTestSpec.coverage_threshold = legacyValidation.coverageThreshold;
  task.testSpecRefs = (rewrittenTestSpec.testFiles ?? []).map((file) => file.path);
  task.retries = 0;

  return {
    testSpecs: nextTestSpecs,
    rewrittenTestSpec,
  };
}

export function blockerFromDiagnosticDecision(
  taskId: string,
  decision: Extract<TaskFailureDiagnosticDecision, { kind: "block" }>
): DiagnosticBlockerLike {
  const category = classifyBlockerEvidence({
    diagnosticClassification: decision.classification,
    reason: decision.blocker.reason,
    suggestion: decision.blocker.suggestion,
  });

  return {
    taskId,
    category,
    reason: decision.blocker.reason,
    suggestion: decision.blocker.suggestion,
    blockedTasks: decision.blocker.blockedTasks,
  };
}
