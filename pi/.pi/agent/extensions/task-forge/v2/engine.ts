import type { ForgeEvent } from "./events.ts";
import type {
  BlockerResolutionMode,
  ForgeTask,
  NextAction,
  Role,
  RunPhase,
  RunSnapshot,
  TestSpecEntry,
  TddPhase,
} from "./types.ts";
import { appendEvent, createLayout, deriveSnapshot, writeSnapshot } from "./storage.ts";
import { createHumanInterventionBlocker } from "./derive.ts";
import { classifyRuntimeFailure, preflightAcceptanceCommand } from "./preflight.ts";
import { selectBlockerResolutionMode } from "./blocker-resolution-mode.ts";
import { assertAllowlistedTaskContractPatch, deriveBlockerResolutionPatch } from "./blocker-resolution.ts";

function nowIso() {
  return new Date().toISOString();
}

function plusMs(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

export class TaskForgeV2Engine {
  private cwd: string;
  private outputDir: string;

  constructor(cwd: string, outputDir = ".task-forge") {
    this.cwd = cwd;
    this.outputDir = outputDir;
  }

  private layout() {
    return createLayout(this.cwd, this.outputDir);
  }

  async load() {
    return await deriveSnapshot(this.layout());
  }

  async append(event: ForgeEvent) {
    const layout = this.layout();
    await appendEvent(layout, event);
    const snapshot = await deriveSnapshot(layout);
    if (snapshot) {
      await writeSnapshot(layout, snapshot);
    }
    return snapshot;
  }

  async createRun(orchestrationId: string, prdFile: string) {
    return await this.append({
      type: "run_created",
      at: nowIso(),
      orchestrationId,
      prdFile,
    });
  }

  async markRunRestored(orchestrationId: string, reason: string) {
    return await this.append({
      type: "run_restored",
      at: nowIso(),
      orchestrationId,
      reason,
    });
  }

  async enterPhase(phase: RunPhase, label: string) {
    return await this.append({
      type: "phase_entered",
      at: nowIso(),
      phase,
      label,
    });
  }

  async markPlanningPhaseStarted(role: Role, phase: RunPhase, phaseLabel: string) {
    return await this.append({
      type: "planning_phase_started",
      at: nowIso(),
      role,
      phase,
      phaseLabel,
    });
  }

  async markPlanningPhaseCompleted(role: Role, phase: RunPhase) {
    return await this.append({
      type: "planning_phase_completed",
      at: nowIso(),
      role,
      phase,
    });
  }

  async markPlanningPhaseInterrupted(role: Role | null, phase: RunPhase) {
    return await this.append({
      type: "planning_phase_interrupted",
      at: nowIso(),
      role,
      phase,
    });
  }

  async markRouting(mode: "micro" | "standard" | "complex", rationale?: string) {
    return await this.append({
      type: "routing_decided",
      at: nowIso(),
      mode,
      rationale,
    });
  }

  async markRequirementsWritten(file: string) {
    return await this.append({
      type: "requirements_written",
      at: nowIso(),
      file,
    });
  }

  async markPlanWritten(planFile: string, tasksFile?: string, tasksMarkdownFile?: string, costFile?: string) {
    return await this.append({
      type: "plan_written",
      at: nowIso(),
      planFile,
      tasksFile,
      tasksMarkdownFile,
      costFile,
    });
  }

  async markTestSpecWritten(file: string, specs: TestSpecEntry[], markdownFile?: string) {
    return await this.append({
      type: "test_spec_written",
      at: nowIso(),
      file,
      markdownFile,
      specs: (specs ?? []) as any,
    });
  }

  async registerTasks(tasks: ForgeTask[]) {
    return await this.append({
      type: "tasks_registered",
      at: nowIso(),
      tasks,
    });
  }

  async requireApproval(nextAction: NextAction, label: string) {
    return await this.append({
      type: "approval_required",
      at: nowIso(),
      nextAction,
      label,
    });
  }

  async markApprovalGranted(nextAction?: NextAction) {
    return await this.append({
      type: "approval_granted",
      at: nowIso(),
      nextAction,
    });
  }

  async markRunPaused(label: string, nextAction: NextAction, reason?: string) {
    return await this.append({
      type: "run_paused",
      at: nowIso(),
      label,
      nextAction,
      reason,
    });
  }

  async markRunResumed(reason?: string) {
    return await this.append({
      type: "run_resumed",
      at: nowIso(),
      reason,
    });
  }

  private deriveInterventionResolutionMode(snapshot: RunSnapshot | null, taskId: string, resolution: string) {
    const runtime = snapshot?.taskState[taskId];
    const blocker = runtime?.blocker ?? snapshot?.blockers.find((entry: NonNullable<RunSnapshot["blockers"]>[number]) => entry.taskId === taskId);

    if (!blocker) {
      return undefined;
    }

    return selectBlockerResolutionMode({
      category: blocker.category,
      reason: blocker.reason,
      suggestion: blocker.suggestion,
      resolution,
      diagnosticClassification: runtime?.diagnostic?.classification,
      diagnosticNotes: runtime?.diagnostic?.notes,
      blockedTasks: blocker.blockedTasks,
    });
  }

  private async persistDurableResolutionPatch(
    taskId: string,
    resolution: string,
    eventType: "task_contract_patched" | "test_spec_patched",
  ) {
    const patch = deriveBlockerResolutionPatch(resolution);
    if (!patch) {
      return;
    }

    assertAllowlistedTaskContractPatch(patch);
    await this.append({
      type: eventType,
      at: nowIso(),
      taskId,
      patch,
      durabilityCommitRef: `${taskId}:${Date.now()}`,
    });
  }

  private async persistTaskContractPatch(taskId: string, resolution: string) {
    return await this.persistDurableResolutionPatch(taskId, resolution, "task_contract_patched");
  }

  private async persistTestSpecPatch(taskId: string, resolution: string) {
    return await this.persistDurableResolutionPatch(taskId, resolution, "test_spec_patched");
  }

  private deriveReplannedSpecs(resolution: string): TestSpecEntry[] {
    for (const match of resolution.matchAll(/```json\s*([\s\S]*?)```/gi)) {
      const payload = match[1]?.trim();
      if (!payload) continue;

      try {
        const parsed = JSON.parse(payload);
        const specs = parsed?.replan?.specs;
        if (!Array.isArray(specs)) continue;

        return specs.filter((entry) => entry && typeof entry === "object" && typeof entry.taskId === "string") as TestSpecEntry[];
      } catch {
        // ignore malformed JSON snippets and keep scanning
      }
    }

    return [];
  }

  private isReplanResolutionMode(mode: BlockerResolutionMode | undefined): mode is "replan_task" | "replan_subgraph" {
    return mode === "replan_task" || mode === "replan_subgraph";
  }

  private async persistReplannedSpecs(snapshot: RunSnapshot | null, resolution: string) {
    const replannedSpecs = this.deriveReplannedSpecs(resolution);
    if (replannedSpecs.length === 0) {
      return;
    }

    await this.markTestSpecWritten(
      snapshot?.testSpecFile ?? "test-specs.json",
      replannedSpecs,
      snapshot?.testSpecMarkdownFile,
    );
  }

  private async persistResolutionArtifacts(
    taskId: string,
    resolution: string,
    resolutionMode: BlockerResolutionMode | undefined,
    snapshot: RunSnapshot | null,
  ) {
    if (resolutionMode === "patch_task_contract") {
      await this.persistTaskContractPatch(taskId, resolution);
      return;
    }

    if (resolutionMode === "patch_test_spec") {
      await this.persistTestSpecPatch(taskId, resolution);
      return;
    }

    if (this.isReplanResolutionMode(resolutionMode)) {
      await this.persistReplannedSpecs(snapshot, resolution);
    }
  }

  async resolveHumanIntervention(taskId: string, resolution: string) {
    const snapshot = await this.load();
    const resolutionMode = this.deriveInterventionResolutionMode(snapshot, taskId, resolution);

    await this.append({
      type: "human_intervention_resolved",
      at: nowIso(),
      taskId,
      resolution,
      resolutionMode,
    });

    await this.persistResolutionArtifacts(taskId, resolution, resolutionMode, snapshot);

    await this.append({
      type: "task_requeued",
      at: nowIso(),
      taskId,
      reason: resolution,
      resolutionInstruction: resolution,
    });
    return await this.markApprovalRequired("executePlan", "Execution (resume ready)");
  }

  async markTaskReady(taskId: string) {
    return await this.append({
      type: "task_ready",
      at: nowIso(),
      taskId,
    });
  }

  async markTaskHeartbeat(taskId: string, watchdogMs?: number) {
    return await this.append({
      type: "task_heartbeat",
      at: nowIso(),
      taskId,
      watchdogDeadlineAt: watchdogMs ? plusMs(watchdogMs) : undefined,
    });
  }

  async markTaskRuntime(
    taskId: string,
    runtime: {
      retries?: number;
      error?: string | null;
      failureSignature?: string | null;
      stallWarnedAt?: string | null;
      diagnostic?: {
        classification: string;
        notes: string;
        blockerCategory?: import("./types.ts").BlockerCategory;
        remediationMode?: import("./types.ts").BlockerResolutionMode;
      } | null;
      diagnosticCount?: number | null;
    },
  ) {
    return await this.append({
      type: "task_runtime_updated",
      at: nowIso(),
      taskId,
      retries: runtime.retries,
      error: runtime.error,
      failureSignature: runtime.failureSignature,
      stallWarnedAt: runtime.stallWarnedAt,
      diagnostic: runtime.diagnostic,
      diagnosticCount: runtime.diagnosticCount,
    });
  }

  async markTaskTddProgress(
    taskId: string,
    phase: TddPhase,
    details?: {
      iterationCount?: number;
      redEstablishedAt?: string;
      greenAchievedAt?: string;
      refactorValidatedAt?: string;
    },
  ) {
    return await this.append({
      type: "task_tdd_progress",
      at: nowIso(),
      taskId,
      phase,
      iterationCount: details?.iterationCount,
      redEstablishedAt: details?.redEstablishedAt,
      greenAchievedAt: details?.greenAchievedAt,
      refactorValidatedAt: details?.refactorValidatedAt,
    });
  }

  async markTaskValidation(taskId: string, passed: boolean, output?: string, framework?: string, coverage?: number) {
    return await this.append(
      passed
        ? {
            type: "task_validation_passed",
            at: nowIso(),
            taskId,
            output,
            framework,
            coverage,
          }
        : {
            type: "task_validation_failed",
            at: nowIso(),
            taskId,
            error: output ?? "Validation failed",
            output,
            framework,
          },
    );
  }

  async markTaskBlocked(taskId: string, blocker: { reason: string; suggestion: string; blockedTasks: string[]; category?: import("./types.ts").BlockerCategory }) {
    return await this.append({
      type: "task_blocked",
      at: nowIso(),
      taskId,
      blocker: {
        taskId,
        category: blocker.category ?? "runtime",
        reason: blocker.reason,
        suggestion: blocker.suggestion,
        blockedTasks: blocker.blockedTasks,
      },
    });
  }

  async markTaskFailed(taskId: string, error: string) {
    return await this.append({
      type: "task_failed",
      at: nowIso(),
      taskId,
      error,
    });
  }

  async requeueTask(taskId: string, reason: string, resolutionInstruction?: string) {
    return await this.append({
      type: "task_requeued",
      at: nowIso(),
      taskId,
      reason,
      resolutionInstruction,
    });
  }

  async preflightTask(task: ForgeTask) {
    const acceptance = preflightAcceptanceCommand(task);
    if (!acceptance.ok) {
      const blocker = createHumanInterventionBlocker(task.id, acceptance.reason ?? "Preflight failed", acceptance.suggestion ?? "Review the task runtime assumptions.", "validation_contract");
      await this.append({
        type: "task_blocked",
        at: nowIso(),
        taskId: task.id,
        blocker,
      });
      await this.append({
        type: "human_intervention_requested",
        at: nowIso(),
        taskId: task.id,
        reason: blocker.reason,
        suggestion: `${blocker.suggestion}${acceptance.normalizedCommand ? `\nSuggested command: ${acceptance.normalizedCommand}` : ""}`,
      });
      return { ok: false as const, blocker };
    }

    return {
      ok: true as const,
      normalizedCommand: acceptance.normalizedCommand,
      message: acceptance.message,
    };
  }

  async absorbRuntimeFailure(taskId: string, output: string) {
    const classified = classifyRuntimeFailure(output);
    if (!classified) {
      return await this.append({
        type: "task_failed",
        at: nowIso(),
        taskId,
        error: output,
      });
    }

    const blocker = createHumanInterventionBlocker(taskId, classified.reason ?? "Runtime failure", classified.suggestion ?? "Review environment/runtime assumptions.", "environment");
    await this.append({
      type: "task_blocked",
      at: nowIso(),
      taskId,
      blocker,
    });
    return await this.append({
      type: "human_intervention_requested",
      at: nowIso(),
      taskId,
      reason: blocker.reason,
      suggestion: blocker.suggestion,
    });
  }

  async markTaskGateReview(taskId: string, passed: boolean, notes: string) {
    return await this.append({
      type: "task_gate_reviewed",
      at: nowIso(),
      taskId,
      passed,
      notes,
    });
  }

  async markTaskCompleted(taskId: string, result?: string) {
    return await this.append({
      type: "task_completed",
      at: nowIso(),
      taskId,
      result,
    });
  }

  async markTaskStarted(taskId: string, runAttempt: number, model?: string, pidHint?: number, watchdogMs?: number) {
    return await this.append({
      type: "task_started",
      at: nowIso(),
      taskId,
      runAttempt,
      model,
      pidHint,
      watchdogDeadlineAt: watchdogMs ? plusMs(watchdogMs) : undefined,
    });
  }

  async requestHumanIntervention(taskId: string, reason: string, suggestion: string) {
    return await this.append({
      type: "human_intervention_requested",
      at: nowIso(),
      taskId,
      reason,
      suggestion,
    });
  }

  async markExecutionPhaseStarted() {
    return await this.append({
      type: "phase_entered",
      at: nowIso(),
      phase: 5,
      label: "Execution",
    });
  }

  async markIntegrationReviewStarted() {
    await this.append({
      type: "phase_entered",
      at: nowIso(),
      phase: 6,
      label: "Integration Review",
    });
    return await this.append({
      type: "integration_review_started",
      at: nowIso(),
    });
  }

  async markApprovalRequired(nextAction: NextAction, label: string) {
    return await this.append({
      type: "approval_required",
      at: nowIso(),
      nextAction,
      label,
    });
  }

  async markRunAborted(reason: string) {
    return await this.append({
      type: "run_aborted",
      at: nowIso(),
      reason,
    });
  }

  async markRunFailed(reason: string) {
    return await this.append({
      type: "run_failed",
      at: nowIso(),
      reason,
    });
  }

  async markRunCompleted() {
    return await this.append({
      type: "run_completed",
      at: nowIso(),
    });
  }

  async markIntegrationReviewCompleted(reviewFile: string) {
    return await this.append({
      type: "integration_review_completed",
      at: nowIso(),
      reviewFile,
    });
  }

  async snapshot(): Promise<RunSnapshot | null> {
    return await this.load();
  }
}
