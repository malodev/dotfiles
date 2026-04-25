/**
 * TaskForge — hierarchical multi-agent orchestration for PRD-driven execution.
 *
 * Adopted from docs/history/PLAN-1.md:
 * - Strategist → Planner → Approval Gate → Execution → Integration Review
 * - Capability-tier model resolution with fallbacks
 * - Single-pass + iterative worker modes
 * - Gate review per task
 * - Blocker escalation and resume paths
 * - state.json + state.log artifacts for inspectability
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { Box, Text } from "@mariozechner/pi-tui";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appendEvent as appendV2Event, createLayout, deriveSnapshot as deriveV2Snapshot, loadSnapshot as loadV2Snapshot, readEvents as readV2Events, writeSnapshot as writeV2Snapshot } from "./src/storage";
import { migrateV1StateToEvents, migrateV1StateToSnapshot } from "./src/migrate";
import { TaskForgeV2Engine } from "./src/engine";
import { createTaskForgeBeginTaskExecutionHooks, createTaskForgeCompleteTaskExecutionHooks, createTaskForgeIntegrationReviewHooks, createTaskForgeRunnerAdvanceHooks, createTaskForgeTaskFailureHooks } from "./src/adapters";
import { executeApprovedPlanLoop, launchExecutionBatch } from "./src/command-adapter";
import { runPlanningFlow, continueComplexPlanning, classifyScope, analyzeRequirements, planDecomposition, designTests, runMicroPlan, type PlanningHooks } from "./src/commands/plan.ts";
import { runIntegrationReview } from "./src/review";
import { runTaskDiagnosticReview, needsDiagnosticReview } from "./src/diagnostic-review";
import { applyBlockerResolutionPatch, deriveBlockerResolutionPatch } from "./src/blocker-resolution";
import { runTaskGateReview } from "./src/gate-review";
import { beginTaskExecution, completeTaskExecution, failTaskExecutionAttempt } from "./src/task-executor";
import { executeManagedTask } from "./src/task-runner";
import { decideSupervisorActions } from "./src/supervisor";
import { materializeLegacyValidationFields, normalizeGeneratedValidationContract, normalizeValidationCommand, normalizeValidationContract, runTaskValidation } from "./src/validation";
import { computeSchedulingActions, dependenciesResolved as dependenciesResolvedV2, describeInterruptedExecution as describeInterruptedExecutionV2, executionFacts as executionFactsV2, failedDependencies as failedDependenciesV2, overdueSupervisors as overdueSupervisorsV2 } from "./src/execution";
import { describeInterruptedPlanning, determineResumptionPhase } from "./src/planning-recovery";
import { TaskForgeV2Runner } from "./src/runner";
import type { RunSnapshot as V2RunSnapshot, RunStatus as V2RunStatus } from "./src/types";
import { renderRootActionableBlockerStatus } from "./src/commands/status/render-root-blocker.ts";


// V2 command services — thin shell delegates to these for transition logic and event planning.
import { execute as executeCommandService } from "./src/commands/execute";
import { status as statusCommandService } from "./src/commands/status";
import { resume as resumeCommandService } from "./src/commands/resume";
import { listBlockers as listBlockersCommandService, resolveBlocker as resolveBlockerCommandService, retryTask as retryTaskCommandService, patchValidation as patchValidationCommandService } from "./src/commands/blocker";
import { pause as pauseCommandService } from "./src/commands/pause";
import { abort as abortCommandService } from "./src/commands/abort";
import { cost as costCommandService } from "./src/commands/cost";
import { models as modelsCommandService } from "./src/commands/models";
import { config as configCommandService } from "./src/commands/config";
import { help as helpCommandService } from "./src/commands/help";
import type { ForgeEvent } from "./src/events";
import type { CommandResult } from "./src/commands/contracts";

type ModelTier = "reasoning" | "coding" | "bulk" | "endurance";
type Role =
  | "scopeClassifier"
  | "strategist"
  | "planner"
  | "testDesigner"
  | "worker"
  | "workerIterative"
  | "gateReviewer"
  | "diagnosticReviewer"
  | "integrationReviewer";
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
type ValidationMode = "command" | "manual";

interface TaskValidationContract {
  mode: ValidationMode;
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

// ForgeState deleted — state is now dynamically typed, synced from V2 snapshot via loadAndSyncState()

interface TaskForgeConfig {
  modelTiers: Record<ModelTier, string[]>;
  roleAssignment: Record<Role, ModelTier>;
  modelOverrides: Partial<Record<Role, string>>;
  maxWorkers: number;
  maxRetries: number;
  defaultTurnBudget: number;
  maxTurnBudget: number;
  outputDir: string;
  autoExecute: boolean;
  contextBudgetPercent: number;
  costLimitUsd: number;
}

interface AgentDefinition {
  name: string;
  description?: string;
  tools: string;
  model?: string;
  systemPrompt: string;
}

const DEFAULT_CONFIG: TaskForgeConfig = {
  // Model tiers are intentionally empty — the real config lives in task-forge.json.
  // If no config file is found, loadConfig() will throw since there are no usable models.
  // This prevents silent fallback to stale or plan-incompatible model lists.
  modelTiers: {
    reasoning: [],
    coding: [],
    bulk: [],
    endurance: [],
  },
  roleAssignment: {
    scopeClassifier: "bulk",
    strategist: "reasoning",
    planner: "coding",
    testDesigner: "coding",
    worker: "bulk",
    workerIterative: "endurance",
    gateReviewer: "bulk",
    diagnosticReviewer: "coding",
    integrationReviewer: "coding",
  },
  modelOverrides: {},
  maxWorkers: 4,
  maxRetries: 2,
  defaultTurnBudget: 50,
  maxTurnBudget: 200,
  outputDir: ".task-forge",
  autoExecute: false,
  contextBudgetPercent: 70,
  costLimitUsd: 10,
};

const STATE_ENTRY_TYPE = "task-forge-state";
const TASK_STALL_WARNING_MS = seconds(20 * 60);

export function coercePlannerTask(raw: any, index: number): ForgeTask {
  const taskMode: TaskMode = raw.task_mode === "iterative" ? "iterative" : "single-pass";
  const complexity = raw.complexity === "L" || raw.complexity === "S" ? raw.complexity : "M";
  const { validation } = normalizeGeneratedValidationContract({
    source: "planner",
    validation: raw.validation,
    testCommand: raw.test_command,
    acceptanceSignal: raw.acceptance_signal,
    coverageThreshold: raw.coverage_threshold,
  });
  const legacyValidation = materializeLegacyValidationFields(validation);

  return {
    id: raw.id || `TASK-${String(index + 1).padStart(3, "0")}`,
    title: raw.title || `Task ${index + 1}`,
    description: raw.description || "",
    complexity,
    taskMode,
    contextManifest: {
      artifacts: raw.context_manifest?.artifacts ?? ["01-requirements.md", "02-plan.md"],
      codebaseFiles: raw.context_manifest?.codebase_files ?? [],
      dependencyOutputs: raw.context_manifest?.dependency_outputs ?? [],
    },
    outputManifest: raw.output_manifest ?? [],
    dependencies: raw.dependencies ?? [],
    acceptanceCriteria: raw.acceptance_criteria ?? [],
    escalationTriggers: raw.escalation_triggers ?? [],
    measurableTargets: raw.measurable_targets,
    turnBudget: Math.min(Math.max(Number(raw.turn_budget ?? DEFAULT_CONFIG.defaultTurnBudget), 1), DEFAULT_CONFIG.maxTurnBudget),
    validation,
    testCommand: legacyValidation.testCommand,
    acceptanceSignal: legacyValidation.acceptanceSignal,
    coverageThreshold: legacyValidation.coverageThreshold,
    testSpecRefs: raw.test_spec_refs ?? [],
    status: "pending",
    retries: 0,
  };
}

export function coerceTestDesignerSpec(raw: any): TestSpecEntry {
  const { validation } = normalizeGeneratedValidationContract({
    source: "test-designer",
    validation: raw.validation,
    acceptanceSignal: raw.acceptance_signal,
    coverageThreshold: raw.coverage_threshold,
  });
  const legacyValidation = materializeLegacyValidationFields(validation);

  return {
    taskId: String(raw.taskId ?? ""),
    testFiles: Array.isArray(raw.testFiles) ? raw.testFiles : [],
    validation,
    acceptance_signal: legacyValidation.acceptanceSignal,
    coverage_threshold: legacyValidation.coverageThreshold,
    ambiguities: Array.isArray(raw.ambiguities) ? raw.ambiguities : [],
  };
}
const TASK_STALL_ESCALATION_MS = TASK_STALL_WARNING_MS;
const TASK_SUPERVISOR_SWEEP_MS = Math.min(TASK_STALL_WARNING_MS, seconds(60));
const SUBCOMMANDS = [
  "execute",
  "status",
  "blocker",
  "pause",
  "resume",
  "abort",
  "cost",
  "models",
  "config",
  "help",
] as const;

function nowIso() {
  return new Date().toISOString();
}

function genId() {
  return `forge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function seconds(value: number) {
  return value * 1000;
}

function statusIcon(status: V2RunStatus | "needs_human_intervention") {
  switch (status) {
    case "idle": return "💤";
    case "planning": return "📋";
    case "awaiting_approval": return "⏳";
    case "executing": return "⚙️";
    case "reviewing": return "🧪";
    case "completed": return "✅";
    case "paused": return "⏸️";
    case "aborted": return "🛑";
    case "failed": return "❌";
    case "needs_human_intervention": return "⚠️";
  }
}

function renderStatusFromSnapshot(snapshot: V2RunSnapshot | null) {
  if (!snapshot) return "forge:idle";

  const taskState = Object.values(snapshot.taskState);
  const total = snapshot.tasks.length || taskState.length;
  const done = taskState.filter((t) => t.status === "completed").length;
  const running = taskState.filter((t) => t.status === "running").length;
  const blocked = taskState.filter((t) => t.status === "blocked").length;
  const failed = taskState.filter((t) => t.status === "failed").length;
  const overdue = overdueSupervisorsV2(snapshot).length;

  const parts: string[] = [];
  if (total > 0) parts.push(`${done}/${total}`);
  if (running > 0) parts.push(`r${running}`);
  if (blocked > 0) parts.push(`b${blocked}`);
  if (failed > 0) parts.push(`f${failed}`);
  if (overdue > 0) parts.push(`ov${overdue}`);
  if (snapshot.status === "executing") {
    const iterativeRunning = taskState.filter(
      (t) => t.status === "running" && t.tddPhase && t.tddPhase !== "complete",
    );
    const red = iterativeRunning.filter((t) => t.tddPhase === "red").length;
    const green = iterativeRunning.filter((t) => t.tddPhase === "green").length;
    const refactor = iterativeRunning.filter((t) => t.tddPhase === "refactor").length;
    if (red > 0) parts.push(`red${red}`);
    if (green > 0) parts.push(`green${green}`);
    if (refactor > 0) parts.push(`ref${refactor}`);
  }
  if (snapshot.status === "awaiting_approval" || snapshot.status === "paused") {
    if (snapshot.nextAction === "continuePlanning") parts.push("next:plan");
    if (snapshot.nextAction === "executePlan") parts.push("next:exec");
  }

  const suffix = parts.length > 0 ? ` [${parts.join("|")}]` : "";

  // Handle interrupted planning display (FR-18)
  if (snapshot.status === "planning" && snapshot.planningRuntime?.interrupted === true) {
    const phaseDisplay = `phase ${snapshot.currentPhase}/5`;
    const resumableIndicator = snapshot.nextAction === "continuePlanning" ? " — resumable" : "";
    const statusDisplay = `planning (interrupted — ${phaseDisplay}${resumableIndicator})`;
    return `forge:${statusIcon(snapshot.status)}${statusDisplay}${suffix}`;
  }

  return `forge:${statusIcon(snapshot.status)}${snapshot.status}${suffix}`;
}

function planningPhaseChecklist(snapshot: V2RunSnapshot) {
  const complex = snapshot.orchestrationMode === "complex";
  const micro = snapshot.orchestrationMode === "micro";
  const steps = complex
    ? [
        { phase: 0, label: "Scope Classification" },
        { phase: 1, label: "PRD Analysis" },
        { phase: 2, label: "Planning & Decomposition" },
        { phase: 3, label: "Test Design" },
        { phase: 4, label: "Approval Gate" },
      ]
    : micro
      ? [
          { phase: 0, label: "Scope Classification" },
          { phase: 2, label: "Micro Planning" },
          { phase: 4, label: "Approval Gate" },
        ]
      : [
          { phase: 0, label: "Scope Classification" },
          { phase: 1, label: "PRD Analysis" },
          { phase: 2, label: "Planning & Decomposition" },
          { phase: 3, label: "Test Design" },
          { phase: 4, label: "Approval Gate" },
        ];

  const currentIndex = Math.max(0, steps.findIndex((step) => step.phase === snapshot.currentPhase));
  const total = steps.length;
  const done = steps.filter((step, index) => index < currentIndex).length;
  const currentStep = steps[currentIndex] ?? steps[steps.length - 1];

  const checklist = steps.map((step, index) => {
    const marker = index < currentIndex ? "✅" : index === currentIndex ? "⏳" : "⏸";
    return `${marker} ${step.label}`;
  });

  return {
    summary: `planning progress: ${Math.min(done + 1, total)}/${total} — ${currentStep?.label ?? snapshot.phaseLabel}`,
    checklist,
  };
}

function statusSummaryFromV2(snapshot: V2RunSnapshot | null) {
  if (!snapshot) return "[task-forge] No active orchestration";

  const taskState = Object.values(snapshot.taskState);
  const overdue = overdueSupervisorsV2(snapshot);
  const counts = {
    ready: taskState.filter((t) => t.status === "ready").length,
    running: taskState.filter((t) => t.status === "running").length,
    completed: taskState.filter((t) => t.status === "completed").length,
    pending: taskState.filter((t) => t.status === "pending").length,
    failed: taskState.filter((t) => t.status === "failed").length,
    blocked: taskState.filter((t) => t.status === "blocked").length,
  };
  const planningProgress = ["planning", "awaiting_approval"].includes(snapshot.status)
    ? planningPhaseChecklist(snapshot)
    : null;

  // Build interruption section when planning was interrupted (FR-19, FR-20, FR-21)
  const interruptionSection: string[] = [];
  if (snapshot.planningRuntime?.interrupted === true) {
    const isResumable = snapshot.nextAction === "continuePlanning";
    const phaseForResume = snapshot.phaseLabel?.trim().length ? snapshot.phaseLabel : `phase ${snapshot.currentPhase}`;

    if (isResumable) {
      interruptionSection.push("⚠ planning interrupted after restart");
      interruptionSection.push(`next action: continuePlanning — /forge execute to resume from ${phaseForResume}`);
    } else {
      interruptionSection.push("⚠ restart required — rerun /forge <prd> to restart planning");
    }
  }

  return [
    `[task-forge] ${statusIcon(snapshot.status)} ${snapshot.status}`,
    `mode: ${snapshot.orchestrationMode ?? "n/a"}`,
    `phase: ${snapshot.phaseLabel}`,
    planningProgress?.summary ?? "",
    planningProgress ? ["planning phases:", ...planningProgress.checklist].join("\n") : "",
    ...interruptionSection,
    snapshot.nextAction ? `next action: ${snapshot.nextAction}` : "",
    `prd: ${snapshot.prdFile ?? "n/a"}`,
    `tasks: ${counts.completed}/${snapshot.tasks.length || taskState.length} completed, ${counts.running} running, ${counts.ready} ready, ${counts.pending} pending, ${counts.failed} failed, ${counts.blocked} blocked`,
    overdue.length > 0 ? `overdue supervisors: ${overdue.map((s) => s.taskId).join(", ")}` : "overdue supervisors: none",
    renderRootActionableBlockerStatus(snapshot),
  ].filter(Boolean).join("\n");
}

async function ensureV2BootstrappedFromCurrentState(cwd: string, outputDir: string) {
  const layout = createLayout(cwd, outputDir);
  const existingEvents = await readV2Events(layout);
  if (existingEvents.length > 0) return;
  if (!existsSync(layout.snapshotFile)) return;

  try {
    const raw = JSON.parse(await readFile(layout.snapshotFile, "utf-8"));
    if (raw?.schemaVersion === 2 || raw?.schemaVersion === 3 || raw?.schemaVersion === 4) return;
    const events = migrateV1StateToEvents(raw as any);
    for (const event of events) {
      await appendV2Event(layout, event);
    }
    const derived = await deriveV2Snapshot(layout);
    if (derived) {
      await writeV2Snapshot(layout, derived);
    }
  } catch {
    // Ignore bootstrap failures; caller will fall back to v1 state.
  }
}

async function loadAuthoritativeSnapshot(cwd: string, outputDir: string): Promise<V2RunSnapshot | null> {
  const layout = createLayout(cwd, outputDir);

  const derived = await deriveV2Snapshot(layout);
  if (derived) return derived;

  const storedV2 = await loadV2Snapshot(layout);
  if (storedV2?.schemaVersion === 2 || storedV2?.schemaVersion === 3 || storedV2?.schemaVersion === 4) return storedV2;

  if (!existsSync(layout.snapshotFile)) return null;
  try {
    const raw = JSON.parse(await readFile(layout.snapshotFile, "utf-8"));
    if (raw?.schemaVersion === 2 || raw?.schemaVersion === 3 || raw?.schemaVersion === 4) {
      return raw as V2RunSnapshot;
    }
    return migrateV1StateToSnapshot(raw as any);
  } catch {
    return null;
  }
}

function modelRefParts(ref: string) {
  const [provider, ...rest] = ref.split("/");
  return { provider, id: rest.join("/") };
}

function deepMergeConfig(base: TaskForgeConfig, loaded: Partial<TaskForgeConfig>): TaskForgeConfig {
  return {
    ...base,
    ...loaded,
    modelTiers: { ...base.modelTiers, ...(loaded.modelTiers ?? {}) },
    roleAssignment: { ...base.roleAssignment, ...(loaded.roleAssignment ?? {}) },
    modelOverrides: { ...base.modelOverrides, ...(loaded.modelOverrides ?? {}) },
  };
}

function extractBalancedJsonCandidate(text: string): string | null {
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((index) => index >= 0).sort((a, b) => a - b);
  if (starts.length === 0) return null;

  const start = starts[0];
  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const ch = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === opener) depth += 1;
    if (ch === closer) depth -= 1;
    if (depth === 0) {
      return text.slice(start, index + 1);
    }
  }

  return null;
}

function extractJson(text: string): any | null {
  // Strategy 1: Find fenced block, but use balanced-brace extraction from inside it
  // (non-greedy regex breaks when planMarkdown contains code fences)
  const fenceStart = text.match(/```json\s*\n/i);
  if (fenceStart?.index != null) {
    const afterFence = text.slice(fenceStart.index + fenceStart[0].length);
    const balanced = extractBalancedJsonCandidate(afterFence);
    if (balanced) {
      try {
        return JSON.parse(balanced);
      } catch {}
      try {
        return JSON.parse(balanced.replace(/,\s*([}\]])/g, "$1"));
      } catch {}
    }
  }

  // Strategy 2: Balanced extraction from full text
  const balanced = extractBalancedJsonCandidate(text);
  if (balanced) {
    try {
      return JSON.parse(balanced);
    } catch {}
    try {
      return JSON.parse(balanced.replace(/,\s*([}\]])/g, "$1"));
    } catch {}
  }

  // Strategy 3: Try raw text
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  try {
    return JSON.parse(trimmed.replace(/,\s*([}\]])/g, "$1"));
  } catch {}

  return null;
}

function tasksToMarkdown(tasks: ForgeTask[]): string {
  return [
    "# Tasks",
    "",
    ...tasks.flatMap((task) => [
      `## ${task.id} — ${task.title}`,
      "",
      `- Mode: ${task.taskMode}`,
      `- Complexity: ${task.complexity}`,
      `- Dependencies: ${task.dependencies.length > 0 ? task.dependencies.join(", ") : "None"}`,
      `- Output: ${task.outputManifest.length > 0 ? task.outputManifest.join(", ") : "None specified"}`,
      "",
      task.description,
      "",
      "### Acceptance Criteria",
      ...task.acceptanceCriteria.map((c) => `- ${c}`),
      "",
    ]),
  ].join("\n");
}

function formatCost(cost: CostEstimate) {
  const usd = cost.estimatedUsd !== undefined ? `$${cost.estimatedUsd.toFixed(2)}` : "n/a";
  return [
    `estimated usd: ${usd}`,
    `input tokens: ${cost.totalInputTokens ?? "n/a"}`,
    `output tokens: ${cost.totalOutputTokens ?? "n/a"}`,
    `iterative budget tokens: ${cost.iterativeBudgetTokens ?? "n/a"}`,
  ].join("\n");
}

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

async function atomicWrite(path: string, content: string) {
  await ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, path);
}

export default function (pi: ExtensionAPI) {
  // ── Message renderers ──────────────────────────────────────────────────

  pi.registerMessageRenderer("task-forge-human-help", (message, _options, theme) => {
    const level = (message.details as any)?.level ?? "warning";
    const color = level === "error" ? "error" : level === "warning" ? "warning" : "accent";
    const icon = level === "error" ? "⛔" : level === "warning" ? "⚠️" : "ℹ️";
    const lines = String(message.content).split("\n");
    const rendered = [
      theme.fg(color, `${icon} ${lines[0]?.replace(/^\[task-forge\]\s*/, "") ?? "Human intervention required"}`),
      ...lines.slice(1).map((line: string) => {
        if (line.startsWith("  Acceptance:")) return theme.fg("accent", line);
        return theme.fg("normal", `  ${line}`);
      }),
    ].join("\n");
    return new Text(rendered, 0, 0);
  });

  pi.registerMessageRenderer("task-forge-approval-ready", (message, _options, theme) => {
    const lines = String(message.content).split("\n");
    const rendered = [
      theme.fg("success", `✅ ${lines[0]?.replace(/^\[task-forge\]\s*/, "") ?? "Approval ready"}`),
      ...lines.slice(1).map((line: string) => theme.fg("normal", `  ${line}`)),
    ].join("\n");
    return new Text(rendered, 0, 0);
  });

  pi.registerMessageRenderer("task-forge-status", (message, _options, theme) => {
    const lines = String(message.content).split("\n");
    const rendered = lines.map((line: string) => {
      if (line.startsWith("[task-forge]")) return theme.fg("accent", line);
      if (line.startsWith("  ")) return theme.fg("normal", line);
      return line;
    }).join("\n");
    return new Text(rendered, 0, 0);
  });

  pi.registerMessageRenderer("task-forge-help", (message, _options, theme) => {
    const lines = String(message.content).split("\n");
    const rendered = lines.map((line: string) => {
      if (line.startsWith("  /")) return theme.fg("accent", line);
      return theme.fg("normal", line);
    }).join("\n");
    return new Text(rendered, 0, 0);
  });

  pi.registerMessageRenderer("task-forge-cost", (message, _options, theme) => {
    return new Text(theme.fg("normal", String(message.content)), 0, 0);
  });

  pi.registerMessageRenderer("task-forge-models", (message, _options, theme) => {
    const lines = String(message.content).split("\n");
    const rendered = lines.map((line: string) => {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        return theme.fg("accent", line.slice(0, colonIdx + 1)) + theme.fg("normal", line.slice(colonIdx + 1));
      }
      return theme.fg("normal", line);
    }).join("\n");
    return new Text(rendered, 0, 0);
  });

  pi.registerMessageRenderer("task-forge-config", (message, _options, theme) => {
    return new Text(theme.fg("normal", String(message.content)), 0, 0);
  });

  // ── State & config ────────────────────────────────────────────────────
  let config: TaskForgeConfig = { ...DEFAULT_CONFIG };
  // State is synced from V2 snapshot via loadAndSyncState().
  // All reads go through V2; writes should emit V2 events.
  let state: any = null;
  let runAbortController: AbortController | null = null;
  let activeAgent: { role: string; model: string; startedAt: string; attempt?: number; totalCandidates?: number } | undefined;
  let resolvedModels: Record<string, string> = {};

  // ── V2 Sync ─────────────────────────────────────────────────────
  async function loadAndSyncState(ctx: any) {
    const snapshot = await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
    if (!snapshot) { state = null; return; }
    state = {
      orchestrationId: snapshot.orchestrationId,
      status: snapshot.status === "needs_human_intervention" ? "paused" : snapshot.status as any,
      currentPhase: snapshot.currentPhase,
      phaseLabel: snapshot.phaseLabel,
      orchestrationMode: snapshot.orchestrationMode,
      nextAction: snapshot.nextAction as any,
      prdFile: snapshot.prdFile,
      resolvedModels: resolvedModels ?? snapshot.resolvedModels ?? {},
      activeAgent,
      requirementsFile: snapshot.requirementsFile,
      planFile: snapshot.planFile,
      tasksFile: snapshot.tasksFile,
      tasksMarkdownFile: snapshot.tasksMarkdownFile,
      costFile: snapshot.costFile,
      testSpecFile: snapshot.testSpecFile,
      testSpecMarkdownFile: snapshot.testSpecMarkdownFile,
      reviewFile: snapshot.reviewFile,
      routingRationale: snapshot.routingRationale,
      cost: snapshot.cost,
      tasks: snapshot.tasks.map(t => ({
        ...t,
        status: snapshot.taskState[t.id]?.status ?? (t as any).status ?? "pending",
      } as any)),
      testSpecs: snapshot.testSpecs ?? [],
      blockers: snapshot.blockers.filter(b => !(b as any).resolvedAt),
      timestamps: snapshot.timestamps || { started: "", lastUpdated: "" },
    };
  }

  let executionPromise: Promise<void> | null = null;
  let planningPromise: Promise<void> | null = null;
  const agentCache = new Map<Role, AgentDefinition>();

  async function withV2Engine<T>(ctx: any, fn: (engine: TaskForgeV2Engine) => Promise<T>) {
    try {
      await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
      const engine = new TaskForgeV2Engine(ctx.cwd, config.outputDir);
      return await fn(engine);
    } catch {
      return undefined as T;
    }
  }

  async function reconcileFromAuthoritative(ctx: any) {
    const authoritative = await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
    if (authoritative) {
      ctx.ui.setStatus("task-forge", renderStatusFromSnapshot(authoritative));
    } else {
      ctx.ui.setStatus("task-forge", "forge:idle");
    }
    return authoritative;
  }

  async function loadCommandSnapshot(ctx: any) {
    config = await loadConfig(ctx.cwd);
    await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
    const authoritative = await reconcileFromAuthoritative(ctx);
    return await sweepOverdueSupervisors(ctx, authoritative);
  }

  /** Append command-result events and re-derive the snapshot (delegate→append→derive). */
  async function applyCommandEvents(ctx: any, result: CommandResult<any>): Promise<V2RunSnapshot | null> {
    if (!result.events.length) return result.snapshot ?? null;
    const layout = createLayout(ctx.cwd, config.outputDir);
    for (const event of result.events) {
      await appendV2Event(layout, event);
    }
    return await deriveV2Snapshot(layout);
  }

function isTerminalCommandStatus(status: V2RunStatus | "needs_human_intervention") {
    return ["idle", "completed", "aborted", "failed"].includes(status);
  }

  async function syncExecutionSnapshot(ctx: any) {
    const authoritative = await sweepOverdueSupervisors(ctx, await reconcileFromAuthoritative(ctx));
    return {
      authoritative,
      effectiveStatus: authoritative?.status ?? "idle",
    };
  }

  async function withV2Runner<T>(ctx: any, fn: (runner: TaskForgeV2Runner) => Promise<T>) {
    try {
      await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
      const runner = new TaskForgeV2Runner(ctx.cwd, config.outputDir);
      return await fn(runner);
    } catch {
      return undefined as T;
    }
  }

  function ensureRunAbortController() {
    if (!runAbortController || runAbortController.signal.aborted) {
      runAbortController = new AbortController();
    }
    return runAbortController;
  }
  const roleFiles: Record<Role, string> = {
    scopeClassifier: "scope-classifier.md",
    strategist: "strategist.md",
    planner: "planner.md",
    testDesigner: "test-designer.md",
    worker: "worker.md",
    workerIterative: "worker-iterative.md",
    gateReviewer: "gate-reviewer.md",
    diagnosticReviewer: "diagnostic-reviewer.md",
    integrationReviewer: "integration-reviewer.md",
  };

  function outputPath(cwd: string, ...parts: string[]) {
    return resolve(cwd, config.outputDir, ...parts);
  }

  async function findConfigPath(cwd: string): Promise<string | undefined> {
    const direct = resolve(cwd, ".pi", "task-forge.json");
    if (existsSync(direct)) return direct;

    const ignored = new Set([".git", "node_modules", ".task-forge"]);

    async function searchSubdirs(dir: string, depth: number): Promise<string | undefined> {
      if (depth < 0) return undefined;

      let entries: any[] = [];
      try {
        entries = await readdir(dir, { withFileTypes: true } as any);
      } catch {
        return undefined;
      }

      const piCandidate = resolve(dir, ".pi", "task-forge.json");
      if (existsSync(piCandidate)) return piCandidate;
      if (depth === 0) return undefined;

      for (const entry of entries) {
        if (!entry.isDirectory?.()) continue;
        if (entry.name === ".pi") continue;
        if (ignored.has(entry.name)) continue;
        const found = await searchSubdirs(resolve(dir, entry.name), depth - 1);
        if (found) return found;
      }

      return undefined;
    }

    const subtree = await searchSubdirs(cwd, 4);
    if (subtree) return subtree;

    const globalExtensionConfig = resolve(process.env.HOME || "/Users/mauro", ".pi", "agent", "extensions", "task-forge", "task-forge.json");
    if (existsSync(globalExtensionConfig)) return globalExtensionConfig;

    return undefined;
  }

  async function loadConfig(cwd: string) {
    const path = await findConfigPath(cwd);
    if (!path) {
      const emptyTiers = Object.values(DEFAULT_CONFIG.modelTiers).every(tier => tier.length === 0);
      if (emptyTiers) {
        throw new Error("No task-forge.json config found and no model tiers configured — create task-forge.json with modelTiers");
      }
      return { ...DEFAULT_CONFIG };
    }
    try {
      const loaded = JSON.parse(await readFile(path, "utf-8")) as Partial<TaskForgeConfig>;
      const merged = deepMergeConfig(DEFAULT_CONFIG, loaded);
      const emptyTiers = Object.values(merged.modelTiers).some(tier => tier.length === 0);
      if (emptyTiers) {
        const empty = Object.entries(merged.modelTiers).filter(([, v]) => v.length === 0).map(([k]) => k);
        throw new Error(`task-forge.json has empty model tiers: ${empty.join(", ")} — add at least one model per tier`);
      }
      return merged;
    } catch (err) {
      if (err instanceof Error && err.message.includes("model tiers")) throw err;
      throw new Error(`Failed to parse task-forge config at ${path}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── V2 persistence (state.json is derived debug artifact only) ──

  async function persistState(ctx: any, event: string, details?: Record<string, unknown>) {
    const snapshot = await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
    if (!snapshot) return;
    pi.appendEntry(STATE_ENTRY_TYPE, snapshot);
    await ensureDir(outputPath(ctx.cwd));
    await atomicWrite(outputPath(ctx.cwd, "state.json"), JSON.stringify(snapshot, null, 2));
    await appendFile(
      outputPath(ctx.cwd, "state.log"),
      `${JSON.stringify({ time: nowIso(), event, details: details ?? {}, status: snapshot.status })}\n`,
      "utf-8"
    );
    ctx.ui.setStatus("task-forge", renderStatusFromSnapshot(snapshot));
  }

  function normalizeFailureSignature(text: string | undefined) {
    return String(text ?? "")
      .toLowerCase()
      .replace(/\b\d+\b/g, "#")
      .replace(/[a-f0-9]{8,}/g, "<hex>")
      .replace(/\/users\/[^\s)]+/g, "<path>")
      .replace(/\/app\/[^\s)]+/g, "<path>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  }

  // ── V2 Planning Hooks ────────────────────────────────────────────

  function createPlanningHooks(ctx: any): PlanningHooks {
    return {
      cwd: ctx.cwd,
      config,
      outputDir: config.outputDir,
      ensureRunAbortController,
      genId,
      nowIso,
      spawnAgent: async (ctx2, role, prompt, options) => await spawnAgent(ctx2 ?? ctx, role, prompt, options),
      saveArtifact: async (ctx2, path, content) => await saveArtifact(ctx2 ?? ctx, path, content),
      readFile: async (path, encoding) => await readFile(path, encoding || "utf-8"),
      readArtifact: async (ctx2, name) => await readArtifactMaybe(ctx2 ?? ctx, name),
      gatherCodebaseSummary: async (ctx2) => await gatherCodebaseSummary(ctx2 ?? ctx),
      notify: (msg, level) => ctx.ui.notify(msg, level),
      loadSnapshot: async () => await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir),
      withEngine: async (fn) => { await withV2Engine(ctx, fn as any); },
      ensureDir: async (path) => await ensureDir(path),
      outputPath: (...parts) => outputPath(ctx.cwd, ...parts),
      extractJson,
      existsSync,
      resolve: (p1: string, p2?: string) => p2 ? resolve(p1, p2) : resolve(ctx.cwd, p1),
    };
  }

  function classifyEnvironmentFailure(task: ForgeTask) {
    const combined = [task.error, task.validationOutput, task.gateReview?.notes, task.result]
      .filter(Boolean)
      .join("\n\n");
    const normalized = combined.toLowerCase();

    const matchers = [
      {
        signature: "environment:missing-runtime",
        regex: /playwright: not found|command not found|missing script|exit:\s*127/,
        reason: "Acceptance environment is not executable",
        suggestion: "Install or expose the missing CLI/script inside the validation environment, then rerun the acceptance command.",
      },
      {
        signature: "environment:test-path-mismatch",
        regex: /no tests found|make sure that arguments are regular expressions matching test files/,
        reason: "Acceptance test path or working directory is misconfigured",
        suggestion: "Fix the test path or working directory mapping so the acceptance command resolves the intended test file inside the runtime environment.",
      },
      {
        signature: "environment:dependency-service-unreachable",
        regex: /econnrefused|fetch failed|net::err_failed|failed to fetch|connect .*:3000|service.*unreachable/,
        reason: "A dependent service is unreachable from the validation environment",
        suggestion: "Start or repair the dependent service/container and verify network reachability from the validation environment before rerunning acceptance.",
      },
      {
        signature: "environment:cors-policy",
        regex: /cors|access-control-allow-origin|preflight request/,
        reason: "Cross-origin access is blocked by backend policy",
        suggestion: "Allow the frontend dev origin in backend CORS configuration before rerunning browser-based acceptance tests.",
      },
      {
        signature: "environment:native-platform-mismatch",
        regex: /exec format error|err_dlopen_failed|another platform|platform-specific binary|esbuild.*platform|better-sqlite3.*exec format error/,
        reason: "Native dependencies were built for the wrong runtime platform",
        suggestion: "Reinstall or rebuild native dependencies inside the target container/runtime, restart the affected service, then rerun acceptance.",
      },
    ] as const;

    for (const matcher of matchers) {
      if (matcher.regex.test(normalized)) {
        return matcher;
      }
    }

    return null;
  }

  function createHumanInterventionBlocker(task: ForgeTask, reason: string, suggestion: string): Blocker {
    const commandHint = task.acceptanceSignal ? `\nAcceptance command: ${task.acceptanceSignal}` : "";
    return {
      taskId: task.id,
      reason,
      suggestion: `${suggestion}${commandHint}`,
      blockedTasks: [task.id],
    };
  }

  function taskStatusLookup() {
    return Object.fromEntries((state?.tasks ?? []).map((task) => [task.id, { status: task.status }]));
  }

  function failedDependencies(task: ForgeTask) {
    return failedDependenciesV2(task, taskStatusLookup());
  }

  async function persistTaskDefinitions(ctx: any) {
    if (!state) return;
    if (state.tasksFile) {
      await saveArtifact(ctx, state.tasksFile, JSON.stringify({ tasks: state.tasks, costEstimate: state.cost }, null, 2));
    }
    await withV2Engine(ctx, (engine) => engine.registerTasks(state!.tasks as any));
  }

  function sendTaskForgeMessage(customType: string, content: string, _ctx?: any, level: "info" | "warning" | "success" | "error" = "info") {
    pi.sendMessage(
      {
        customType,
        content,
        display: true,
        details: { level },
      },
      { triggerTurn: false },
    );
  }

  function summarizeEvidence(error?: string) {
    const raw = String(error ?? "").trim();
    if (!raw) return "";

    // Collapse massive TypeScript CLI help output into one actionable hint.
    if (raw.includes("tsc: The TypeScript Compiler") && raw.includes("COMMON COMMANDS")) {
      const cmd = raw.match(/\$\s*(.+)/)?.[1]?.trim();
      const exit = raw.match(/exit:\s*(\d+)/)?.[1];
      const lines = [
        cmd ? `command: ${cmd}` : "",
        exit ? `exit: ${exit}` : "",
        "tsc printed CLI help (likely no tsconfig found at validation root).",
        "hint: run `npx tsc -p <path-to-tsconfig> --noEmit` separately, or use `node --test` directly.",
      ].filter(Boolean);
      return lines.join("\n");
    }

    const lines = raw.split(/\r?\n/).slice(0, 20);
    const clipped = lines.join("\n");
    return raw.split(/\r?\n/).length > 20 ? `${clipped}\n... (truncated)` : clipped;
  }

  async function emitHumanInterventionMessage(ctx: any, task: ForgeTask, blocker: Blocker, heading = "Human intervention required") {
    const evidence = summarizeEvidence(task.error);
    const hasAcceptance = (task as any).acceptanceSignal || task.validation?.mode === "command";
    const acceptanceLine = hasAcceptance
      ? `Acceptance command: ${(task as any).acceptanceSignal ?? (task.validation as any)?.command ?? ""}`
      : "";
    const content = [
      `[task-forge] ${heading}`,
      `task: ${task.id} — ${task.title}`,
      `reason: ${blocker.reason}`,
      `suggestion: ${blocker.suggestion}`,
      evidence ? `evidence: ${evidence}` : "",
      acceptanceLine,
      `next: /forge blocker ${task.id} --resolve "..." then /forge execute`,
    ].filter(Boolean).join("\n");

    sendTaskForgeMessage("task-forge-human-help", content, ctx, "warning");
  }

  async function sweepOverdueSupervisors(ctx: any, authoritative?: V2RunSnapshot | null) {
    const snapshot = authoritative ?? await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
    if (!snapshot) return snapshot;

    const decisions = decideSupervisorActions({
      snapshot,
      now: Date.now(),
      nowIso: nowIso(),
      escalationMs: TASK_STALL_ESCALATION_MS,
      resolveTask: (taskId) => state?.tasks.find((task) => task.id === taskId),
      fallbackTask: (taskId) => {
        const meta = snapshot.tasks.find((task) => task.id === taskId);
        const runtime = snapshot.taskState[taskId];
        return {
          ...(meta ?? {
            id: taskId,
            title: taskId,
            description: "",
            complexity: "M",
            taskMode: "single-pass",
            contextManifest: {},
            outputManifest: [],
            dependencies: [],
            acceptanceCriteria: [],
            escalationTriggers: [],
            status: "running",
            retries: runtime?.retries ?? 0,
          }),
          status: "running",
          retries: runtime?.retries ?? 0,
          error: runtime?.error,
          acceptanceSignal: meta?.acceptanceSignal,
        } as ForgeTask;
      },
      createBlocker: (task) => createHumanInterventionBlocker(
        task as ForgeTask,
        "Task execution appears stalled",
        "Inspect the task output, container logs, and validation environment. If the task is genuinely stuck, resolve the blocker with the needed human action, then rerun /forge execute.",
      ),
    });

    if (decisions.length === 0) return snapshot;

    for (const decision of decisions) {
      if (decision.kind === "warn") {
        await withV2Engine(ctx, (engine) => engine.markTaskRuntime(decision.supervisorTaskId, { stallWarnedAt: decision.warnedAt }));
        if (state) {
          const liveTask = state.tasks.find((task) => task.id === decision.supervisorTaskId);
          if (liveTask) {
            liveTask.stallWarnedAt = decision.warnedAt;
          }
          await persistState(ctx, "task_supervisor_overdue", { taskId: decision.supervisorTaskId });
        }
        await emitHumanInterventionMessage(ctx, decision.task as ForgeTask, decision.blocker, "Execution stall detected");
        continue;
      }

      await withV2Engine(ctx, async (engine) => {
        await engine.markTaskBlocked(decision.supervisorTaskId, decision.blocker);
        await engine.requestHumanIntervention(decision.supervisorTaskId, decision.blocker.reason, decision.blocker.suggestion);
        await engine.markApprovalRequired("executePlan", "Execution (human intervention required)");
      });
      await reconcileFromAuthoritative(ctx);
      if (state) {
        await persistState(ctx, "task_supervisor_escalated", { taskId: decision.supervisorTaskId });
      }
      const effectiveTask = state?.tasks.find((task) => task.id === decision.supervisorTaskId) ?? decision.task;
      await emitHumanInterventionMessage(ctx, effectiveTask as ForgeTask, decision.blocker, "Execution stall escalated");
    }

    return await reconcileFromAuthoritative(ctx);
  }

  async function pauseForHumanIntervention(ctx: any, task: ForgeTask, blocker: Blocker, event: string, details?: Record<string, unknown>) {
    if (!state) return;
    await withV2Engine(ctx, async (engine) => {
      await engine.markTaskBlocked(task.id, blocker);
      await engine.requestHumanIntervention(task.id, blocker.reason, blocker.suggestion);
      await engine.markApprovalRequired("executePlan", "Execution (human intervention required)");
    });
    await reconcileFromAuthoritative(ctx);
    const effectiveTask = state?.tasks.find((candidate) => candidate.id === task.id) ?? task;
    await persistState(ctx, event, { taskId: task.id, ...details });
    await emitHumanInterventionMessage(ctx, effectiveTask, blocker);
  }

  function describeInterruptedExecution(authoritative: V2RunSnapshot | null): { label: string; nextAction: "executePlan"; requeuedTaskIds: string[] } | null {
    return describeInterruptedExecutionV2(authoritative);
  }

  async function saveArtifact(ctx: any, relativePath: string, content: string) {
    const path = outputPath(ctx.cwd, relativePath);
    await atomicWrite(path, content);
    return path;
  }

  async function readArtifactMaybe(ctx: any, relativePath?: string) {
    if (!relativePath) return "";
    const path = outputPath(ctx.cwd, relativePath);
    if (!existsSync(path)) return "";
    return await readFile(path, "utf-8");
  }

  async function getAvailableModelRefs(ctx: any): Promise<Set<string>> {
    try {
      const available = await ctx.modelRegistry.getAvailable();
      return new Set(available.map((m: any) => `${m.provider}/${m.id}`));
    } catch {
      return new Set<string>();
    }
  }

  async function getModelCandidatesForRole(ctx: any, role: Role): Promise<string[]> {
    const explicit = config.modelOverrides[role];
    if (explicit) return [explicit];

    const available = await getAvailableModelRefs(ctx);
    const tier = config.roleAssignment[role];
    const configured = config.modelTiers[tier] ?? [];
    const preferred = configured.filter((ref) => available.size === 0 || available.has(ref));
    const fallback = configured.filter((ref) => !preferred.includes(ref));
    return [...preferred, ...fallback];
  }

  async function resolveModelForRole(ctx: any, role: Role): Promise<string> {
    const candidates = await getModelCandidatesForRole(ctx, role);
    const resolved = candidates[0];
    if (resolved) {
      resolvedModels[role] = resolved;
      return resolved;
    }
    throw new Error(`No configured models available for role ${role}`);
  }

  async function writeTempPrompt(ctx: any, prefix: string, content: string) {
    const file = outputPath(ctx.cwd, "tmp", `${prefix}-${Date.now()}.md`);
    await atomicWrite(file, content);
    return file;
  }

  function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: raw.trim() };
    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) frontmatter[key] = value;
    }
    return { frontmatter, body: match[2].trim() };
  }

  async function loadAgentDefinition(role: Role): Promise<AgentDefinition> {
    const cached = agentCache.get(role);
    if (cached) return cached;

    const baseDir = resolve(process.env.HOME || "/Users/mauro", ".pi", "agent", "extensions", "task-forge", "agents");
    const sourcePath = resolve(baseDir, roleFiles[role]);
    const raw = await readFile(sourcePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const definition: AgentDefinition = {
      name: frontmatter.name || `task-forge-${role}`,
      description: frontmatter.description,
      tools: frontmatter.tools || "read,grep,find,ls",
      model: frontmatter.model,
      systemPrompt: body,
    };
    agentCache.set(role, definition);
    return definition;
  }

  function sanitizeAgentCommandOutput(text: string | undefined) {
    return String(text ?? "")
      .split(/\r?\n/)
      .filter((line) => !/Invalid thinking level .*:free/i.test(line))
      .join("\n")
      .trim();
  }

  function isRetryableModelFailure(text: string | undefined) {
    const normalized = String(text ?? "").toLowerCase();
    return [
      "model is not supported",
      "insufficient_quota",
      "quota",
      "rate limit",
      "credit",
      "credits",
      "billing",
      "account",
      "unsupported",
      "not available",
      "usage limit",
      "hit your",
      "try again in",
    ].some((needle) => normalized.includes(needle));
  }

  async function spawnAgent(
    ctx: any,
    role: Role,
    promptContent: string,
    options?: {
      promptAppendix?: string;
      tools?: string;
      timeout?: number;
      modelRole?: Role;
    },
  ): Promise<string> {
    const agent = await loadAgentDefinition(role);
    const modelRole = options?.modelRole ?? role;
    const candidates = await getModelCandidatesForRole(ctx, modelRole);
    const promptFile = await writeTempPrompt(ctx, role, promptContent);
    const systemPrompt = options?.promptAppendix
      ? `${agent.systemPrompt}\n\n## Runtime Instructions\n${options.promptAppendix}`
      : agent.systemPrompt;

    let lastError = "";
    for (const [index, model] of candidates.entries()) {
      if (state) {
        activeAgent = {
          role: modelRole,
          model,
          startedAt: nowIso(),
          attempt: index + 1,
          totalCandidates: candidates.length,
        };
        await persistState(ctx, "agent_start", { role: modelRole, model, attempt: index + 1, totalCandidates: candidates.length, promptFile, tools: options?.tools || agent.tools });
      }

      const execStart = Date.now();
      const result = await pi.exec(
        "pi",
        [
          "--no-session",
          "--no-extensions",
          "--no-skills",
          "--no-prompt-templates",
          "--no-themes",
          "--model",
          model,
          "--tools",
          options?.tools || agent.tools,
          "--system-prompt",
          systemPrompt,
          "-p",
          `@${promptFile}`,
          "Execute the attached instructions and return the requested output only.",
        ],
        {
          cwd: ctx.cwd,
          signal: runAbortController?.signal,
          timeout: seconds(options?.timeout ?? 600),
        } as any,
      );
      const execDurationMs = Date.now() - execStart;

      if (result.killed) {
        if (runAbortController?.signal.aborted) {
          throw new Error(`${role} aborted`);
        }
        lastError = `${modelRole} timed out on model ${model}`;
        if (state) {
          await persistState(ctx, "agent_retry_model", { role: modelRole, model, attempt: index + 1, totalCandidates: candidates.length, error: lastError, reason: "timeout", durationMs: execDurationMs });
        }
        if (model !== candidates[candidates.length - 1]) {
          continue;
        }
      }

      const stderr = sanitizeAgentCommandOutput(result.stderr);
      const stdout = sanitizeAgentCommandOutput(result.stdout);
      if (result.code === 0 && stdout) {
        if (state) {
          activeAgent = undefined;
          await persistState(ctx, "agent_complete", { role: modelRole, model, attempt: index + 1, totalCandidates: candidates.length, durationMs: execDurationMs, outputLength: stdout.length, outputPreview: stdout.slice(0, 200) });
        }
        resolvedModels[modelRole] = model;
        return stdout;
      }

      const combined = [stderr, stdout].filter(Boolean).join("\n").trim();
      if (result.code === 0 && !stdout) {
        lastError = combined || `model ${model} returned empty output (exit code 0)`;
      } else {
        lastError = combined || `exit code ${result.code}`;
      }
      const isRetryable = isRetryableModelFailure(combined) || (result.code === 0 && !stdout);
      if (isRetryable && model !== candidates[candidates.length - 1]) {
        if (state) {
          await persistState(ctx, "agent_retry_model", { role: modelRole, model, attempt: index + 1, totalCandidates: candidates.length, error: lastError, durationMs: execDurationMs, exitCode: result.code, stderrPreview: stderr.slice(0, 200), stdoutPreview: stdout.slice(0, 200) });
        }
        continue;
      }
      if (state) {
        await persistState(ctx, "agent_fatal", { role: modelRole, model, attempt: index + 1, totalCandidates: candidates.length, error: lastError, durationMs: execDurationMs, exitCode: result.code, stderrPreview: stderr.slice(0, 300), stdoutPreview: stdout.slice(0, 300) });
      }
      break;
    }

    if (state) {
      activeAgent = undefined;
      await persistState(ctx, "agent_failed", { role: modelRole, error: lastError });
    }
    throw new Error(`${role} failed: ${lastError}`);
  }

  async function gatherCodebaseSummary(ctx: any): Promise<string> {
    const result = await pi.exec(
      "bash",
      [
        "-lc",
        "find . -maxdepth 3 \( -path './node_modules' -o -path './.git' -o -path './.task-forge' \) -prune -o -type f | sort | head -n 400",
      ],
      { cwd: ctx.cwd, timeout: seconds(20) } as any,
    );
    return result.stdout?.trim() || "";
  }

  const coerceTask = coercePlannerTask;
  const coerceTestSpec = coerceTestDesignerSpec;

  async function buildTaskContext(ctx: any, task: ForgeTask) {
    const sections: string[] = [];

    sections.push(`# Task\n${task.id} — ${task.title}`);
    sections.push(`## Description\n${task.description}`);
    sections.push(`## Acceptance Criteria\n${task.acceptanceCriteria.map((x) => `- ${x}`).join("\n") || "- None"}`);

    if (task.resolutionInstruction) {
      sections.push(`## Resolution Instruction\n${task.resolutionInstruction}`);
    }

    if (task.contextManifest.artifacts?.length) {
      const artifacts: string[] = [];
      for (const artifact of task.contextManifest.artifacts) {
        const content = await readArtifactMaybe(ctx, artifact);
        if (content) artifacts.push(`### ${artifact}\n${content}`);
      }
      if (artifacts.length) sections.push(`## Artifact Context\n${artifacts.join("\n\n")}`);
    }

    const taskTestSpec = state?.testSpecs?.find((spec) => spec.taskId === task.id);
    if (taskTestSpec) {
      sections.push(`## Test Spec\n${JSON.stringify(taskTestSpec, null, 2)}`);
    }

    if (task.contextManifest.codebaseFiles?.length) {
      const files: string[] = [];
      for (const file of task.contextManifest.codebaseFiles.slice(0, 20)) {
        const path = resolve(ctx.cwd, file);
        if (!existsSync(path)) continue;
        const content = await readFile(path, "utf-8");
        files.push(`### ${file}\n${content.slice(0, 12000)}`);
      }
      if (files.length) sections.push(`## Codebase Files\n${files.join("\n\n")}`);
    }

    if (task.contextManifest.dependencyOutputs?.length) {
      const deps = task.contextManifest.dependencyOutputs
        .map((id) => state?.tasks.find((t) => t.id === id))
        .filter(Boolean)
        .map((t) => `### ${t!.id} — ${t!.title}\n${(t!.result ?? "").slice(0, 6000)}`);
      if (deps.length) sections.push(`## Dependency Outputs\n${deps.join("\n\n")}`);
    }

    return sections.join("\n\n");
  }

  async function runValidation(ctx: any, task: ForgeTask): Promise<{ passed: boolean; output: string; coverage?: number }> {
    return await runTaskValidation(task, {
      exec: async (command) => await pi.exec(
        "bash",
        ["-lc", command],
        { cwd: ctx.cwd, signal: runAbortController?.signal, timeout: seconds(900) } as any,
      ),
    });
  }

  async function diagnoseTaskFailure(ctx: any, task: ForgeTask) {
    return await runTaskDiagnosticReview({
      task,
      testSpec: state?.testSpecs?.find((spec) => spec.taskId === task.id) ?? {},
    }, {
      runReviewer: async (prompt) => await spawnAgent(ctx, "diagnosticReviewer", prompt, {
        promptAppendix: "Classify the root cause. If the test spec is wrong, provide a rewritten grounded test spec for this task only. Return one JSON object in a ```json fenced block only.",
        timeout: 900,
      }),
    });
  }

  async function gateReviewTask(ctx: any, task: ForgeTask): Promise<{ passed: boolean; notes: string; blocker?: Blocker }> {
    return await runTaskGateReview(task, {
      runReviewer: async (prompt, modelRole) => await spawnAgent(ctx, "gateReviewer", prompt, {
        promptAppendix: "Return one JSON object in a ```json fenced block only.",
        timeout: 600,
        modelRole,
      }),
    });
  }

  async function executeTask(ctx: any, task: ForgeTask) {
    if (!state) throw new Error("No orchestration state");

    const runtimeFailureHooks = createTaskForgeTaskFailureHooks<ForgeTask>({
      markRuntime: async (taskId, runtime) => {
        await withV2Engine(ctx, (engine) => engine.markTaskRuntime(taskId, runtime));
      },
    });
    const terminalFailureHooks = createTaskForgeTaskFailureHooks<ForgeTask>({
      markRuntime: async (taskId, runtime) => {
        await withV2Engine(ctx, (engine) => engine.markTaskRuntime(taskId, runtime));
      },
      markFailed: async (taskId, error) => {
        await withV2Engine(ctx, (engine) => engine.markTaskFailed(taskId, error));
      },
      reconcile: async () => {
        await reconcileFromAuthoritative(ctx);
      },
      persistState: async (event, details) => {
        await persistState(ctx, event, details);
      },
    });
    const retryFailureHooks = createTaskForgeTaskFailureHooks<ForgeTask>({
      markRuntime: async (taskId, runtime) => {
        await withV2Engine(ctx, (engine) => engine.markTaskRuntime(taskId, runtime));
      },
      requeue: async (taskId, reason) => {
        await withV2Engine(ctx, (engine) => engine.requeueTask(taskId, reason));
      },
      reconcile: async () => {
        await reconcileFromAuthoritative(ctx);
      },
      persistState: async (event, details) => {
        await persistState(ctx, event, details);
      },
    });

    await executeManagedTask(task, {
      nowIso,
      maxRetries: config.maxRetries,
      defaultTurnBudget: config.defaultTurnBudget,
      maxTurnBudget: config.maxTurnBudget,
      buildTaskContext: async (task) => await buildTaskContext(ctx, task),
      spawnWorker: async (role, prompt, options) => await spawnAgent(ctx, role, prompt, options),
      runValidation: async (task) => await runValidation(ctx, task),
      runGateReview: async (task) => await gateReviewTask(ctx, task),
      runDiagnosticReview: async (task) => await diagnoseTaskFailure(ctx, task),
      beginExecution: async (task) => {
        await beginTaskExecution(task, createTaskForgeBeginTaskExecutionHooks<ForgeTask>({
          nowIso,
          resolveModel: async (role) => await resolveModelForRole(ctx, role),
          persistState: async (event, details) => {
            await persistState(ctx, event, details);
          },
          markStarted: async (taskId, runAttempt, model) => {
            await withV2Engine(ctx, (engine) => engine.markTaskStarted(taskId, runAttempt, model, undefined, TASK_STALL_WARNING_MS));
          },
          markRuntime: async (taskId, runtime) => {
            await withV2Engine(ctx, (engine) => engine.markTaskRuntime(taskId, runtime));
          },
          markTddProgress: async (taskId, phase, runtime) => {
            await withV2Engine(ctx, (engine) => engine.markTaskTddProgress(taskId, phase, runtime));
          },
        }));
      },
      completeExecution: async (task, gate) => {
        await completeTaskExecution(task, gate, createTaskForgeCompleteTaskExecutionHooks<ForgeTask>({
          nowIso,
          saveTaskResult: async (taskId, result) => {
            await saveArtifact(ctx, `tasks/${taskId}.md`, result);
          },
          saveGateReview: async (taskId, gateReview) => {
            await saveArtifact(ctx, `tasks/${taskId}.gate.json`, JSON.stringify(gateReview, null, 2));
          },
          persistState: async (event, details) => {
            await persistState(ctx, event, details);
          },
          markRuntime: async (taskId, runtime) => {
            await withV2Engine(ctx, (engine) => engine.markTaskRuntime(taskId, runtime));
          },
          markCompleted: async (taskId, result) => {
            await withV2Engine(ctx, (engine) => engine.markTaskCompleted(taskId, result));
          },
        }));
      },
      failExecutionAttempt: async (task, error) => {
        await failTaskExecutionAttempt(task, error, runtimeFailureHooks);
      },
      markHeartbeat: async (taskId) => {
        await withV2Engine(ctx, (engine) => engine.markTaskHeartbeat(taskId, TASK_STALL_WARNING_MS));
      },
      markTddProgress: async (taskId, phase, runtime) => {
        await withV2Engine(ctx, (engine) => engine.markTaskTddProgress(taskId, phase, runtime));
      },
      markValidation: async (taskId, validation, task) => {
        await withV2Engine(ctx, (engine) => engine.markTaskValidation(taskId, validation.passed, validation.output, task.validationFramework, validation.coverage));
      },
      markGateReview: async (taskId, gate) => {
        await withV2Engine(ctx, (engine) => engine.markTaskGateReview(taskId, gate.passed, gate.notes));
      },
      onGateBlocked: async (task, gate) => {
        if (!gate.blocker) return;
        await pauseForHumanIntervention(ctx, task, gate.blocker, "task_blocked", { blocker: gate.blocker.reason });
        await saveArtifact(ctx, `tasks/${task.id}.gate.json`, JSON.stringify(gate, null, 2));
      },
      appendIterationLog: async (taskId, entry) => {
        await appendFile(outputPath(ctx.cwd, "tasks", `${taskId}.iterations.log`), `${JSON.stringify(entry)}\n`, "utf-8");
      },
      environmentFailure: (task) => classifyEnvironmentFailure(task),
      normalizeFailureSignature: (error) => normalizeFailureSignature(error),
      canDiagnose: (task) => needsDiagnosticReview(task),
      createHumanInterventionBlocker: (task, reason, suggestion) => createHumanInterventionBlocker(task, reason, suggestion),
      pauseForHumanIntervention: async (task, blocker, event, details) => {
        await pauseForHumanIntervention(ctx, task, blocker, event, details);
      },
      saveDiagnostic: async (taskId, diagnosis) => {
        await saveArtifact(ctx, `tasks/${taskId}.diagnostic.json`, JSON.stringify(diagnosis, null, 2));
      },
      persistTaskDefinitions: async () => {
        await persistTaskDefinitions(ctx);
      },
      updateTestSpecs: async (testSpecs) => {
        state!.testSpecs = testSpecs as TestSpecEntry[];
        await saveArtifact(ctx, "03-test-spec.json", JSON.stringify({ testSpecs: state!.testSpecs }, null, 2));
      },
      currentTestSpecs: () => (state!.testSpecs ?? []) as TestSpecEntry[],
      testSpecMarkdownFile: () => state?.testSpecMarkdownFile,
      markTestSpecWritten: async (testSpecs, markdownFile) => {
        await withV2Engine(ctx, (engine) => engine.markTestSpecWritten("03-test-spec.json", testSpecs, markdownFile));
      },
      requeueTask: async (taskId, reason) => {
        await withV2Engine(ctx, (engine) => engine.requeueTask(taskId, reason));
      },
      reconcile: async () => {
        await reconcileFromAuthoritative(ctx);
      },
      persistState: async (event, details) => {
        await persistState(ctx, event, details);
      },
      runtimeFailureSync: runtimeFailureHooks,
      terminalFailureSync: {
        markRuntime: terminalFailureHooks.markRuntime!,
        markFailed: terminalFailureHooks.markFailed!,
      },
      retryFailureSync: {
        markRuntime: retryFailureHooks.markRuntime!,
        requeue: retryFailureHooks.requeue!,
      },
    });
  }

  function dependenciesResolved(task: ForgeTask) {
    return dependenciesResolvedV2(task, taskStatusLookup());
  }

  function hasFailedDependency(task: ForgeTask) {
    return failedDependencies(task).length > 0;
  }

  // FROZEN — deferred to execution supervisor V2 extraction
  async function executeApprovedPlan(ctx: any) {
    await loadAndSyncState(ctx);
    if (!state) throw new Error("No plan to execute");

    const execState = { tasks: state.tasks, status: state.status, currentPhase: state.currentPhase, phaseLabel: state.phaseLabel };
    await executeApprovedPlanLoop(execState, {
      persistState: async (event, details) => {
        await persistState(ctx, event, details);
      },
      beginExecution: async () => {
        await withV2Runner(ctx, (runner) => runner.beginExecution());
      },
      reconcile: async () => {
        await reconcileFromAuthoritative(ctx);
      },
      syncExecutionSnapshot: async () => await syncExecutionSnapshot(ctx),
      isAbortRequested: () => Boolean(runAbortController?.signal.aborted),
      abortExecution: async () => {
        await withV2Runner(ctx, (runner) => runner.abortExecution("Execution aborted"));
      },
      advanceExecution: async () => {
        const step = await withV2Runner(ctx, (runner) => runner.advanceExecution(execState.tasks as any, config.maxWorkers));
        if (!step) {
          throw new Error("Failed to run V2 execution advance step");
        }
        return step;
      },
      bridgeHooks: createTaskForgeRunnerAdvanceHooks<ForgeTask>({
        reconcile: async () => {
          await reconcileFromAuthoritative(ctx);
        },
        persistTaskDefinitions: async () => {
          await persistTaskDefinitions(ctx);
        },
        persistState: async (event: string, details?: Record<string, unknown>) => {
          await persistState(ctx, event, details);
        },
        updateTaskCommand: (task: ForgeTask, normalizedCommand: string) => {
          if (task.acceptanceSignal) task.acceptanceSignal = normalizedCommand;
          else if (task.testCommand) task.testCommand = normalizedCommand;
        },
        emitHumanIntervention: async (task: ForgeTask, blocker: Blocker) => {
          await emitHumanInterventionMessage(ctx, task, blocker);
        },
        applyStatePatch: (statePatch) => {
          if (!state) return;
          state.status = statePatch.localStatus;
          if (statePatch.currentPhase !== undefined) state.currentPhase = statePatch.currentPhase;
          if (statePatch.phaseLabel !== undefined) state.phaseLabel = statePatch.phaseLabel;
        },
        phaseIntegrationReview: async () => {
          await phaseIntegrationReview(ctx);
        },
      }),
      launchTaskBatch: async (tasks) => {
        await launchExecutionBatch(tasks, {
          runTask: async (task: ForgeTask) => {
            await executeTask(ctx, task);
          },
          sweepOverdueSupervisors: async () => {
            await sweepOverdueSupervisors(ctx);
          },
          sweepIntervalMs: TASK_SUPERVISOR_SWEEP_MS,
        });
      },
    });
  }

  // FROZEN — deferred to execution supervisor V2 extraction
  async function phaseIntegrationReview(ctx: any) {
    await loadAndSyncState(ctx);
    if (!state) throw new Error("No orchestration state");
    const reviewTasks = state.tasks;
    const requirements = await readArtifactMaybe(ctx, state.requirementsFile);
    const plan = await readArtifactMaybe(ctx, state.planFile);

    await runIntegrationReview(
      {
        requirements,
        plan,
        tasks: reviewTasks,
      },
      createTaskForgeIntegrationReviewHooks({
        runReviewer: async (prompt: string) =>
          await spawnAgent(ctx, "integrationReviewer", prompt, {
            promptAppendix: "Return Markdown only.",
            timeout: 1200,
          }),
        saveReview: async (content: string) => {
          await saveArtifact(ctx, "04-review.md", content);
          return "04-review.md";
        },
        completeReview: async (reviewFile: string) => {
          if (!state) return;
          state.reviewFile = reviewFile;
          state.status = "completed";
          state.timestamps.completed = nowIso();
          await persistState(ctx, "phase_complete", { phase: 6, completed: true });
          await withV2Engine(ctx, async (engine) => {
            await engine.markIntegrationReviewCompleted(reviewFile);
            await engine.markRunCompleted();
          });
          await reconcileFromAuthoritative(ctx);
        },
        notifyComplete: async () => {
          ctx.ui.notify("[task-forge] Review complete", "success");
        },
      })
    );
  }


  function startExecutionInBackground(ctx: any, reason: string) {
    if (executionPromise) return executionPromise;

    executionPromise = (async () => {
      try {
        ensureRunAbortController();
        await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
        await executeApprovedPlan(ctx);
      } catch (error: any) {
        if (state) {
          await withV2Engine(ctx, (engine) => engine.markRunFailed(String(error?.message ?? error)));
          await reconcileFromAuthoritative(ctx);
          await persistState(ctx, "execution_failed", { reason, error: String(error?.message ?? error) });
        }
        ctx.ui.notify(`[task-forge] ${String(error?.message ?? error)}`, "error");
      } finally {
        executionPromise = null;
      }
    })();

    ctx.ui.notify(`[task-forge] Execution started (${reason})`, "info");
    return executionPromise;
  }

  // startPlanningInBackground V1 deleted — superseded by startPlanningInBackgroundV2


  // ── V2 shell command handlers ───────────────────────────────────

  async function handlePlanningResumptionV2(ctx: any, snapshot: V2RunSnapshot | null) {
    const hooks = createPlanningHooks(ctx);
    if (!snapshot) return ctx.ui.notify("[task-forge] No plan available", "warning");

    const isInterruptedPlanning = snapshot.planningRuntime?.interrupted === true;
    if (isInterruptedPlanning) {
      const layout = createLayout(ctx.cwd, config.outputDir);
      const resumptionPhase = await determineResumptionPhase(snapshot, layout);
      if (resumptionPhase === null) {
        ctx.ui.notify("[task-forge] ⚠ restart required — planning artifacts are missing or corrupt. Rerun /forge <prd> to restart planning.", "error");
        return;
      }
      await withV2Engine(ctx, async (engine) => {
        await engine.markRunResumed(`Planning resumed from phase ${resumptionPhase} after interruption`);
        await engine.markApprovalGranted();
      });
      // Resume via plan.ts phase functions
      snapshot = await hooks.loadSnapshot() ?? snapshot;
      switch (resumptionPhase) {
        case 1: snapshot = await analyzeRequirements(ctx, hooks, snapshot); break;
        case 2: case 0: snapshot = await planDecomposition(ctx, hooks, snapshot); break;
        case 3: snapshot = await designTests(ctx, hooks, snapshot); break;
        case 4: break;
        default: snapshot = await planDecomposition(ctx, hooks, snapshot);
      }
      return;
    }

    await withV2Engine(ctx, async (engine) => {
      if (snapshot.status === "paused") {
        await engine.markRunResumed("Planning resumed after checkpoint approval");
      }
      await engine.markApprovalGranted();
    });
    snapshot = await hooks.loadSnapshot() ?? snapshot;
    const result = await continueComplexPlanning(ctx, hooks, snapshot);
    if (result.status === "awaiting_approval") {
      ctx.ui.setStatus("task-forge", renderStatusFromSnapshot(result.snapshot));
      sendTaskForgeMessage("task-forge-approval-ready", "[task-forge] Plan ready. Review artifacts, then run /forge execute", ctx, "warning");
    } else if (result.status === "completed") {
      startExecutionInBackground(ctx, "execute");
    }
  }


  async function handleExecuteCommand(ctx: any, snapshot: V2RunSnapshot | null, raw: string) {
    if (snapshot?.nextAction === "continuePlanning") {
      return await handlePlanningResumptionV2(ctx, snapshot);
    }

    let currentSnapshot = snapshot;
    if (currentSnapshot?.status === "paused") {
      const resumeResult = resumeCommandService(currentSnapshot, { reason: "Resumed by /forge execute" });
      if (resumeResult.ok) {
        currentSnapshot = await applyCommandEvents(ctx, resumeResult);
      }
    }

    const executeResult = executeCommandService(currentSnapshot, { grantApproval: true });
    if (!executeResult.ok) {
      ctx.ui.notify(`[task-forge] ${executeResult.message}`, "warning");
      return;
    }

    await applyCommandEvents(ctx, executeResult);
    startExecutionInBackground(ctx, "execute command");
  }

  async function handleBlockerCommand(ctx: any, snapshot: V2RunSnapshot | null, raw: string, parts: string[]) {
    await loadAndSyncState(ctx);
    if (!state && !snapshot) {
      ctx.ui.notify("[task-forge] No active orchestration", "warning");
      return;
    }

    if (!parts[1] || parts[1].startsWith("--")) {
      const result = listBlockersCommandService(snapshot);
      if (!result.ok || !result.data) {
        ctx.ui.notify(result.message ?? "[task-forge] No active orchestration", "warning");
        return;
      }

      const allBlockers = result.data.blockers.filter((b) => !b.resolvedAt);
      const blockedOrFailed = (snapshot?.tasks ?? []).filter((t) => {
        const st = snapshot?.taskState[t.id];
        return st?.status === "blocked" || st?.status === "failed";
      });

      if (allBlockers.length === 0 && blockedOrFailed.length === 0) {
        ctx.ui.notify("[task-forge] No active blockers. All tasks are progressing.", "success");
        return;
      }

      const lines: string[] = ["[task-forge] Active blockers", ""];

      for (const b of allBlockers) {
        const task = snapshot?.tasks.find((t) => t.id === b.taskId);
        const runtime = snapshot?.taskState[b.taskId];
        const status = runtime?.status ?? "unknown";
        const icon = status === "failed" ? "✖" : status === "blocked" ? "⊘" : "⚠";
        lines.push(`  ${icon} ${b.taskId}  ${b.category}  ${b.reason}`);
        if (b.suggestion) lines.push(`    suggestion: ${b.suggestion}`);
        if (task) lines.push(`    task: ${task.title}`);
      }

      const blockerTaskIds = new Set(allBlockers.map((b) => b.taskId));
      for (const t of blockedOrFailed) {
        if (blockerTaskIds.has(t.id)) continue;
        const runtime = snapshot?.taskState[t.id];
        const icon = runtime?.status === "failed" ? "✖" : "⊘";
        lines.push(`  ${icon} ${t.id}  ${runtime?.status}  ${t.title}`);
        if (runtime?.error) lines.push(`    error: ${runtime.error.substring(0, 120)}`);
      }

      lines.push("");
      lines.push("Resolve with:    /forge blocker <id> --resolve \"...\"");
      lines.push("Retry failed:     /forge blocker <id> --retry");
      lines.push("Force unblock:    /forge blocker <id> --force-unblock");
      lines.push("Fix validation:   /forge blocker <id> --patch-validation \"command\"");
      lines.push("View diagnostic:  /forge blocker <id> --diagnostic");
      lines.push("Task details:     /forge blocker <id>");

      ctx.ui.notify(lines.join("\n"), "warning");
      return;
    }

    const taskId = parts[1];
    const task = state?.tasks.find((t) => t.id === taskId);
    const authoritativeTaskExists = snapshot?.tasks.some((t) => t.id === taskId) || snapshot?.taskState[taskId];
    if (!authoritativeTaskExists && state && !task) {
      ctx.ui.notify(`[task-forge] Unknown task: ${taskId}`, "warning");
      return;
    }

    await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
    const v2Engine = new TaskForgeV2Engine(ctx.cwd, config.outputDir);
    const v2Snapshot = await v2Engine.snapshot();
    const effectiveSnapshot = v2Snapshot ?? snapshot;
    const v2Task = effectiveSnapshot?.tasks.find((t) => t.id === taskId);
    const v2Runtime = effectiveSnapshot?.taskState[taskId];
    const v2Blocker = effectiveSnapshot?.blockers.find((b) => b.taskId === taskId && !b.resolvedAt);
    const needsHumanResolution = effectiveSnapshot?.pendingHumanIntervention?.taskId === taskId;

    if (raw.includes("--diagnostic")) {
      const diagPath = outputPath(ctx.cwd, "tasks", `${taskId}.diagnostic.json`);
      let diagnostic: any = null;
      if (existsSync(diagPath)) {
        try { diagnostic = JSON.parse(await readFile(diagPath, "utf-8")); } catch {}
      }

      let lastFailEvent: any = null;
      const logPath = outputPath(ctx.cwd, "state.log");
      if (existsSync(logPath)) {
        try {
          const logContent = await readFile(logPath, "utf-8");
          for (const line of logContent.trim().split("\n").reverse()) {
            try {
              const entry = JSON.parse(line);
              if (entry.event === "task_failed" && entry.details?.taskId === taskId) {
                lastFailEvent = entry;
                break;
              }
            } catch {}
          }
        } catch {}
      }

      const lines: string[] = [`[task-forge] Diagnostic for ${taskId}`, ""];
      if (v2Runtime) {
        lines.push(`  status: ${v2Runtime.status}`);
        if (v2Runtime.error) lines.push(`  error: ${v2Runtime.error.substring(0, 200)}`);
        if (v2Runtime.blocker) lines.push(`  blocker (${v2Runtime.blocker.category}): ${v2Runtime.blocker.reason}`);
        if (v2Runtime.diagnosticCount) lines.push(`  diagnostics run: ${v2Runtime.diagnosticCount}`);
        lines.push("");
      }

      if (diagnostic) {
        lines.push("  Diagnostic classification:");
        lines.push(`    category: ${diagnostic.classification ?? "unknown"}`);
        lines.push(`    notes: ${(diagnostic.notes ?? "(none)").substring(0, 300)}`);
        if (diagnostic.blocker) {
          lines.push(`    blocker reason: ${diagnostic.blocker.reason ?? "(none)"}`);
          lines.push(`    blocker suggestion: ${diagnostic.blocker.suggestion ?? "(none)"}`);
        }
      } else {
        lines.push("  No diagnostic JSON found.");
      }

      if (lastFailEvent) {
        lines.push("");
        lines.push(`  Last failure (${lastFailEvent.time}):`);
        lines.push(`    error: ${(lastFailEvent.details?.error ?? "").substring(0, 200)}`);
      }

      ctx.ui.notify(lines.join("\n"), "warning");
      return;
    }

    if (raw.includes("--retry")) {
      const retryResult = retryTaskCommandService(effectiveSnapshot, { taskId });
      if (retryResult.ok && retryResult.events.length > 0) {
        await applyCommandEvents(ctx, retryResult);
      }
      if (v2Task && needsHumanResolution) {
        await v2Engine.resolveHumanIntervention(taskId, "Manual retry via /forge blocker --retry");
        await reconcileFromAuthoritative(ctx);
      }
      if (task && (task.status === "failed" || task.status === "blocked")) {
        task.status = "pending";
        task.blocker = undefined;
        task.error = undefined;
        state!.blockers = state!.blockers
          .map((b) => (b.taskId === taskId ? { ...b, resolvedBy: "manual retry", resolvedAt: nowIso() } : b))
          .filter((b) => b.taskId !== taskId);
      }
      if (state) {
        if (state.status === "needs_human_intervention" || state.status === "paused") state.status = "awaiting_approval";
        await persistState(ctx, "blocker_retry", { taskId, action: "retry" });
      }
      ctx.ui.notify(`[task-forge] ${taskId} requeued. Run /forge execute to continue.`, "success");
      return;
    }

    if (raw.includes("--force-unblock")) {
      let cascadeCount = 0;

      if (v2Task && v2Runtime && v2Runtime.status === "blocked") {
        await v2Engine.requeueTask(taskId, "Force unblock via /forge blocker --force-unblock");
        cascadeCount++;
      }
      if (task && task.status === "blocked") {
        task.status = "pending";
        task.blocker = undefined;
        task.error = undefined;
      }

      if (effectiveSnapshot) {
        const { readyTaskIds, requeueTaskIds } = computeSchedulingActions(effectiveSnapshot);
        for (const requeueId of requeueTaskIds) {
          if (requeueId === taskId) continue;
          const requeueRuntime = effectiveSnapshot.taskState[requeueId];
          if (requeueRuntime?.status === "blocked") {
            await v2Engine.requeueTask(requeueId, `Cascade unblock from ${taskId} force-unblock`);
            cascadeCount++;
            const requeueTask = state?.tasks.find((t) => t.id === requeueId);
            if (requeueTask) {
              requeueTask.status = "pending";
              requeueTask.blocker = undefined;
              requeueTask.error = undefined;
            }
          }
        }
        for (const readyId of readyTaskIds) {
          const readyRuntime = effectiveSnapshot.taskState[readyId];
          if (readyRuntime?.status !== "ready" && readyRuntime?.status !== "pending") continue;
          const readyTask = state?.tasks.find((t) => t.id === readyId);
          if (readyTask && readyTask.status !== "ready") {
            readyTask.status = "ready";
          }
        }
      }

      if (state) {
        state.blockers = state.blockers.filter(
          (b) => !(b.taskId === taskId && b.category === "dependency") && !b.reason?.startsWith(`Blocked by failed dependency: ${taskId}`)
        );
      }

      await reconcileFromAuthoritative(ctx);
      if (state) {
        if (state.status === "needs_human_intervention" || state.status === "paused") state.status = "awaiting_approval";
        await persistState(ctx, "blocker_force_unblock", { taskId, action: "force-unblock", cascaded: cascadeCount });
      }
      ctx.ui.notify(`[task-forge] ${taskId} force-unblocked (${cascadeCount} task${cascadeCount === 1 ? "" : "s"} cascaded). Run /forge execute to continue.`, "success");
      return;
    }

    if (raw.includes("--patch-validation")) {
      const patchIndex = raw.indexOf("--patch-validation");
      const newCommand = raw.slice(patchIndex + "--patch-validation".length).trim().replace(/^['"]|['"]$/g, "");
      if (!newCommand) {
        ctx.ui.notify("Usage: /forge blocker <task-id> --patch-validation \"command\"", "warning");
        return;
      }

      const patchResult = patchValidationCommandService(effectiveSnapshot, { taskId, command: newCommand });
      if (patchResult.ok && patchResult.events.length > 0) {
        await applyCommandEvents(ctx, patchResult);
      }

      let patched = 0;
      if (task) {
        if (task.validation?.mode === "command") {
          task.validation.command = newCommand;
          patched++;
        }
        if (task.acceptanceSignal) {
          task.acceptanceSignal = newCommand;
        }
        await persistTaskDefinitions(ctx);
      }

      if (state?.testSpecs) {
        const spec = (state.testSpecs as TestSpecEntry[]).find((s) => s.taskId === taskId);
        if (spec && spec.validation?.mode === "command") {
          spec.validation.command = newCommand;
          patched++;
        }
        if (state.testSpecFile) {
          await saveArtifact(ctx, state.testSpecFile, JSON.stringify({ testSpecs: state.testSpecs }, null, 2));
        }
      }

      const snapshotPath = outputPath(ctx.cwd, "state.json");
      if (existsSync(snapshotPath)) {
        try {
          const snapshotData = JSON.parse(await readFile(snapshotPath, "utf-8"));
          const v2TaskDef = snapshotData.tasks?.find((t: any) => t.id === taskId);
          if (v2TaskDef?.validation?.mode === "command") {
            v2TaskDef.validation.command = newCommand;
            patched++;
          }
          if (v2TaskDef?.acceptanceSignal) {
            v2TaskDef.acceptanceSignal = newCommand;
          }
          const v2Spec = snapshotData.testSpecs?.find((s: any) => s.taskId === taskId);
          if (v2Spec?.validation?.mode === "command") {
            v2Spec.validation.command = newCommand;
            patched++;
          }
          await atomicWrite(snapshotPath, JSON.stringify(snapshotData, null, 2));
        } catch {}
      }

      if (v2Task && needsHumanResolution) {
        await v2Engine.resolveHumanIntervention(taskId, `Validation command patched via /forge blocker --patch-validation: ${newCommand}`);
      }

      await reconcileFromAuthoritative(ctx);
      if (state) {
        await persistState(ctx, "blocker_patch_validation", { taskId, newCommand, patched, humanResolved: needsHumanResolution });
      }
      ctx.ui.notify(`[task-forge] Validation patched for ${taskId} (${patched} field${patched === 1 ? "" : "s"} updated). Run /forge execute or /forge blocker ${taskId} --retry.`, "success");
      return;
    }

    const flagIndex = raw.indexOf("--resolve");
    const resolution = flagIndex >= 0 ? raw.slice(flagIndex + "--resolve".length).trim().replace(/^['"]|['"]$/g, "") : "";
    if (!resolution) {
      const lines: string[] = [`[task-forge] ${taskId} — ${v2Task?.title ?? task?.title ?? "Unknown task"}`, ""];
      if (v2Runtime) {
        lines.push(`  status: ${v2Runtime.status}`);
        if (v2Runtime.error) lines.push(`  error: ${v2Runtime.error.substring(0, 200)}`);
        if (v2Runtime.retries) lines.push(`  retries: ${v2Runtime.retries}`);
        if (v2Runtime.blocker) {
          lines.push(`  blocker (${v2Runtime.blocker.category}): ${v2Runtime.blocker.reason}`);
          if (v2Runtime.blocker.suggestion) lines.push(`  suggestion: ${v2Runtime.blocker.suggestion}`);
        }
      } else if (task) {
        lines.push(`  status: ${task.status}`);
        if (task.error) lines.push(`  error: ${task.error?.substring(0, 200)}`);
      }

      if (v2Blocker) {
        lines.push("");
        lines.push(`  blocker: ${v2Blocker.reason}`);
        lines.push(`  suggestion: ${v2Blocker.suggestion}`);
        if (v2Blocker.remediation) lines.push(`  remediation: ${v2Blocker.remediation.mode} (${v2Blocker.remediation.category})`);
      }

      if (v2Task) {
        lines.push("");
        lines.push(`  dependencies: ${v2Task.dependencies.length > 0 ? v2Task.dependencies.join(", ") : "none"}`);
        lines.push(`  validation: ${v2Task.validation?.mode ?? "unknown"}${v2Task.validation?.mode === "command" ? ` — ${v2Task.validation.command?.substring(0, 80)}` : ""}`);
        lines.push(`  output: ${v2Task.outputManifest?.join(", ") ?? "(none)"}`);

        const downstream = (effectiveSnapshot?.tasks ?? []).filter((t) => t.dependencies.includes(taskId)).map((t) => t.id);
        if (downstream.length > 0) lines.push(`  downstream: ${downstream.join(", ")}`);
      }

      lines.push("");
      lines.push("Actions:");
      lines.push(`  /forge blocker ${taskId} --resolve "description of fix"`);
      if (v2Runtime?.status === "failed" || v2Runtime?.status === "blocked" || task?.status === "failed" || task?.status === "blocked") {
        lines.push(`  /forge blocker ${taskId} --retry`);
        lines.push(`  /forge blocker ${taskId} --force-unblock`);
      }
      if (v2Task?.validation?.mode === "command") {
        lines.push(`  /forge blocker ${taskId} --patch-validation "new command"`);
      }
      lines.push(`  /forge blocker ${taskId} --diagnostic`);

      ctx.ui.notify(lines.join("\n"), "warning");
      return;
    }

    const resolveResult = resolveBlockerCommandService(effectiveSnapshot, { taskId, resolution });
    if (resolveResult.ok && resolveResult.events.length > 0) {
      await applyCommandEvents(ctx, resolveResult);
    }

    const v2TaskExists = v2Snapshot?.tasks.some((t) => t.id === taskId) || v2Snapshot?.taskState[taskId];
    const contractPatch = deriveBlockerResolutionPatch(resolution);
    if (state && task && contractPatch) {
      const patched = applyBlockerResolutionPatch(taskId, task, state.testSpecs as TestSpecEntry[] | undefined, contractPatch);
      state.testSpecs = patched.testSpecs;
      if (state.testSpecFile) {
        await saveArtifact(ctx, state.testSpecFile, JSON.stringify({ testSpecs: state.testSpecs }, null, 2));
      }
      await persistTaskDefinitions(ctx);
      if (state.testSpecs && state.testSpecFile) {
        await withV2Engine(ctx, (engine) => engine.markTestSpecWritten(state.testSpecFile!, state.testSpecs!, state.testSpecMarkdownFile));
      }
    }

    if (v2TaskExists) {
      await v2Engine.resolveHumanIntervention(taskId, resolution);
    } else if (task) {
      task.resolutionInstruction = resolution;
      task.blocker = undefined;
      task.error = undefined;
      if (task.status === "blocked" || task.status === "failed") task.status = "pending";
      state!.blockers = state!.blockers
        .map((b) => (b.taskId === taskId ? { ...b, resolvedBy: resolution, resolvedAt: nowIso() } : b))
        .filter((b) => b.taskId !== taskId);
      state!.status = "awaiting_approval";
    }

    await reconcileFromAuthoritative(ctx);
    if (state) {
      await persistState(ctx, "blocker_resolved", { taskId, resolution, contractPatched: Boolean(contractPatch) });
    }
    ctx.ui.notify(`[task-forge] Blocker resolved for ${taskId}. Run /forge execute to continue.`, "success");
  }

  pi.registerCommand("forge", {
    description:
      "TaskForge: /forge <prd>, /forge execute, /forge status, /forge blocker <id> --resolve <text>, /forge cost, /forge models",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const trimmed = prefix.trimStart();
      if (!trimmed) return SUBCOMMANDS.map((s) => ({ value: s, label: s }));
      const matches = SUBCOMMANDS.filter((s) => s.startsWith(trimmed)).map((s) => ({ value: s, label: s }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args: string, ctx: any) => {
      config = await loadConfig(ctx.cwd);
      const raw = (args ?? "").trim();
      const parts = raw.split(/\s+/).filter(Boolean);
      const sub = parts[0];

      if (!sub || sub === "status") {
        const snapshot = await loadCommandSnapshot(ctx);
        const result = statusCommandService(snapshot);
        const content = result.ok && result.data
          ? statusSummaryFromV2(snapshot)
          : result.message ?? "[task-forge] No active orchestration";
        sendTaskForgeMessage("task-forge-status", content, ctx, "info");
        return;
      }

      if (sub === "help") {
        const result = helpCommandService();
        sendTaskForgeMessage("task-forge-help", result.data?.commands?.join("\n") ?? "", ctx, "info");
        return;
      }

      if (sub === "config") {
        const result = configCommandService(config);
        sendTaskForgeMessage("task-forge-config", JSON.stringify(result.data?.config ?? config, null, 2), ctx, "info");
        return;
      }

      if (sub === "cost") {
        const snapshot = await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
        const result = costCommandService(snapshot);
        const content = result.ok && result.data
          ? formatCost(result.data.cost)
          : result.message ?? "[task-forge] No active orchestration";
        sendTaskForgeMessage("task-forge-cost", content, ctx, "info");
        return;
      }

      if (sub === "models") {
        const snapshot = await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
        const result = modelsCommandService(snapshot);
        const lines = Object.entries(result.data?.resolvedModels ?? {}).map(([role, model]) => `${role}: ${model}`);
        sendTaskForgeMessage("task-forge-models", lines.join("\n"), ctx, "info");
        return;
      }

      if (sub === "pause") {
        await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
        const snapshot = await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
        const label = snapshot?.currentPhase >= 6 ? "Integration Review (paused)" : "Execution (paused)";
        const result = pauseCommandService(snapshot, { label, reason: "Paused by user command" });
        if (result.ok) {
          const newSnapshot = await applyCommandEvents(ctx, result);
          ctx.ui.setStatus("task-forge", renderStatusFromSnapshot(newSnapshot));
          ctx.ui.notify(result.message ?? "[task-forge] Paused", "info");
        } else {
          ctx.ui.notify(result.message ?? "[task-forge] Nothing is executing", "warning");
        }
        return;
      }

      if (sub === "resume") {
        const snapshot = await loadCommandSnapshot(ctx);
        const result = resumeCommandService(snapshot, { reason: "Resumed by user command" });
        if (!result.ok) {
          ctx.ui.notify(result.message ?? "[task-forge] Not resumable", "warning");
          return;
        }
        await applyCommandEvents(ctx, result);
        startExecutionInBackground(ctx, "resume");
        return;
      }

      if (sub === "abort") {
        await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
        const snapshot = await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
        const result = abortCommandService(snapshot, { reason: "Aborted by user command" });
        if (result.ok) {
          const newSnapshot = await applyCommandEvents(ctx, result);
          ctx.ui.setStatus("task-forge", renderStatusFromSnapshot(newSnapshot));
        }
        runAbortController?.abort();
        ctx.ui.notify(result.message ?? "[task-forge] Aborted", "warning");
        return;
      }

      if (sub === "execute") {
        const snapshot = await loadCommandSnapshot(ctx);
        await handleExecuteCommand(ctx, snapshot, raw);
        return;
      }

      if (sub === "blocker") {
        const snapshot = await loadCommandSnapshot(ctx);
        await handleBlockerCommand(ctx, snapshot, raw, parts);
        return;
      }

      const snapshot = await loadCommandSnapshot(ctx);
      const activeStatus = snapshot?.status ?? "idle";
      if (!isTerminalCommandStatus(activeStatus)) {
        ctx.ui.notify(`[task-forge] Active orchestration already exists (${activeStatus}). Finish or abort it before starting a new run.`, "warning");
        return;
      }

      const executeImmediately = raw.endsWith("--execute");
      const prdFile = executeImmediately ? raw.replace(/\s+--execute\s*$/, "") : raw;
      const hooks = createPlanningHooks(ctx);
      startPlanningInBackgroundV2(ctx, hooks, prdFile, executeImmediately);
      return;
    },
  });

  pi.on("session_start", async (_event: any, ctx: any) => {
    config = await loadConfig(ctx.cwd);

    await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
    const authoritative = await sweepOverdueSupervisors(ctx, await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir));

    const recoveredExecution = describeInterruptedExecution(authoritative);
    if (recoveredExecution) {
      await withV2Engine(ctx, async (engine) => {
        for (const taskId of recoveredExecution.requeuedTaskIds) {
          await engine.requeueTask(taskId, "Recovered after pi restart during active execution");
        }
        await engine.markRunPaused(recoveredExecution.label, recoveredExecution.nextAction, "Recovered after pi restart during active execution");
      });
      await reconcileFromAuthoritative(ctx);
      if (state) {
        await persistState(ctx, "resume_recovered_execution");
      }
    }

    // Planning recovery after execution recovery (FR-12, FR-16)
    if (authoritative) {
      const layout = createLayout(ctx.cwd, config.outputDir);
      const interruptedPlanning = await describeInterruptedPlanning(authoritative, layout);
      if (interruptedPlanning) {
        await withV2Engine(ctx, async (engine) => {
          if (interruptedPlanning.kind === "resumable") {
            // Resumable: emit run_restored with reason='planning_interrupted_resumable', set nextAction='continuePlanning' (FR-13)
            await engine.markRunRestored(authoritative.orchestrationId, "planning_interrupted_resumable");
            await engine.markRunPaused(`Planning interrupted — resumable (phase ${interruptedPlanning.phase})`, "continuePlanning", "Planning was interrupted but can be resumed from the last completed phase");
          } else {
            // Restart-required: emit run_restored with reason='planning_interrupted_restart_required', clear nextAction (FR-14, FR-17)
            await engine.markRunRestored(authoritative.orchestrationId, "planning_interrupted_restart_required");
            await engine.markRunResumed(); // Clears nextAction
          }
        });
        await reconcileFromAuthoritative(ctx);
        if (state) {
          await persistState(ctx, "resume_recovered_planning");
        }
      }
    }

    const refreshed = await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
    ctx.ui.setStatus("task-forge", refreshed ? renderStatusFromSnapshot(refreshed) : "forge:idle");
  });

  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    config = await loadConfig(ctx.cwd);
    runAbortController?.abort();
    await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
    const authoritative = await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
    const interruptedExecution = describeInterruptedExecution(authoritative);
    if (interruptedExecution) {
      await withV2Engine(ctx, async (engine) => {
        for (const taskId of interruptedExecution.requeuedTaskIds) {
          await engine.requeueTask(taskId, "Interrupted because pi exited during active execution");
        }
        await engine.markRunPaused(interruptedExecution.label, interruptedExecution.nextAction, "Interrupted because pi exited during active execution");
      });
      await reconcileFromAuthoritative(ctx);
      if (state) {
        await persistState(ctx, "session_shutdown_interrupted_execution");
      }
    }

    // Best-effort planning interruption detection (hard kills bypass this)
    const planningRoles: Role[] = ["scopeClassifier", "strategist", "planner", "testDesigner"];
    const activePlanningRole = activeAgent?.role;
    if (activePlanningRole && planningRoles.includes(activePlanningRole)) {
      await withV2Engine(ctx, async (engine) => {
        await engine.markPlanningPhaseInterrupted(activePlanningRole, state!.currentPhase);
      });
    }
  });
}
