import type { Blocker, RunSnapshot, RunStatus, TaskRuntimeState } from "./types";
import type { ForgeEvent } from "./events";
import { initSnapshot } from "./events";

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
      return snapshot;
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
    case "test_spec_written":
      snapshot.testSpecFile = event.file;
      snapshot.testSpecMarkdownFile = event.markdownFile;
      snapshot.testSpecs = event.specs;
      return snapshot;
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
      task.blocker = event.blocker;
      delete snapshot.supervisors[event.taskId];
      snapshot.blockers = [...snapshot.blockers.filter((b) => b.taskId !== event.taskId), event.blocker];
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
    case "human_intervention_resolved":
      if (snapshot.pendingHumanIntervention?.taskId === event.taskId) {
        snapshot.pendingHumanIntervention = undefined;
      }
      snapshot.blockers = snapshot.blockers.map((blocker) =>
        blocker.taskId === event.taskId ? { ...blocker, resolvedAt: event.at, resolvedBy: event.resolution } : blocker,
      );
      return snapshot;
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

export function createHumanInterventionBlocker(taskId: string, reason: string, suggestion: string): Blocker {
  return {
    taskId,
    reason,
    suggestion,
    blockedTasks: [taskId],
  };
}
