import type { TaskFailureDiagnosticDecision } from "./task-failure";

export interface DiagnosticTestSpecLike {
  taskId: string;
  testFiles?: Array<{
    path: string;
  }>;
  acceptance_signal?: string;
  coverage_threshold?: number;
}

export interface DiagnosticTaskLike {
  id: string;
  retries: number;
  acceptanceSignal?: string;
  coverageThreshold?: number;
  testSpecRefs?: string[];
}

export interface DiagnosticBlockerLike {
  taskId: string;
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

  task.acceptanceSignal = rewrittenTestSpec.acceptance_signal || task.acceptanceSignal;
  task.coverageThreshold = typeof rewrittenTestSpec.coverage_threshold === "number"
    ? rewrittenTestSpec.coverage_threshold
    : task.coverageThreshold;
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
  return {
    taskId,
    reason: decision.blocker.reason,
    suggestion: decision.blocker.suggestion,
    blockedTasks: decision.blocker.blockedTasks,
  };
}
