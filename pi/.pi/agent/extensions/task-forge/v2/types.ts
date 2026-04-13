export type ModelTier = "reasoning" | "coding" | "bulk" | "endurance";
export type Role =
  | "scopeClassifier"
  | "strategist"
  | "planner"
  | "testDesigner"
  | "worker"
  | "workerIterative"
  | "gateReviewer"
  | "diagnosticReviewer"
  | "integrationReviewer";

export type RunStatus =
  | "idle"
  | "planning"
  | "awaiting_approval"
  | "paused"
  | "executing"
  | "needs_human_intervention"
  | "reviewing"
  | "completed"
  | "aborted"
  | "failed";

export type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export type TaskMode = "single-pass" | "iterative";
export type TddPhase = "red" | "green" | "refactor" | "complete";
export type RunPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type NextAction = "continuePlanning" | "executePlan";

export interface CostEstimate {
  totalInputTokens?: number;
  totalOutputTokens?: number;
  iterativeBudgetTokens?: number;
  estimatedUsd?: number;
}

export interface ContextManifest {
  artifacts?: string[];
  codebaseFiles?: string[];
  dependencyOutputs?: string[];
}

export interface Blocker {
  taskId: string;
  reason: string;
  suggestion: string;
  blockedTasks: string[];
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface ForgeTask {
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
  testCommand?: string;
  acceptanceSignal?: string;
  coverageThreshold?: number;
  testSpecRefs?: string[];
}

export interface TaskRuntimeState {
  taskId: string;
  status: TaskStatus;
  retries: number;
  runAttempt: number;
  resolvedModel?: string;
  result?: string;
  error?: string;
  blocker?: Blocker;
  gateReview?: { passed: boolean; notes: string };
  validationOutput?: string;
  validationFramework?: string;
  lastCoverage?: number;
  startedAt?: string;
  completedAt?: string;
  lastHeartbeatAt?: string;
  resolutionInstruction?: string;
  diagnostic?: { classification: string; notes: string };
  diagnosticCount?: number;
  failureSignature?: string;
  stallWarnedAt?: string;
  tddPhase?: TddPhase;
  redEstablishedAt?: string;
  greenAchievedAt?: string;
  refactorValidatedAt?: string;
  iterationCount?: number;
}

export interface TestSpecEntry {
  taskId: string;
  testFiles?: Array<{
    path: string;
    type?: string;
    targets?: string[];
    fixtures_required?: string[];
    derived_from?: string[];
  }>;
  acceptance_signal?: string;
  coverage_threshold?: number;
  ambiguities?: string[];
}

export interface TaskSupervisorState {
  taskId: string;
  startedAt: string;
  lastHeartbeatAt: string;
  watchdogDeadlineAt: string;
  runAttempt: number;
  pidHint?: number;
}

export interface RunSnapshot {
  schemaVersion: 2;
  orchestrationId: string;
  status: RunStatus;
  currentPhase: RunPhase;
  phaseLabel: string;
  nextAction?: NextAction;
  orchestrationMode?: "micro" | "standard" | "complex";
  routingRationale?: string;
  prdFile?: string;
  requirementsFile?: string;
  planFile?: string;
  tasksFile?: string;
  tasksMarkdownFile?: string;
  costFile?: string;
  testSpecFile?: string;
  testSpecMarkdownFile?: string;
  reviewFile?: string;
  resolvedModels: Partial<Record<Role, string>>;
  cost: CostEstimate;
  tasks: ForgeTask[];
  taskState: Record<string, TaskRuntimeState>;
  blockers: Blocker[];
  supervisors: Record<string, TaskSupervisorState>;
  testSpecs?: TestSpecEntry[];
  pendingHumanIntervention?: {
    taskId: string;
    reason: string;
    suggestion: string;
    requestedAt: string;
  };
  timestamps: {
    started: string;
    lastUpdated: string;
    completed?: string;
  };
}
