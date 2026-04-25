import { beginTaskExecution, completeTaskExecution, failTaskExecutionAttempt, type TaskExecutionBlockerLike, type TaskExecutionTaskLike } from "./task-executor";
import { applyDiagnosticTestSpecRewrite, blockerFromDiagnosticDecision, type DiagnosticTestSpecLike, type DiagnosticTaskLike } from "./task-diagnostic";
import {
  applyTaskDiagnostic,
  applyTaskFailureSignature,
  decideTaskFailure,
  decideTaskFailureDiagnosis,
  failTaskTerminally,
  retryTaskAfterFailure,
  syncTaskFailureRuntime,
  type EnvironmentFailureLike,
  type TaskFailureTaskLike,
} from "./task-failure";
import { executeTaskSuccessPath, type TaskGateReviewResult, type TaskSuccessTaskLike, type TaskValidationResult } from "./task-success";
import { normalizeValidationCommand } from "./validation";

export type TaskRunnerRole = "worker" | "workerIterative";
export type TaskRunnerTddPhase = "red" | "green" | "refactor" | "complete";

export interface TaskRunnerTaskLike
  extends TaskExecutionTaskLike,
    TaskSuccessTaskLike,
    TaskFailureTaskLike,
    DiagnosticTaskLike {
  title: string;
  turnBudget?: number;
  acceptanceCriteria: string[];
  outputManifest: string[];
  testCommand?: string;
  acceptanceSignal?: string;
  resolutionInstruction?: string;
}

export interface TaskRunnerIterationLogEntry {
  time: string;
  turn: number;
  tddPhase?: TaskRunnerTddPhase;
  passed: boolean;
  coverage?: number;
  feedback: string;
}

export interface TaskRunnerHooks<TTask extends TaskRunnerTaskLike, TBlocker extends TaskExecutionBlockerLike = TaskExecutionBlockerLike, TTestSpec extends DiagnosticTestSpecLike = DiagnosticTestSpecLike> {
  nowIso: () => string;
  maxRetries: number;
  defaultTurnBudget: number;
  maxTurnBudget: number;
  buildTaskContext: (task: TTask) => Promise<string>;
  spawnWorker: (role: TaskRunnerRole, prompt: string, options: { promptAppendix: string; timeout: number }) => Promise<string>;
  runValidation: (task: TTask) => Promise<TaskValidationResult>;
  runGateReview: (task: TTask) => Promise<TaskGateReviewResult<TBlocker>>;
  runDiagnosticReview: (task: TTask) => Promise<any>;
  beginExecution: (task: TTask) => Promise<void>;
  completeExecution: (task: TTask, gate: { passed: boolean; notes: string }) => Promise<void>;
  failExecutionAttempt: (task: TTask, error: unknown) => Promise<void>;
  markHeartbeat: (taskId: string) => Promise<void>;
  markTddProgress: (taskId: string, phase: TaskRunnerTddPhase, runtime: { iterationCount?: number; redEstablishedAt?: string; greenAchievedAt?: string; refactorValidatedAt?: string }) => Promise<void>;
  markValidation: (taskId: string, validation: TaskValidationResult, task: TTask) => Promise<void>;
  markGateReview: (taskId: string, gate: TaskGateReviewResult<TBlocker>) => Promise<void>;
  onGateBlocked?: (task: TTask, gate: TaskGateReviewResult<TBlocker>) => Promise<void>;
  appendIterationLog: (taskId: string, entry: TaskRunnerIterationLogEntry) => Promise<void>;
  environmentFailure: (task: TTask) => EnvironmentFailureLike | null | undefined;
  normalizeFailureSignature: (error?: string) => string | undefined;
  canDiagnose: (task: TTask) => boolean;
  createHumanInterventionBlocker: (task: TTask, reason: string, suggestion: string) => TBlocker;
  pauseForHumanIntervention: (task: TTask, blocker: TBlocker, event: string, details?: Record<string, unknown>) => Promise<void>;
  saveDiagnostic: (taskId: string, diagnosis: unknown) => Promise<void>;
  persistTaskDefinitions: () => Promise<void>;
  updateTestSpecs: (testSpecs: TTestSpec[]) => Promise<void>;
  currentTestSpecs: () => TTestSpec[];
  testSpecMarkdownFile?: () => string | undefined;
  markTestSpecWritten: (testSpecs: TTestSpec[], markdownFile?: string) => Promise<void>;
  requeueTask: (taskId: string, reason: string) => Promise<void>;
  reconcile: () => Promise<void>;
  persistState: (event: string, details?: Record<string, unknown>) => Promise<void>;
  runtimeFailureSync: {
    markRuntime: (taskId: string, runtime: {
      retries: number;
      error?: string | null;
      failureSignature?: string | null;
      diagnostic?: {
        classification: string;
        notes: string;
        blockerCategory?: import("./types.ts").BlockerCategory;
        remediationMode?: import("./types.ts").BlockerResolutionMode;
      };
      diagnosticCount?: number;
    }) => Promise<void>;
  };
  terminalFailureSync: {
    markRuntime: (taskId: string, runtime: {
      retries: number;
      error?: string | null;
      failureSignature?: string | null;
      diagnostic?: {
        classification: string;
        notes: string;
        blockerCategory?: import("./types.ts").BlockerCategory;
        remediationMode?: import("./types.ts").BlockerResolutionMode;
      };
      diagnosticCount?: number;
    }) => Promise<void>;
    markFailed: (taskId: string, error: string) => Promise<void>;
  };
  retryFailureSync: {
    markRuntime: (taskId: string, runtime: {
      retries: number;
      error?: string | null;
      failureSignature?: string | null;
      diagnostic?: {
        classification: string;
        notes: string;
        blockerCategory?: import("./types.ts").BlockerCategory;
        remediationMode?: import("./types.ts").BlockerResolutionMode;
      };
      diagnosticCount?: number;
    }) => Promise<void>;
    requeue: (taskId: string, reason: string) => Promise<void>;
  };
}

const ITERATIVE_PHASE_INSTRUCTIONS: Record<Exclude<TaskRunnerTddPhase, "complete">, string> = {
  red: "You are in RED. Your goal is to establish a failing test or failing validation signal. Do not aim for passing validation yet. If validation passes, the red phase has failed and you must correct the test setup.",
  green: "You are in GREEN. Make the smallest implementation change required to turn validation green. Do not refactor yet.",
  refactor: "You are in REFACTOR. Improve structure without changing behavior. Validation must remain green after this step.",
};

export async function runSinglePassWorker<TTask extends TaskRunnerTaskLike>(task: TTask, hooks: Pick<TaskRunnerHooks<TTask>, "buildTaskContext" | "spawnWorker">) {
  const prompt = await hooks.buildTaskContext(task);
  return await hooks.spawnWorker("worker", prompt, {
    promptAppendix: "Return a concise implementation report.",
    timeout: 1800,
  });
}

export async function runIterativeWorker<TTask extends TaskRunnerTaskLike>(task: TTask, hooks: Pick<TaskRunnerHooks<TTask>, "buildTaskContext" | "spawnWorker" | "defaultTurnBudget" | "maxTurnBudget" | "runValidation" | "markValidation" | "markHeartbeat" | "markTddProgress" | "appendIterationLog" | "nowIso">) {
  const budget = Math.min(task.turnBudget ?? hooks.defaultTurnBudget, hooks.maxTurnBudget);
  const validationCommand = normalizeValidationCommand(task.testCommand || task.acceptanceSignal);
  if (!validationCommand) {
    throw new Error("Iterative task requires testCommand or acceptanceSignal for orchestrator-level TDD enforcement");
  }

  let previousFeedback = "";
  let latestResult = "";
  task.tddPhase = task.tddPhase ?? "red";

  for (let turn = 0; turn < budget; turn++) {
    const prompt = [
      await hooks.buildTaskContext(task),
      `## Iteration\n${turn + 1}/${budget}`,
      `## TDD Phase\n${task.tddPhase}`,
      `## Phase Instructions\n${ITERATIVE_PHASE_INSTRUCTIONS[task.tddPhase as Exclude<TaskRunnerTddPhase, "complete">]}`,
      `## Validation Command\n${validationCommand}`,
      previousFeedback ? `## Previous Feedback\n${previousFeedback}` : "",
    ].filter(Boolean).join("\n\n");

    latestResult = await hooks.spawnWorker("workerIterative", prompt, {
      promptAppendix: `Return a concise iteration report. You are currently in TDD phase: ${task.tddPhase}.`,
      timeout: 1800,
    });
    task.iterationCount = turn + 1;
    task.result = latestResult;
    await hooks.markHeartbeat(task.id);
    await hooks.markTddProgress(task.id, task.tddPhase!, {
      iterationCount: task.iterationCount,
      redEstablishedAt: task.redEstablishedAt,
      greenAchievedAt: task.greenAchievedAt,
      refactorValidatedAt: task.refactorValidatedAt,
    });

    const validation = await hooks.runValidation(task);
    await hooks.markValidation(task.id, validation, task);
    await hooks.appendIterationLog(task.id, {
      time: hooks.nowIso(),
      turn: turn + 1,
      tddPhase: task.tddPhase,
      passed: validation.passed,
      coverage: validation.coverage,
      feedback: validation.output.slice(0, 12000),
    });

    if (task.tddPhase === "red") {
      if (!validation.passed) {
        task.redEstablishedAt = task.redEstablishedAt ?? hooks.nowIso();
        task.tddPhase = "green";
        await hooks.markTddProgress(task.id, task.tddPhase, {
          iterationCount: task.iterationCount,
          redEstablishedAt: task.redEstablishedAt,
          greenAchievedAt: task.greenAchievedAt,
          refactorValidatedAt: task.refactorValidatedAt,
        });
        previousFeedback = `RED established successfully. Validation is failing as expected. Move to GREEN.\n\n${validation.output.slice(0, 12000)}`;
        continue;
      }
      previousFeedback = `RED phase failed: validation already passed. The test/setup is too weak or trivial. Strengthen or correct the failing test before moving on.\n\n${validation.output.slice(0, 12000)}`;
      continue;
    }

    if (task.tddPhase === "green") {
      if (validation.passed) {
        task.greenAchievedAt = task.greenAchievedAt ?? hooks.nowIso();
        task.tddPhase = "refactor";
        await hooks.markTddProgress(task.id, task.tddPhase, {
          iterationCount: task.iterationCount,
          redEstablishedAt: task.redEstablishedAt,
          greenAchievedAt: task.greenAchievedAt,
          refactorValidatedAt: task.refactorValidatedAt,
        });
        previousFeedback = `GREEN achieved successfully. Now perform one refactor pass while keeping validation green.\n\n${validation.output.slice(0, 12000)}`;
        continue;
      }
      previousFeedback = `Still in GREEN: validation is not yet passing. Keep changes minimal and target the failing signal.\n\n${validation.output.slice(0, 12000)}`;
      continue;
    }

    if (task.tddPhase === "refactor") {
      if (validation.passed) {
        task.refactorValidatedAt = hooks.nowIso();
        task.tddPhase = "complete";
        await hooks.markTddProgress(task.id, task.tddPhase, {
          iterationCount: task.iterationCount,
          redEstablishedAt: task.redEstablishedAt,
          greenAchievedAt: task.greenAchievedAt,
          refactorValidatedAt: task.refactorValidatedAt,
        });
        return latestResult;
      }
      task.tddPhase = "green";
      await hooks.markTddProgress(task.id, task.tddPhase, {
        iterationCount: task.iterationCount,
        redEstablishedAt: task.redEstablishedAt,
        greenAchievedAt: task.greenAchievedAt,
        refactorValidatedAt: task.refactorValidatedAt,
      });
      previousFeedback = `REFACTOR broke green. Return to GREEN, restore passing behavior, then refactor again if budget remains.\n\n${validation.output.slice(0, 12000)}`;
      continue;
    }
  }

  throw new Error(`Iterative TDD budget exhausted before completing ${task.tddPhase ?? "unknown"} phase`);
}

export async function runTaskWorker<TTask extends TaskRunnerTaskLike>(task: TTask, hooks: Pick<TaskRunnerHooks<TTask>, "buildTaskContext" | "spawnWorker" | "defaultTurnBudget" | "maxTurnBudget" | "runValidation" | "markValidation" | "markHeartbeat" | "markTddProgress" | "appendIterationLog" | "nowIso">) {
  if (task.taskMode === "iterative") {
    return await runIterativeWorker(task, hooks);
  }
  return await runSinglePassWorker(task, hooks);
}

export async function executeManagedTask<TTask extends TaskRunnerTaskLike, TBlocker extends TaskExecutionBlockerLike = TaskExecutionBlockerLike, TTestSpec extends DiagnosticTestSpecLike = DiagnosticTestSpecLike>(
  task: TTask,
  hooks: TaskRunnerHooks<TTask, TBlocker, TTestSpec>
) {
  await hooks.beginExecution(task);

  try {
    const success = await executeTaskSuccessPath(task, {
      runWorker: async (task) => await runTaskWorker(task, hooks),
      markHeartbeat: hooks.markHeartbeat,
      runValidation: async (task) => await hooks.runValidation(task),
      markValidation: hooks.markValidation,
      runGateReview: async (task) => await hooks.runGateReview(task),
      markGateReview: hooks.markGateReview,
      onGateBlocked: hooks.onGateBlocked,
    });

    if (success.kind === "blocked") {
      return;
    }

    await hooks.completeExecution(task, success.gate);
    return;
  } catch (error: any) {
    await hooks.failExecutionAttempt(task, error);

    const runtimeFailureHooks = {
      markRuntime: hooks.runtimeFailureSync.markRuntime,
    };
    const terminalFailureHooks = {
      markRuntime: hooks.terminalFailureSync.markRuntime,
      markFailed: hooks.terminalFailureSync.markFailed,
      reconcile: hooks.reconcile,
      persist: hooks.persistState,
    };
    const retryFailureHooks = {
      markRuntime: hooks.retryFailureSync.markRuntime,
      requeue: hooks.retryFailureSync.requeue,
      reconcile: hooks.reconcile,
      persist: hooks.persistState,
    };

    const failureDecision = decideTaskFailure({
      task,
      maxRetries: hooks.maxRetries,
      environmentFailure: hooks.environmentFailure(task),
      normalizedFailureSignature: hooks.normalizeFailureSignature(task.error),
      canDiagnose: hooks.canDiagnose(task) && (task.diagnosticCount ?? 0) < 1,
    });

    if (failureDecision.applyFailureSignature) {
      await applyTaskFailureSignature(task, failureDecision.applyFailureSignature, runtimeFailureHooks);
    }

    if (failureDecision.kind === "block") {
      const blocker = hooks.createHumanInterventionBlocker(task, failureDecision.blocker.reason, failureDecision.blocker.suggestion);
      await hooks.pauseForHumanIntervention(task, blocker, failureDecision.persistEvent, failureDecision.persistDetails);
      return;
    }

    if (failureDecision.kind === "diagnose") {
      const diagnosis = await hooks.runDiagnosticReview(task);
      if (diagnosis) {
        const diagnosticDecision = decideTaskFailureDiagnosis(task.id, task.error, diagnosis);
        const blockerCategory = diagnosticDecision.kind === "block" ? blockerFromDiagnosticDecision(task.id, diagnosticDecision).category : undefined;
        const persistedDiagnostic = {
          ...diagnosis,
          blockerCategory,
        };

        await applyTaskDiagnostic(task, {
          classification: String(diagnosis.classification ?? "unknown"),
          notes: String(diagnosis.notes ?? ""),
          blockerCategory,
        }, runtimeFailureHooks);
        await hooks.saveDiagnostic(task.id, persistedDiagnostic);

        if (diagnosticDecision.kind === "rewrite_test_spec") {
          const rewritten = applyDiagnosticTestSpecRewrite(task, hooks.currentTestSpecs(), diagnosticDecision.rewrittenTestSpec as TTestSpec);
          await hooks.updateTestSpecs(rewritten.testSpecs);
          await hooks.persistTaskDefinitions();
          await hooks.markTestSpecWritten(rewritten.testSpecs, hooks.testSpecMarkdownFile?.());
          await syncTaskFailureRuntime(task, runtimeFailureHooks);
          await hooks.requeueTask(task.id, `diagnostic:${diagnosticDecision.classification}`);
          await hooks.reconcile();
          await hooks.persistState("task_requeued_from_diagnostic", { taskId: task.id, classification: diagnosticDecision.classification });
          return;
        }

        if (diagnosticDecision.kind === "block") {
          const blocker = blockerFromDiagnosticDecision(task.id, diagnosticDecision) as TBlocker;
          await hooks.pauseForHumanIntervention(task, blocker, "task_blocked_from_diagnostic", { classification: diagnosticDecision.classification });
          return;
        }
      }
    }

    if (failureDecision.kind === "fail" || failureDecision.kind === "diagnose") {
      await failTaskTerminally(task, terminalFailureHooks);
      return;
    }

    await retryTaskAfterFailure(task, failureDecision.retryReason, retryFailureHooks);
  }
}

