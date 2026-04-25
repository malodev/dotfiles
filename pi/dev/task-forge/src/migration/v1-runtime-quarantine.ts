/**
 * @deprecated V1 runtime authority helpers — QUARANTINED.
 * All functions in this module are frozen migration-only remnants.
 * Do not use for new runtime decisions.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { executionFacts as executionFactsV2 } from "../src/execution.ts";
import type { RunSnapshot as V2RunSnapshot, RunStatus as V2RunStatus } from "../src/types.ts";

type ForgeStatus =
  | "idle"
  | "analyzing"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "reviewing"
  | "completed"
  | "paused"
  | "aborted"
  | "blocked"
  | "failed";

type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

type TaskMode = "single-pass" | "iterative";
type TddPhase = "red" | "green" | "refactor" | "complete";

interface TaskValidationContract {
  mode: "command" | "manual";
  command?: string;
  notes?: string;
  coverageThreshold?: number;
}

interface CostEstimate {
  totalInputTokens?: number;
  totalOutputTokens?: number;
  iterativeBudgetTokens?: number;
  estimatedUsd?: number;
}

interface ContextManifest {
  artifacts?: string[];
  codebaseFiles?: string[];
  dependencyOutputs?: string[];
}

interface Blocker {
  taskId: string;
  reason: string;
  suggestion: string;
  blockedTasks: string[];
  resolvedBy?: string;
  resolvedAt?: string;
}

interface ForgeTask {
  id: string;
  title: string;
  description: string;
  complexity: "S" | "M" | "L";
  taskMode: TaskMode;
  contextManifest: ContextManifest;
  outputManifest: string[];
  dependencies: string[];
  acceptanceCriteria: string[];
  escalationTriggers: string[];
  measurableTargets?: Record<string, number | boolean | string>;
  turnBudget?: number;
  validation: TaskValidationContract;
  testCommand?: string;
  acceptanceSignal?: string;
  coverageThreshold?: number;
  testSpecRefs?: string[];
  status: TaskStatus;
  retries: number;
  resolvedModel?: string;
  result?: string;
  gateReview?: { passed: boolean; notes: string };
  blocker?: Blocker;
  error?: string;
  validationOutput?: string;
  validationFramework?: string;
  lastCoverage?: number;
  tddPhase?: TddPhase;
  redEstablishedAt?: string;
  greenAchievedAt?: string;
  refactorValidatedAt?: string;
  diagnostic?: { classification: string; notes: string };
  diagnosticCount?: number;
  startedAt?: string;
  completedAt?: string;
  iterationCount?: number;
  resolutionInstruction?: string;
  failureSignature?: string;
  stallWarnedAt?: string;
}

interface TestSpecEntry {
  taskId: string;
  testFiles?: Array<{
    path: string;
    type?: string;
    targets?: string[];
    fixtures_required?: string[];
    derived_from?: string[];
  }>;
  validation: TaskValidationContract;
  acceptance_signal?: string;
  coverage_threshold?: number;
  ambiguities?: string[];
}

interface ForgeState {
  orchestrationId: string;
  status: ForgeStatus;
  currentPhase: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  phaseLabel: string;
  orchestrationMode?: "micro" | "standard" | "complex";
  nextAction?: "continuePlanning" | "executePlan";
  routingRationale?: string;
  prdFile?: string;
  resolvedModels: Partial<Record<string, string>>;
  requirementsFile?: string;
  planFile?: string;
  tasksFile?: string;
  tasksMarkdownFile?: string;
  costFile?: string;
  testSpecFile?: string;
  testSpecMarkdownFile?: string;
  reviewFile?: string;
  cost: CostEstimate;
  blockers: Blocker[];
  tasks: ForgeTask[];
  testSpecs?: TestSpecEntry[];
  activeAgent?: {
    role: string;
    model: string;
    startedAt: string;
    attempt?: number;
    totalCandidates?: number;
  };
  timestamps: {
    started: string;
    lastUpdated: string;
    completed?: string;
  };
}

function statusIcon(status: ForgeStatus | V2RunStatus | "needs_human_intervention") {
  switch (status) {
    case "idle": return "💤";
    case "analyzing": return "🔍";
    case "planning": return "📋";
    case "awaiting_approval": return "⏳";
    case "executing": return "⚙️";
    case "reviewing": return "🧪";
    case "completed": return "✅";
    case "paused": return "⏸️";
    case "aborted": return "🛑";
    case "blocked": return "🚧";
    case "failed": return "❌";
    case "needs_human_intervention": return "⚠️";
  }
}

export function legacyStatusLabel(state: ForgeState | null) {
  if (!state) return "forge:idle";

  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.status === "completed").length;
  const running = state.tasks.filter((t) => t.status === "running").length;
  const blocked = state.tasks.filter((t) => t.status === "blocked").length;
  const failed = state.tasks.filter((t) => t.status === "failed").length;

  const parts: string[] = [];
  if (total > 0) parts.push(`${done}/${total}`);
  if (running > 0) parts.push(`r${running}`);
  if (blocked > 0) parts.push(`b${blocked}`);
  if (failed > 0) parts.push(`f${failed}`);

  if (state.status === "executing") {
    const iterativeRunning = state.tasks.filter(
      (t) => t.status === "running" && t.taskMode === "iterative" && t.tddPhase && t.tddPhase !== "complete",
    );
    const red = iterativeRunning.filter((t) => t.tddPhase === "red").length;
    const green = iterativeRunning.filter((t) => t.tddPhase === "green").length;
    const refactor = iterativeRunning.filter((t) => t.tddPhase === "refactor").length;
    if (red > 0) parts.push(`red${red}`);
    if (green > 0) parts.push(`green${green}`);
    if (refactor > 0) parts.push(`ref${refactor}`);
  }

  if (state.status === "awaiting_approval") {
    if (state.nextAction === "continuePlanning") parts.push("next:plan");
    if (state.nextAction === "executePlan") parts.push("next:exec");
  }

  const suffix = parts.length > 0 ? ` [${parts.join("|")}]` : "";
  return `forge:${statusIcon(state.status)}${state.status}${suffix}`;
}

export function legacyStatusMap(status: V2RunStatus): ForgeStatus {
  return status === "needs_human_intervention"
    ? "paused"
    : status === "idle"
      ? "idle"
      : status === "planning"
        ? "planning"
        : status === "awaiting_approval"
          ? "awaiting_approval"
          : status === "paused"
            ? "paused"
            : status === "executing"
              ? "executing"
              : status === "reviewing"
                ? "reviewing"
                : status === "completed"
                  ? "completed"
                  : status === "aborted"
                    ? "aborted"
                    : "failed";
}

export function buildLegacyStateView(snapshot: V2RunSnapshot): ForgeState {
  const blockers = snapshot.blockers.filter((b) => !b.resolvedAt);
  const tasks = snapshot.tasks.map((task) => {
    const runtime = snapshot.taskState[task.id];
    return {
      ...task,
      status: (runtime?.status ?? "pending") as TaskStatus,
      retries: runtime?.retries ?? 0,
      resolvedModel: runtime?.resolvedModel,
      result: runtime?.result,
      gateReview: runtime?.gateReview,
      blocker: runtime?.blocker,
      error: runtime?.error,
      validationOutput: runtime?.validationOutput,
      validationFramework: runtime?.validationFramework,
      lastCoverage: runtime?.lastCoverage,
      startedAt: runtime?.startedAt,
      completedAt: runtime?.completedAt,
      resolutionInstruction: runtime?.resolutionInstruction,
      diagnostic: runtime?.diagnostic,
      diagnosticCount: runtime?.diagnosticCount,
      failureSignature: runtime?.failureSignature,
      stallWarnedAt: runtime?.stallWarnedAt,
      tddPhase: runtime?.tddPhase,
      redEstablishedAt: runtime?.redEstablishedAt,
      greenAchievedAt: runtime?.greenAchievedAt,
      refactorValidatedAt: runtime?.refactorValidatedAt,
      iterationCount: runtime?.iterationCount,
    } as ForgeTask;
  });

  if (snapshot.pendingHumanIntervention && !blockers.some((b) => b.taskId === snapshot.pendingHumanIntervention?.taskId)) {
    blockers.push({
      taskId: snapshot.pendingHumanIntervention.taskId,
      reason: snapshot.pendingHumanIntervention.reason,
      suggestion: snapshot.pendingHumanIntervention.suggestion,
      blockedTasks: [snapshot.pendingHumanIntervention.taskId],
      category: "unknown",
    } as any);
  }

  return {
    orchestrationId: snapshot.orchestrationId,
    status: legacyStatusMap(snapshot.status),
    currentPhase: snapshot.currentPhase as ForgeState["currentPhase"],
    phaseLabel: snapshot.phaseLabel,
    orchestrationMode: snapshot.orchestrationMode,
    nextAction: snapshot.nextAction as ForgeState["nextAction"] | undefined,
    routingRationale: snapshot.routingRationale,
    prdFile: snapshot.prdFile,
    resolvedModels: snapshot.resolvedModels,
    requirementsFile: snapshot.requirementsFile,
    planFile: snapshot.planFile,
    tasksFile: snapshot.tasksFile,
    tasksMarkdownFile: snapshot.tasksMarkdownFile,
    costFile: snapshot.costFile,
    testSpecFile: snapshot.testSpecFile,
    testSpecMarkdownFile: snapshot.testSpecMarkdownFile,
    reviewFile: snapshot.reviewFile,
    cost: snapshot.cost,
    blockers,
    tasks,
    testSpecs: snapshot.testSpecs,
    timestamps: snapshot.timestamps,
  };
}

export function syncLegacyStateView(snapshot: V2RunSnapshot, currentState: ForgeState | null): ForgeState {
  const previousActiveAgent = currentState?.orchestrationId === snapshot.orchestrationId ? currentState.activeAgent : undefined;
  const newState = buildLegacyStateView(snapshot);
  if (previousActiveAgent && newState?.orchestrationId === snapshot.orchestrationId) {
    (newState as any).activeAgent = previousActiveAgent;
  }
  return newState;
}

export function deriveTaskList(snapshot: V2RunSnapshot | null, currentState: ForgeState | null): ForgeTask[] {
  if (!snapshot) return currentState?.tasks ?? [];
  if (currentState?.orchestrationId === snapshot.orchestrationId) return currentState.tasks;
  return buildLegacyStateView(snapshot).tasks;
}

export function buildExecutionFacts(snapshot: V2RunSnapshot | null, currentState: ForgeState | null) {
  const tasks = deriveTaskList(snapshot, currentState);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const facts = executionFactsV2(snapshot);
  return {
    tasks,
    ready: facts.readyTaskIds.map((taskId) => taskMap.get(taskId)).filter(Boolean) as ForgeTask[],
    running: facts.runningTaskIds.map((taskId) => taskMap.get(taskId)).filter(Boolean) as ForgeTask[],
    pending: facts.pendingTaskIds.map((taskId) => taskMap.get(taskId)).filter(Boolean) as ForgeTask[],
    blocked: facts.blockedTaskIds.map((taskId) => taskMap.get(taskId)).filter(Boolean) as ForgeTask[],
    failed: facts.failedTaskIds.map((taskId) => taskMap.get(taskId)).filter(Boolean) as ForgeTask[],
    unfinished: facts.unfinishedTaskIds.map((taskId) => taskMap.get(taskId)).filter(Boolean) as ForgeTask[],
  };
}

export function computeEffectiveStatus(authoritative: V2RunSnapshot | null, currentState: ForgeState | null) {
  return authoritative?.status ?? currentState?.status ?? "idle";
}

export async function attemptSessionRestore(ctx: any, outputPathFn: (...parts: string[]) => string, stateEntryType: string): Promise<ForgeState | null> {
  let restored: ForgeState | null = null;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && (entry as any).customType === stateEntryType) {
      restored = (entry as any).data as ForgeState;
    }
  }

  if (!restored) {
    const file = outputPathFn(ctx.cwd, "state.json");
    if (existsSync(file)) {
      try {
        restored = JSON.parse(await readFile(file, "utf-8")) as ForgeState;
      } catch {}
    }
  }

  return restored;
}
