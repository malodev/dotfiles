import type { Blocker, BlockerCategory, PlanningRuntimeState, RunSnapshot, RunStatus, TaskRuntimeState } from "./types.ts";
import type { ForgeEvent } from "./events.ts";
import { initSnapshot } from "./events.ts";
import { createBlocker, createRemediationRecord, normalizeBlocker } from "./blocker-model.ts";
import { selectBlockerResolutionMode } from "./blocker-resolution-mode.ts";
import { applyBlockerResolutionPatch, applyTestSpecResolutionPatch } from "./blocker-resolution.ts";

function ensureTaskState(snapshot: RunSnapshot, taskId: string): TaskRuntimeState {
  if (!snapshot.taskState[taskId]) {
    snapshot.taskState[taskId] = {
      taskId,
      status: "pending",
      retries: 0,
      runAttempt: 0,
    };
  }
  return snapshot.taskState[taskId];
}

function deriveStatus(snapshot: RunSnapshot): RunStatus {
  const states = Object.values(snapshot.taskState);
  const hasRunning = states.some((task) => task.status === "running");
  const hasReadyOrPending = states.some((task) => task.status === "ready" || task.status === "pending");
  const hasFailed = states.some((task) => task.status === "failed");
  const unresolvedBlockers = snapshot.blockers.filter((blocker) => !blocker.resolvedAt);
  const allDone = states.length > 0 && states.every((task) => ["completed", "skipped"].includes(task.status));

  if (snapshot.status === "aborted") return "aborted";
  if (snapshot.status === "completed") return "completed";
  if (snapshot.status === "paused") return "paused";
  if (snapshot.pendingHumanIntervention) return "needs_human_intervention";
  if (hasRunning) return "executing";
  if (snapshot.reviewFile) return "completed";
  if (snapshot.nextAction) return "awaiting_approval";
  if (allDone && snapshot.currentPhase >= 5) return "reviewing";
  if (unresolvedBlockers.length > 0) return "needs_human_intervention";
  if (hasReadyOrPending && snapshot.currentPhase >= 5) return "executing";
  if (snapshot.status === "failed" || hasFailed) return "failed";
  return "planning";
}

function clearPlanningRuntimeIfExecuting(snapshot: RunSnapshot): void {
  if (snapshot.currentPhase >= 5) {
    snapshot.planningRuntime = undefined;
  }
}

function ensurePlanningRuntime(snapshot: RunSnapshot, at: string, phase: PlanningRuntimeState["phase"]): PlanningRuntimeState {
  if (!snapshot.planningRuntime) {
    snapshot.planningRuntime = {
      activeRole: null,
      startedAt: at,
      phaseStartedAt: at,
      phase,
      interrupted: false,
    };
  }
  return snapshot.planningRuntime;
}

export function applyEvent(snapshot: RunSnapshot, event: ForgeEvent): RunSnapshot {
  snapshot.timestamps.lastUpdated = event.at;

  switch (event.type) {
    case "run_created":
      return initSnapshot(event.orchestrationId, event.prdFile, event.at);
    case "run_restored":
      return snapshot;
    case "phase_entered":
      snapshot.currentPhase = event.phase;
      snapshot.phaseLabel = event.label;
      clearPlanningRuntimeIfExecuting(snapshot);
      return snapshot;
    case "planning_phase_started": {
      const runtime = ensurePlanningRuntime(snapshot, event.at, event.phase);
      snapshot.phaseLabel = event.phaseLabel;
      runtime.activeRole = event.role;
      runtime.phase = event.phase;
      runtime.phaseStartedAt = event.at;
      runtime.interrupted = false;
      delete runtime.interruptedAt;
      return snapshot;
    }
    case "planning_phase_completed": {
      const runtime = ensurePlanningRuntime(snapshot, event.at, event.phase);
      runtime.activeRole = null;
      runtime.phase = event.phase;
      runtime.interrupted = false;
      delete runtime.interruptedAt;
      clearPlanningRuntimeIfExecuting(snapshot);
      return snapshot;
    }
    case "planning_phase_interrupted": {
      const runtime = ensurePlanningRuntime(snapshot, event.at, event.phase);
      runtime.activeRole = event.role;
      runtime.phase = event.phase;
      runtime.interrupted = true;
      runtime.interruptedAt = event.at;
      return snapshot;
    }
    case "routing_decided":
      snapshot.orchestrationMode = event.mode;
      snapshot.routingRationale = event.rationale;
      return snapshot;
    case "approval_required":
      snapshot.nextAction = event.nextAction;
      snapshot.phaseLabel = event.label;
      return snapshot;
    case "approval_granted":
      snapshot.nextAction = event.nextAction;
      return snapshot;
    case "run_paused":
      snapshot.status = "paused";
      snapshot.phaseLabel = event.label;
      snapshot.nextAction = event.nextAction;
      return snapshot;
    case "run_resumed":
      snapshot.status = "planning";
      snapshot.nextAction = undefined;
      return snapshot;
    case "requirements_written":
      snapshot.requirementsFile = event.file;
      return snapshot;
    case "plan_written":
      snapshot.planFile = event.planFile;
      snapshot.tasksFile = event.tasksFile;
      snapshot.tasksMarkdownFile = event.tasksMarkdownFile;
      snapshot.costFile = event.costFile;
      return snapshot;
    case "test_spec_written": {
      snapshot.testSpecFile = event.file;
      snapshot.testSpecMarkdownFile = event.markdownFile;

      const existingSpecs = snapshot.testSpecs ?? [];
      if (existingSpecs.length === 0) {
        snapshot.testSpecs = event.specs;
        return snapshot;
      }

      const merged = existingSpecs.map((entry) => event.specs.find((candidate) => candidate.taskId === entry.taskId) ?? entry);
      const additions = event.specs.filter((entry) => !existingSpecs.some((existing) => existing.taskId === entry.taskId));
      snapshot.testSpecs = [...merged, ...additions];
      return snapshot;
    }
    case "tasks_registered":
      snapshot.tasks = event.tasks;
      for (const task of event.tasks) ensureTaskState(snapshot, task.id);
      return snapshot;
    case "task_ready": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.status = "ready";
      return snapshot;
    }
    case "task_started": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.status = "running";
      task.startedAt = event.at;
      task.runAttempt = event.runAttempt;
      task.resolvedModel = event.model;
      task.lastHeartbeatAt = event.at;
      delete task.blocker;
      delete task.error;
      delete task.gateReview;
      delete task.stallWarnedAt;
      snapshot.supervisors[event.taskId] = {
        taskId: event.taskId,
        startedAt: event.at,
        lastHeartbeatAt: event.at,
        watchdogDeadlineAt: event.watchdogDeadlineAt ?? event.at,
        runAttempt: event.runAttempt,
        pidHint: event.pidHint,
      };
      return snapshot;
    }
    case "task_heartbeat": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.lastHeartbeatAt = event.at;
      if (snapshot.supervisors[event.taskId]) {
        snapshot.supervisors[event.taskId].lastHeartbeatAt = event.at;
        snapshot.supervisors[event.taskId].watchdogDeadlineAt = event.watchdogDeadlineAt ?? snapshot.supervisors[event.taskId].watchdogDeadlineAt;
      }
      return snapshot;
    }
    case "task_runtime_updated": {
      const task = ensureTaskState(snapshot, event.taskId);
      if (typeof event.retries === "number") task.retries = event.retries;
      if ("error" in event) {
        if (event.error == null) delete task.error;
        else task.error = event.error;
      }
      if ("failureSignature" in event) {
        if (event.failureSignature == null) delete task.failureSignature;
        else task.failureSignature = event.failureSignature;
      }
      if ("stallWarnedAt" in event) {
        if (event.stallWarnedAt == null) delete task.stallWarnedAt;
        else task.stallWarnedAt = event.stallWarnedAt;
      }
      if ("diagnostic" in event) {
        if (event.diagnostic == null) delete task.diagnostic;
        else task.diagnostic = event.diagnostic;
      }
      if ("diagnosticCount" in event) {
        if (event.diagnosticCount == null) delete task.diagnosticCount;
        else task.diagnosticCount = event.diagnosticCount;
      }
      return snapshot;
    }
    case "task_tdd_progress": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.tddPhase = event.phase;
      task.iterationCount = event.iterationCount ?? task.iterationCount;
      task.redEstablishedAt = event.redEstablishedAt ?? task.redEstablishedAt;
      task.greenAchievedAt = event.greenAchievedAt ?? task.greenAchievedAt;
      task.refactorValidatedAt = event.refactorValidatedAt ?? task.refactorValidatedAt;
      return snapshot;
    }
    case "task_validation_failed": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.error = event.error;
      task.validationOutput = event.output;
      task.validationFramework = event.framework;
      return snapshot;
    }
    case "task_validation_passed": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.validationOutput = event.output;
      task.validationFramework = event.framework;
      task.lastCoverage = event.coverage;
      return snapshot;
    }
    case "task_blocked": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.status = "blocked";
      task.blocker = normalizeBlocker(event.blocker);
      delete snapshot.supervisors[event.taskId];
      snapshot.blockers = [...snapshot.blockers.filter((b) => b.taskId !== event.taskId), task.blocker];
      return snapshot;
    }
    case "task_contract_patched": {
      const task = snapshot.tasks.find((entry) => entry.id === event.taskId);
      if (!task) {
        return snapshot;
      }

      const applied = applyBlockerResolutionPatch(event.taskId, task, snapshot.testSpecs, event.patch);
      snapshot.testSpecs = applied.testSpecs;

      const runtimeTask = snapshot.taskState[event.taskId];
      if (runtimeTask?.blocker?.remediation) {
        runtimeTask.blocker.remediation.durabilityCommitRef = event.durabilityCommitRef;
        runtimeTask.blocker.remediation.durabilityCommittedAt = event.at;
      }

      snapshot.blockers = snapshot.blockers.map((blocker) => {
        if (blocker.taskId !== event.taskId || !blocker.remediation) return blocker;
        return {
          ...blocker,
          remediation: {
            ...blocker.remediation,
            durabilityCommitRef: event.durabilityCommitRef,
            durabilityCommittedAt: event.at,
          },
        };
      });
      return snapshot;
    }
    case "test_spec_patched": {
      snapshot.testSpecs = applyTestSpecResolutionPatch(event.taskId, snapshot.testSpecs, event.patch);

      const runtimeTask = snapshot.taskState[event.taskId];
      if (runtimeTask?.blocker?.remediation) {
        runtimeTask.blocker.remediation.durabilityCommitRef = event.durabilityCommitRef;
        runtimeTask.blocker.remediation.durabilityCommittedAt = event.at;
      }

      snapshot.blockers = snapshot.blockers.map((blocker) => {
        if (blocker.taskId !== event.taskId || !blocker.remediation) return blocker;
        return {
          ...blocker,
          remediation: {
            ...blocker.remediation,
            durabilityCommitRef: event.durabilityCommitRef,
            durabilityCommittedAt: event.at,
          },
        };
      });
      return snapshot;
    }
    case "task_requeued": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.status = "pending";
      task.error = event.reason;
      if (event.resolutionInstruction) {
        task.resolutionInstruction = event.resolutionInstruction;
      }
      delete task.blocker;
      delete task.gateReview;
      delete task.stallWarnedAt;
      delete snapshot.supervisors[event.taskId];
      snapshot.blockers = snapshot.blockers.filter((b) => b.taskId !== event.taskId);
      return snapshot;
    }
    case "task_gate_reviewed": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.gateReview = { passed: event.passed, notes: event.notes };
      return snapshot;
    }
    case "task_completed": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.status = "completed";
      task.result = event.result;
      task.completedAt = event.at;
      delete task.error;
      delete task.blocker;
      delete task.failureSignature;
      delete task.stallWarnedAt;
      delete snapshot.supervisors[event.taskId];
      snapshot.blockers = snapshot.blockers.filter((b) => b.taskId !== event.taskId);
      return snapshot;
    }
    case "task_failed": {
      const task = ensureTaskState(snapshot, event.taskId);
      task.status = "failed";
      task.error = event.error;
      delete snapshot.supervisors[event.taskId];
      return snapshot;
    }
    case "human_intervention_requested":
      snapshot.pendingHumanIntervention = {
        taskId: event.taskId,
        reason: event.reason,
        suggestion: event.suggestion,
        requestedAt: event.at,
      };
      return snapshot;
    case "human_intervention_resolved": {
      if (snapshot.pendingHumanIntervention?.taskId === event.taskId) {
        snapshot.pendingHumanIntervention = undefined;
      }
      const task = snapshot.taskState[event.taskId];
      const blockedTask = task?.blocker;
      const resolvedMode = event.resolutionMode ?? selectBlockerResolutionMode({
        category: blockedTask?.category ?? snapshot.blockers.find((blocker) => blocker.taskId === event.taskId)?.category ?? "runtime",
        reason: blockedTask?.reason,
        suggestion: blockedTask?.suggestion,
        resolution: event.resolution,
        diagnosticClassification: task?.diagnostic?.classification,
        diagnosticNotes: task?.diagnostic?.notes,
        blockedTasks: blockedTask?.blockedTasks,
      });

      snapshot.blockers = snapshot.blockers.map((blocker) => {
        if (blocker.taskId !== event.taskId) return blocker;
        const category = blocker.category;
        return {
          ...blocker,
          resolvedAt: event.at,
          resolvedBy: event.resolution,
          remediation: blocker.remediation ?? createRemediationRecord({
            mode: resolvedMode,
            category,
            rationale: event.resolution,
          }),
        };
      });
      if (blockedTask) {
        task.blocker = normalizeBlocker({
          ...blockedTask,
          resolvedAt: event.at,
          resolvedBy: event.resolution,
          remediation: blockedTask.remediation ?? createRemediationRecord({
            mode: resolvedMode,
            category: blockedTask.category,
            rationale: event.resolution,
          }),
        });
        task.diagnostic = {
          classification: task.diagnostic?.classification ?? "human_intervention_resolution",
          notes: task.diagnostic?.notes ?? blockedTask.reason,
          blockerCategory: blockedTask.category,
          remediationMode: resolvedMode,
        };
      }
      return snapshot;
    }
    case "integration_review_started":
      snapshot.currentPhase = 6;
      snapshot.phaseLabel = "Integration Review";
      return snapshot;
    case "integration_review_completed":
      snapshot.reviewFile = event.reviewFile;
      snapshot.timestamps.completed = event.at;
      return snapshot;
    case "run_aborted":
      snapshot.status = "aborted";
      return snapshot;
    case "run_completed":
      snapshot.status = "completed";
      snapshot.timestamps.completed = event.at;
      return snapshot;
    case "run_failed":
      snapshot.status = "failed";
      return snapshot;
  }
}

export function replayEvents(events: ForgeEvent[]): RunSnapshot | null {
  let snapshot: RunSnapshot | null = null;
  for (const event of events) {
    if (event.type === "run_created") {
      snapshot = initSnapshot(event.orchestrationId, event.prdFile, event.at);
      continue;
    }
    if (!snapshot) continue;
    snapshot = applyEvent(snapshot, event);
  }
  if (!snapshot) return null;
  snapshot.status = deriveStatus(snapshot);
  return snapshot;
}

export function createHumanInterventionBlocker(taskId: string, reason: string, suggestion: string, category: BlockerCategory = "runtime"): Blocker {
  return createBlocker({
    taskId,
    reason,
    suggestion,
    blockedTasks: [taskId],
    category,
  });
}
