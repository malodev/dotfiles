/**
 * TaskForge — hierarchical multi-agent orchestration for PRD-driven execution.
 *
 * Adopted from PLAN-1.md:
 * - Strategist → Planner → Approval Gate → Execution → Integration Review
 * - Capability-tier model resolution with fallbacks
 * - Single-pass + iterative worker modes
 * - Gate review per task
 * - Blocker escalation and resume paths
 * - state.json + state.log artifacts for inspectability
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appendEvent as appendV2Event, createLayout, deriveSnapshot as deriveV2Snapshot, loadSnapshot as loadV2Snapshot, readEvents as readV2Events, writeSnapshot as writeV2Snapshot } from "./v2/storage";
import { migrateV1StateToEvents, migrateV1StateToSnapshot } from "./v2/migrate";
import { TaskForgeV2Engine } from "./v2/engine";
import type { RunSnapshot as V2RunSnapshot, RunStatus as V2RunStatus } from "./v2/types";

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
  resolvedModels: Partial<Record<Role, string>>;
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
  timestamps: {
    started: string;
    lastUpdated: string;
    completed?: string;
  };
}

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
  modelTiers: {
    reasoning: [
      "anthropic/claude-opus-4-5",
      "opencode-go/glm-5.1",
      "openai-codex/gpt-5.1",
    ],
    coding: [
      "anthropic/claude-sonnet-4-5",
      "opencode-go/glm-5.1",
      "openai-codex/gpt-5.2-codex",
    ],
    bulk: [
      "openai-codex/gpt-5.1-codex-mini",
      "opencode-go/glm-5",
      "opencode-go/kimi-k2.5",
    ],
    endurance: [
      "opencode-go/glm-5.1",
      "openai-codex/gpt-5.2-codex",
      "anthropic/claude-sonnet-4-5",
    ],
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

function statusLabel(state: ForgeState | null) {
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

function overdueSupervisors(snapshot: V2RunSnapshot | null) {
  if (!snapshot) return [] as Array<V2RunSnapshot["supervisors"][string]>;
  const now = Date.now();
  return Object.values(snapshot.supervisors).filter((supervisor) => {
    const runtime = snapshot.taskState[supervisor.taskId];
    if (!runtime || runtime.status !== "running") return false;
    const deadline = Date.parse(supervisor.watchdogDeadlineAt);
    return Number.isFinite(deadline) && deadline <= now;
  });
}

function statusLabelFromV2(snapshot: V2RunSnapshot | null) {
  if (!snapshot) return "forge:idle";

  const taskState = Object.values(snapshot.taskState);
  const total = snapshot.tasks.length || taskState.length;
  const done = taskState.filter((t) => t.status === "completed").length;
  const running = taskState.filter((t) => t.status === "running").length;
  const blocked = taskState.filter((t) => t.status === "blocked").length;
  const failed = taskState.filter((t) => t.status === "failed").length;
  const overdue = overdueSupervisors(snapshot).length;

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
  return `forge:${statusIcon(snapshot.status)}${snapshot.status}${suffix}`;
}

function statusSummaryFromV2(snapshot: V2RunSnapshot | null) {
  if (!snapshot) return "[task-forge] No active orchestration";

  const taskState = Object.values(snapshot.taskState);
  const overdue = overdueSupervisors(snapshot);
  const counts = {
    ready: taskState.filter((t) => t.status === "ready").length,
    running: taskState.filter((t) => t.status === "running").length,
    completed: taskState.filter((t) => t.status === "completed").length,
    pending: taskState.filter((t) => t.status === "pending").length,
    failed: taskState.filter((t) => t.status === "failed").length,
    blocked: taskState.filter((t) => t.status === "blocked").length,
  };
  const blockerIds = new Set([
    ...snapshot.blockers.filter((b) => !b.resolvedAt).map((b) => b.taskId),
    ...(snapshot.pendingHumanIntervention ? [snapshot.pendingHumanIntervention.taskId] : []),
  ]);

  return [
    `[task-forge] ${statusIcon(snapshot.status)} ${snapshot.status}`,
    `mode: ${snapshot.orchestrationMode ?? "n/a"}`,
    `phase: ${snapshot.phaseLabel}`,
    snapshot.nextAction ? `next action: ${snapshot.nextAction}` : "",
    `prd: ${snapshot.prdFile ?? "n/a"}`,
    `tasks: ${counts.completed}/${snapshot.tasks.length || taskState.length} completed, ${counts.running} running, ${counts.ready} ready, ${counts.pending} pending, ${counts.failed} failed, ${counts.blocked} blocked`,
    overdue.length > 0 ? `overdue supervisors: ${overdue.map((s) => s.taskId).join(", ")}` : "overdue supervisors: none",
    blockerIds.size > 0 ? `blockers: ${Array.from(blockerIds).join(", ")}` : "blockers: none",
  ].filter(Boolean).join("\n");
}

async function ensureV2BootstrappedFromCurrentState(cwd: string, outputDir: string) {
  const layout = createLayout(cwd, outputDir);
  const existingEvents = await readV2Events(layout);
  if (existingEvents.length > 0) return;
  if (!existsSync(layout.snapshotFile)) return;

  try {
    const raw = JSON.parse(await readFile(layout.snapshotFile, "utf-8"));
    if (raw?.schemaVersion === 2) return;
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
  if (storedV2?.schemaVersion === 2) return storedV2;

  if (!existsSync(layout.snapshotFile)) return null;
  try {
    const raw = JSON.parse(await readFile(layout.snapshotFile, "utf-8"));
    if (raw?.schemaVersion === 2) return raw as V2RunSnapshot;
    return migrateV1StateToSnapshot(raw as any);
  } catch {
    return null;
  }
}

function mapV2StatusToV1(status: V2RunStatus): ForgeStatus {
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

function createV1StateFromV2(snapshot: V2RunSnapshot): ForgeState {
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
    });
  }

  return {
    orchestrationId: snapshot.orchestrationId,
    status: mapV2StatusToV1(snapshot.status),
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

function applyAuthoritativeSnapshotToV1(snapshot: V2RunSnapshot) {
  state = createV1StateFromV2(snapshot);
}

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
    applyAuthoritativeSnapshotToV1(authoritative);
    ctx.ui.setStatus("task-forge", statusLabelFromV2(authoritative));
  } else {
    ctx.ui.setStatus("task-forge", statusLabel(state));
  }
  return authoritative;
}

async function loadCommandSnapshot(ctx: any) {
  config = await loadConfig(ctx.cwd);
  await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
  const authoritative = await reconcileFromAuthoritative(ctx);
  return await sweepOverdueSupervisors(ctx, authoritative);
}

function effectiveCommandStatus(authoritative: V2RunSnapshot | null) {
  return authoritative?.status ?? state?.status ?? "idle";
}

function isTerminalCommandStatus(status: V2RunStatus | ForgeStatus | "needs_human_intervention") {
  return ["idle", "completed", "aborted", "failed"].includes(status);
}

function taskListFromAuthoritative(snapshot: V2RunSnapshot | null) {
  if (!snapshot) return state?.tasks ?? [];
  if (state?.orchestrationId === snapshot.orchestrationId) return state.tasks;
  return createV1StateFromV2(snapshot).tasks;
}

function executionFactsFromAuthoritative(snapshot: V2RunSnapshot | null) {
  const tasks = taskListFromAuthoritative(snapshot);
  const ready = tasks.filter((t) => t.status === "ready");
  const running = tasks.filter((t) => t.status === "running");
  const pending = tasks.filter((t) => t.status === "pending");
  const blocked = tasks.filter((t) => t.status === "blocked");
  const failed = tasks.filter((t) => t.status === "failed");
  const unfinished = tasks.filter((t) => !["completed", "failed", "blocked", "skipped"].includes(t.status));
  return { tasks, ready, running, pending, blocked, failed, unfinished };
}

async function syncExecutionSnapshot(ctx: any) {
  const authoritative = await sweepOverdueSupervisors(ctx, await reconcileFromAuthoritative(ctx));
  return {
    authoritative,
    effectiveStatus: effectiveCommandStatus(authoritative),
    ...executionFactsFromAuthoritative(authoritative),
  };
}

async function preflightExecutableTasks(ctx: any, v2Engine: TaskForgeV2Engine) {
  if (!state) return false;

  await syncPendingTaskSchedulingState(ctx);

  const candidates = state.tasks.filter((task) => task.status === "ready");
  let normalizedAnyCommand = false;
  for (const task of candidates) {
    const originalCommand = task.acceptanceSignal || task.testCommand;
    const result = await v2Engine.preflightTask(task as any);
    if (!result.ok) {
      await withV2Engine(ctx, (engine) => engine.markApprovalRequired("executePlan", "Execution (human intervention required)"));
      await reconcileFromAuthoritative(ctx);
      const effectiveTask = state?.tasks.find((candidate) => candidate.id === task.id) ?? task;
      await persistState(ctx, "task_preflight_blocked", { taskId: task.id, blocker: result.blocker?.reason });
      await emitHumanInterventionMessage(ctx, effectiveTask, result.blocker as any);
      return false;
    }

    if (result.normalizedCommand && result.normalizedCommand !== originalCommand) {
      if (task.acceptanceSignal) task.acceptanceSignal = result.normalizedCommand;
      else if (task.testCommand) task.testCommand = result.normalizedCommand;
      normalizedAnyCommand = true;
      await persistState(ctx, "task_acceptance_normalized", { taskId: task.id, command: result.normalizedCommand });
    }
  }

  if (normalizedAnyCommand) {
    await persistTaskDefinitions(ctx);
    await reconcileFromAuthoritative(ctx);
  }

  return true;
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
  let config: TaskForgeConfig = { ...DEFAULT_CONFIG };
  let state: ForgeState | null = null;
  let runAbortController: AbortController | null = null;
  let executionPromise: Promise<void> | null = null;
  const agentCache = new Map<Role, AgentDefinition>();

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
    if (!path) return { ...DEFAULT_CONFIG };
    try {
      const loaded = JSON.parse(await readFile(path, "utf-8")) as Partial<TaskForgeConfig>;
      return deepMergeConfig(DEFAULT_CONFIG, loaded);
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async function persistState(ctx: any, event: string, details?: Record<string, unknown>) {
    if (!state) return;
    state.timestamps.lastUpdated = nowIso();
    pi.appendEntry(STATE_ENTRY_TYPE, state);
    await ensureDir(outputPath(ctx.cwd));
    await atomicWrite(outputPath(ctx.cwd, "state.json"), JSON.stringify(state, null, 2));
    await appendFile(
      outputPath(ctx.cwd, "state.log"),
      `${JSON.stringify({ time: nowIso(), event, details: details ?? {}, status: state.status })}\n`,
      "utf-8"
    );
    const authoritative = await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
    ctx.ui.setStatus("task-forge", authoritative ? statusLabelFromV2(authoritative) : statusLabel(state));
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

  function failedDependencies(task: ForgeTask) {
    return task.dependencies.filter((dep) => {
      const status = state?.tasks.find((t) => t.id === dep)?.status;
      return status === "failed" || status === "blocked";
    });
  }

  function createDependencyBlocker(task: ForgeTask, blockingDeps: string[]): Blocker {
    return {
      taskId: task.id,
      reason: `Blocked by failed dependency: ${blockingDeps.join(", ")}`,
      suggestion: `Resolve the upstream dependency task${blockingDeps.length > 1 ? "s" : ""} (${blockingDeps.join(", ")}) and then rerun /forge execute.`,
      blockedTasks: [task.id, ...blockingDeps],
    };
  }

  async function persistTaskDefinitions(ctx: any) {
    if (!state) return;
    if (state.tasksFile) {
      await saveArtifact(ctx, state.tasksFile, JSON.stringify({ tasks: state.tasks, costEstimate: state.cost }, null, 2));
    }
    await withV2Engine(ctx, (engine) => engine.registerTasks(state!.tasks as any));
  }

  async function syncPendingTaskSchedulingState(ctx: any) {
    if (!state) return { changed: false, readyPromoted: false, dependencyBlocked: false };

    let changed = false;
    let readyPromoted = false;
    let dependencyBlocked = false;

    for (const task of state.tasks) {
      if (task.status !== "pending") continue;

      const blockingDeps = failedDependencies(task);
      if (blockingDeps.length > 0) {
        dependencyBlocked = true;
        changed = true;
        const blocker = createDependencyBlocker(task, blockingDeps);
        await withV2Engine(ctx, (engine) => engine.markTaskBlocked(task.id, blocker));
        continue;
      }

      if (dependenciesResolved(task)) {
        readyPromoted = true;
        changed = true;
        await withV2Engine(ctx, (engine) => engine.markTaskReady(task.id));
      }
    }

    if (changed) {
      await reconcileFromAuthoritative(ctx);
      await persistTaskDefinitions(ctx);
      await persistState(ctx, "task_scheduling_state_synced", { readyPromoted, dependencyBlocked });
    }

    return { changed, readyPromoted, dependencyBlocked };
  }

  async function emitHumanInterventionMessage(ctx: any, task: ForgeTask, blocker: Blocker, heading = "Human intervention required") {
    const content = [
      `[task-forge] ${heading}`,
      `task: ${task.id} — ${task.title}`,
      `reason: ${blocker.reason}`,
      `suggestion: ${blocker.suggestion}`,
      task.error ? `evidence: ${task.error}` : "",
      `next: /forge blocker ${task.id} --resolve "..." then /forge execute`,
    ].filter(Boolean).join("\n");

    pi.sendMessage(
      {
        customType: "task-forge-human-help",
        content,
        display: true,
      },
      { triggerTurn: false },
    );
    ctx.ui.notify(`[task-forge] ${heading}: ${task.id}`, "warning");
  }

  async function sweepOverdueSupervisors(ctx: any, authoritative?: V2RunSnapshot | null) {
    const snapshot = authoritative ?? await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
    if (!snapshot) return snapshot;

    const now = Date.now();
    const overdue = Object.values(snapshot.supervisors).filter((supervisor) => {
      const runtime = snapshot.taskState[supervisor.taskId];
      if (!runtime || runtime.status !== "running") return false;
      const deadline = Date.parse(supervisor.watchdogDeadlineAt);
      return Number.isFinite(deadline) && deadline <= now;
    });

    if (overdue.length === 0) return snapshot;

    for (const supervisor of overdue) {
      const meta = snapshot.tasks.find((task) => task.id === supervisor.taskId);
      const runtime = snapshot.taskState[supervisor.taskId];
      const taskForMessage = state?.tasks.find((task) => task.id === supervisor.taskId) ?? {
        ...(meta ?? {
          id: supervisor.taskId,
          title: supervisor.taskId,
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
      const blocker = createHumanInterventionBlocker(
        taskForMessage,
        "Task execution appears stalled",
        "Inspect the task output, container logs, and validation environment. If the task is genuinely stuck, resolve the blocker with the needed human action, then rerun /forge execute.",
      );

      if (!runtime?.stallWarnedAt) {
        const warnedAt = nowIso();
        await withV2Engine(ctx, (engine) => engine.markTaskRuntime(supervisor.taskId, { stallWarnedAt: warnedAt }));
        if (state) {
          const liveTask = state.tasks.find((task) => task.id === supervisor.taskId);
          if (liveTask) {
            liveTask.stallWarnedAt = warnedAt;
          }
          await persistState(ctx, "task_supervisor_overdue", { taskId: supervisor.taskId, watchdogDeadlineAt: supervisor.watchdogDeadlineAt });
        }
        await emitHumanInterventionMessage(ctx, taskForMessage, blocker, "Execution stall detected");
        continue;
      }

      const warnedAt = Date.parse(runtime.stallWarnedAt);
      const alreadyRequestedHumanHelp = snapshot.pendingHumanIntervention?.taskId === supervisor.taskId;
      if (!alreadyRequestedHumanHelp && Number.isFinite(warnedAt) && now - warnedAt >= TASK_STALL_ESCALATION_MS) {
        await withV2Engine(ctx, async (engine) => {
          await engine.markTaskBlocked(supervisor.taskId, blocker);
          await engine.requestHumanIntervention(supervisor.taskId, blocker.reason, blocker.suggestion);
          await engine.markApprovalRequired("executePlan", "Execution (human intervention required)");
        });
        await reconcileFromAuthoritative(ctx);
        if (state) {
          await persistState(ctx, "task_supervisor_escalated", { taskId: supervisor.taskId, watchdogDeadlineAt: supervisor.watchdogDeadlineAt });
        }
        const effectiveTask = state?.tasks.find((task) => task.id === supervisor.taskId) ?? taskForMessage;
        await emitHumanInterventionMessage(ctx, effectiveTask, blocker, "Execution stall escalated");
      }
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

  async function executeTaskWithWatchdog(ctx: any, task: ForgeTask) {
    const timer = setInterval(() => {
      void sweepOverdueSupervisors(ctx);
    }, TASK_SUPERVISOR_SWEEP_MS);

    try {
      await executeTask(ctx, task);
    } finally {
      clearInterval(timer);
    }
  }

  function describeInterruptedExecution(authoritative: V2RunSnapshot | null): { label: string; nextAction: "executePlan"; requeuedTaskIds: string[] } | null {
    const authoritativeRunning = authoritative
      ? Object.values(authoritative.taskState)
          .filter((task) => task.status === "running")
          .map((task) => task.taskId)
      : [];
    const authoritativeWasActive = authoritative
      ? authoritative.status === "executing" || authoritative.status === "reviewing" || authoritativeRunning.length > 0
      : false;

    if (authoritativeWasActive) {
      return {
        label: authoritative.currentPhase >= 6 ? "Integration Review (interrupted)" : "Execution (interrupted)",
        nextAction: "executePlan",
        requeuedTaskIds: authoritativeRunning,
      };
    }

    if (!state) return null;

    const localRunning = state.tasks.filter((task) => task.status === "running").map((task) => task.id);
    const localWasActive = state.status === "executing" || state.status === "reviewing" || localRunning.length > 0;
    if (!localWasActive) return null;

    return {
      label: state.currentPhase >= 6 ? "Integration Review (interrupted)" : "Execution (interrupted)",
      nextAction: "executePlan",
      requeuedTaskIds: localRunning,
    };
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

  async function resolveModelForRole(ctx: any, role: Role): Promise<string> {
    const explicit = config.modelOverrides[role];
    if (explicit) {
      state?.resolvedModels && (state.resolvedModels[role] = explicit);
      return explicit;
    }

    const available = await getAvailableModelRefs(ctx);
    const tier = config.roleAssignment[role];
    for (const ref of config.modelTiers[tier]) {
      if (available.size === 0 || available.has(ref)) {
        state?.resolvedModels && (state.resolvedModels[role] = ref);
        return ref;
      }
    }
    const fallback = config.modelTiers[tier][0];
    state?.resolvedModels && (state.resolvedModels[role] = fallback);
    return fallback;
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
    const model = await resolveModelForRole(ctx, options?.modelRole ?? role);
    const promptFile = await writeTempPrompt(ctx, role, promptContent);
    const systemPrompt = options?.promptAppendix
      ? `${agent.systemPrompt}\n\n## Runtime Instructions\n${options.promptAppendix}`
      : agent.systemPrompt;
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

    if (result.killed) throw new Error(`${role} aborted`);
    if (result.code !== 0) throw new Error(`${role} failed: ${result.stderr || result.stdout}`);
    return result.stdout.trim();
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

  function coerceTask(raw: any, index: number): ForgeTask {
    const taskMode: TaskMode = raw.task_mode === "iterative" ? "iterative" : "single-pass";
    const complexity = raw.complexity === "L" || raw.complexity === "S" ? raw.complexity : "M";
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
      testCommand: raw.test_command,
      acceptanceSignal: raw.acceptance_signal,
      coverageThreshold: raw.coverage_threshold,
      testSpecRefs: raw.test_spec_refs ?? [],
      status: "pending",
      retries: 0,
    };
  }

  async function initState(ctx: any, prdFile: string) {
    config = await loadConfig(ctx.cwd);
    const prdPath = resolve(ctx.cwd, prdFile);
    if (!existsSync(prdPath)) throw new Error(`PRD file not found: ${prdFile}`);

    ensureRunAbortController();
    state = {
      orchestrationId: genId(),
      status: "planning",
      currentPhase: 0,
      phaseLabel: "Scope Classification",
      prdFile,
      resolvedModels: {},
      cost: {},
      blockers: [],
      tasks: [],
      timestamps: {
        started: nowIso(),
        lastUpdated: nowIso(),
      },
    };

    await ensureDir(outputPath(ctx.cwd));
    await ensureDir(outputPath(ctx.cwd, "tasks"));
    await ensureDir(outputPath(ctx.cwd, "tmp"));
    await persistState(ctx, "init", { prdFile });
    await withV2Engine(ctx, async (engine) => {
      await engine.createRun(state!.orchestrationId, prdFile);
      await engine.enterPhase(0, "Scope Classification");
    });
  }

  async function phaseClassifyScope(ctx: any) {
    if (!state?.prdFile) throw new Error("No PRD selected");

    state.status = "planning";
    state.currentPhase = 0;
    state.phaseLabel = "Scope Classification";
    await persistState(ctx, "phase_start", { phase: 0 });
    await withV2Engine(ctx, (engine) => engine.enterPhase(0, "Scope Classification"));

    const prdContent = await readFile(resolve(ctx.cwd, state.prdFile), "utf-8");
    const tree = await gatherCodebaseSummary(ctx);

    const prompt = [
      "# Goal",
      "Classify this work as micro, standard, or complex.",
      "",
      "# Return format",
      '{ "mode": "micro|standard|complex", "estimatedTasks": number, "rationale": string, "signals": string[] }',
      "",
      "# Existing codebase file tree",
      tree || "(none)",
      "",
      "# PRD",
      prdContent,
    ].join("\n");

    const raw = await spawnAgent(ctx, "scopeClassifier", prompt, {
      promptAppendix: "Return one JSON object in a ```json fenced block only.",
      timeout: 600,
    });
    const parsed = extractJson(raw) ?? {};
    const mode = parsed.mode === "micro" || parsed.mode === "complex" ? parsed.mode : "standard";
    state.orchestrationMode = mode;
    state.routingRationale = typeof parsed.rationale === "string" ? parsed.rationale : undefined;
    await saveArtifact(ctx, "00-routing.json", JSON.stringify(parsed, null, 2));
    await persistState(ctx, "phase_complete", { phase: 0, mode });
    await withV2Engine(ctx, (engine) => engine.markRouting(mode, state?.routingRationale));
    ctx.ui.notify(`[task-forge] Routing mode: ${mode}${state.routingRationale ? ` — ${state.routingRationale}` : ""}`, "info");
  }

  async function phaseAnalyze(ctx: any) {
    if (!state?.prdFile) throw new Error("No PRD selected");

    state.status = "analyzing";
    state.currentPhase = 1;
    state.phaseLabel = "PRD Analysis";
    await persistState(ctx, "phase_start", { phase: 1 });
    await withV2Engine(ctx, (engine) => engine.enterPhase(1, "PRD Analysis"));

    const prdContent = await readFile(resolve(ctx.cwd, state.prdFile), "utf-8");
    const tree = await gatherCodebaseSummary(ctx);

    const prompt = [
      "# Goal",
      "Produce 01-requirements.md.",
      "",
      "# Required sections",
      "- Executive summary",
      "- Core objectives",
      "- User stories",
      "- Functional requirements (must/should/could)",
      "- Non-functional requirements",
      "- UI / UX Constraints and Design System Requirements",
      "- Constraints and assumptions",
      "- Success metrics",
      "- Risks and dependencies",
      "- Ambiguities and open questions",
      "",
      "# Special instruction",
      "If the PRD contains a UI kit, design system, component catalog, style guide, interaction rules, layout rules, visual tokens, or accessibility section, preserve it as a first-class requirements section. Do not collapse it into a generic note.",
      "",
      "# Existing codebase file tree",
      tree || "(none)",
      "",
      "# PRD",
      prdContent,
    ].join("\n");

    const requirements = await spawnAgent(ctx, "strategist", prompt, {
      promptAppendix: "Return Markdown only.",
      timeout: 900,
    });
    await saveArtifact(ctx, "01-requirements.md", requirements);
    state.requirementsFile = "01-requirements.md";
    await persistState(ctx, "phase_complete", { phase: 1 });
    await withV2Engine(ctx, (engine) => engine.markRequirementsWritten("01-requirements.md"));
    ctx.ui.notify("[task-forge] Phase 1 complete: requirements written", "success");
  }

  async function phasePlanMicro(ctx: any) {
    if (!state?.prdFile) throw new Error("Missing PRD for micro planning");

    state.status = "planning";
    state.currentPhase = 2;
    state.phaseLabel = "Micro Planning";
    await persistState(ctx, "phase_start", { phase: 2, mode: "micro" });
    await withV2Engine(ctx, (engine) => engine.enterPhase(2, "Micro Planning"));

    const prdContent = await readFile(resolve(ctx.cwd, state.prdFile), "utf-8");
    const tree = await gatherCodebaseSummary(ctx);

    const prompt = [
      "# Goal",
      "Handle this as MICRO mode: merge strategist and planner behavior into one compact planning pass.",
      "Produce at most 3 tasks unless the PRD absolutely requires more.",
      "Skip heavyweight orchestration assumptions.",
      "",
      "# Output schema",
      "Return a single JSON object with keys:",
      "- planMarkdown: string",
      "- tasksMarkdown: string",
      "- costEstimate: { totalInputTokens, totalOutputTokens, iterativeBudgetTokens, estimatedUsd }",
      "- tasks: ForgeTask[] using planner schema",
      "",
      "# Existing codebase file tree",
      tree || "(none)",
      "",
      "# PRD",
      prdContent,
    ].join("\n");

    const raw = await spawnAgent(ctx, "planner", prompt, {
      promptAppendix: "Treat this as micro mode. Inline requirement analysis and planning. Return one JSON object in a ```json fenced block only.",
      timeout: 900,
    });
    const parsed = extractJson(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      throw new Error("Planner did not return valid task JSON for micro mode");
    }

    state.tasks = parsed.tasks.map(coerceTask);
    state.cost = parsed.costEstimate ?? {};
    const planMarkdown = typeof parsed.planMarkdown === "string" ? parsed.planMarkdown : "# Micro Plan\n\nNo plan markdown returned.";
    const tasksMarkdown = typeof parsed.tasksMarkdown === "string" ? parsed.tasksMarkdown : tasksToMarkdown(state.tasks);

    await saveArtifact(ctx, "02-plan.md", planMarkdown);
    await saveArtifact(ctx, "03-tasks.json", JSON.stringify({ tasks: state.tasks, costEstimate: state.cost }, null, 2));
    await saveArtifact(ctx, "03-tasks.md", tasksMarkdown);
    await saveArtifact(ctx, "03-cost-estimate.md", formatCost(state.cost));

    state.planFile = "02-plan.md";
    state.tasksFile = "03-tasks.json";
    state.tasksMarkdownFile = "03-tasks.md";
    state.costFile = "03-cost-estimate.md";
    state.status = "awaiting_approval";
    state.currentPhase = 4;
    state.phaseLabel = "Approval Gate";
    state.nextAction = "executePlan";
    await persistState(ctx, "phase_complete", { phase: 2, mode: "micro", awaitingApproval: true });
    await withV2Engine(ctx, async (engine) => {
      await engine.markPlanWritten("02-plan.md", "03-tasks.json", "03-tasks.md", "03-cost-estimate.md");
      await engine.registerTasks(state!.tasks as any);
      await engine.requireApproval("executePlan", "Approval Gate");
    });
    ctx.ui.notify("[task-forge] Micro plan ready. Review artifacts, then run /forge execute", "success");
  }

  async function phasePlan(ctx: any) {
    if (!state?.requirementsFile) throw new Error("Missing requirements artifact");

    state.status = "planning";
    state.currentPhase = 2;
    state.phaseLabel = "Planning & Decomposition";
    await persistState(ctx, "phase_start", { phase: 2 });
    await withV2Engine(ctx, (engine) => engine.enterPhase(2, "Planning & Decomposition"));

    const requirements = await readArtifactMaybe(ctx, state.requirementsFile);
    const originalPrd = state.prdFile ? await readFile(resolve(ctx.cwd, state.prdFile), "utf-8") : "";
    const tree = await gatherCodebaseSummary(ctx);

    const prompt = [
      "# Goal",
      "Produce architecture + tasks for implementation.",
      "",
      "# Output schema",
      "Return a single JSON object with keys:",
      "- planMarkdown: string",
      "- tasksMarkdown: string",
      "- costEstimate: { totalInputTokens, totalOutputTokens, iterativeBudgetTokens, estimatedUsd }",
      "- tasks: ForgeTask[] using planner schema",
      "",
      "# Task rules",
      "- Use task_mode: single-pass or iterative",
      "- iterative only when compile/test/fix loops or measurable targets justify it",
      "- include context_manifest, output_manifest, dependencies, acceptance_criteria, escalation_triggers",
      "- keep tasks small enough for context budgets",
      "- use S/M/L complexity",
      "",
      "# Existing codebase file tree",
      tree || "(none)",
      "",
      "# Requirements",
      requirements,
      "",
      "# Original PRD",
      originalPrd,
    ].join("\n");

    const raw = await spawnAgent(ctx, "planner", prompt, {
      promptAppendix: "Return one JSON object in a ```json fenced block only.",
      timeout: 1200,
    });
    const parsed = extractJson(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      throw new Error("Planner did not return valid task JSON");
    }

    state.tasks = parsed.tasks.map(coerceTask);
    state.cost = parsed.costEstimate ?? {};

    const planMarkdown = typeof parsed.planMarkdown === "string" ? parsed.planMarkdown : "# Plan\n\nNo plan markdown returned.";
    const tasksMarkdown = typeof parsed.tasksMarkdown === "string" ? parsed.tasksMarkdown : tasksToMarkdown(state.tasks);

    await saveArtifact(ctx, "02-plan.md", planMarkdown);
    await saveArtifact(ctx, "03-tasks.json", JSON.stringify({ tasks: state.tasks, costEstimate: state.cost }, null, 2));
    await saveArtifact(ctx, "03-tasks.md", tasksMarkdown);
    await saveArtifact(ctx, "03-cost-estimate.md", formatCost(state.cost));

    state.planFile = "02-plan.md";
    state.tasksFile = "03-tasks.json";
    state.tasksMarkdownFile = "03-tasks.md";
    state.costFile = "03-cost-estimate.md";
    await withV2Engine(ctx, async (engine) => {
      await engine.markPlanWritten("02-plan.md", "03-tasks.json", "03-tasks.md", "03-cost-estimate.md");
      await engine.registerTasks(state!.tasks as any);
    });

    if (state.cost.estimatedUsd !== undefined && state.cost.estimatedUsd > config.costLimitUsd) {
      ctx.ui.notify(
        `[task-forge] Warning: estimated cost $${state.cost.estimatedUsd.toFixed(2)} exceeds configured limit $${config.costLimitUsd.toFixed(2)}`,
        "warning",
      );
    }

    await phaseDesignTests(ctx);
  }

  async function phaseDesignTests(ctx: any) {
    if (!state?.requirementsFile || !state?.planFile || !state?.tasksFile) {
      throw new Error("Missing planning artifacts for test design");
    }

    state.status = "planning";
    state.currentPhase = 3;
    state.phaseLabel = "Test Design";
    await persistState(ctx, "phase_start", { phase: 3 });
    await withV2Engine(ctx, (engine) => engine.enterPhase(3, "Test Design"));

    const requirements = await readArtifactMaybe(ctx, state.requirementsFile);
    const originalPrd = state.prdFile ? await readFile(resolve(ctx.cwd, state.prdFile), "utf-8") : "";
    const plan = await readArtifactMaybe(ctx, state.planFile);
    const tasksJson = await readArtifactMaybe(ctx, state.tasksFile);
    const tree = await gatherCodebaseSummary(ctx);

    const prompt = [
      "# Goal",
      "Design grounded pre-implementation tests without inventing internal APIs.",
      "",
      "# Required output",
      "Return one JSON object with:",
      "- testSpecs: array of per-task grounded test contracts",
      "- markdownSummary: string",
      "",
      "Each testSpecs entry should use:",
      '{ "taskId": string, "testFiles": [{"path": string, "type": string, "targets": string[], "fixtures_required": string[], "derived_from": string[] }], "acceptance_signal": string, "coverage_threshold": number, "ambiguities": string[] }',
      "",
      "Only design tests grounded in explicit planner commitments, acceptance criteria, or existing codebase/test interfaces.",
      "",
      "# Existing codebase file tree",
      tree || "(none)",
      "",
      "# Requirements",
      requirements,
      "",
      "# Original PRD",
      originalPrd,
      "",
      "# Plan",
      plan,
      "",
      "# Tasks JSON",
      tasksJson,
    ].join("\n");

    const raw = await spawnAgent(ctx, "testDesigner", prompt, {
      promptAppendix: "Return one JSON object in a ```json fenced block only.",
      timeout: 1200,
    });

    const parsed = extractJson(raw);
    if (!parsed || !Array.isArray(parsed.testSpecs)) {
      throw new Error("Test Designer did not return valid test spec JSON");
    }

    state.testSpecs = parsed.testSpecs as TestSpecEntry[];

    for (const spec of state.testSpecs) {
      const task = state.tasks.find((t) => t.id === spec.taskId);
      if (!task) continue;
      task.acceptanceSignal = spec.acceptance_signal || task.acceptanceSignal;
      task.coverageThreshold = typeof spec.coverage_threshold === "number" ? spec.coverage_threshold : task.coverageThreshold;
      task.testSpecRefs = (spec.testFiles ?? []).map((f) => f.path);
    }

    await saveArtifact(ctx, "03-test-spec.json", JSON.stringify({ testSpecs: state.testSpecs }, null, 2));
    if (typeof parsed.markdownSummary === "string") {
      await saveArtifact(ctx, "03-test-spec.md", parsed.markdownSummary);
      state.testSpecMarkdownFile = "03-test-spec.md";
    }
    await saveArtifact(ctx, "03-tasks.json", JSON.stringify({ tasks: state.tasks, costEstimate: state.cost }, null, 2));

    state.testSpecFile = "03-test-spec.json";
    state.status = "awaiting_approval";
    state.currentPhase = 4;
    state.phaseLabel = "Approval Gate";
    state.nextAction = "executePlan";
    await persistState(ctx, "phase_complete", { phase: 3, awaitingApproval: true });
    await withV2Engine(ctx, async (engine) => {
      await engine.markTestSpecWritten("03-test-spec.json", state!.testSpecs ?? [], state!.testSpecMarkdownFile);
      await engine.registerTasks(state!.tasks as any);
      await engine.requireApproval("executePlan", "Approval Gate");
    });
    ctx.ui.notify("[task-forge] Plan and grounded test spec ready. Review artifacts, then run /forge execute", "success");
  }

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

  function requiresStrongGateReview(task: ForgeTask) {
    return task.taskMode === "iterative" || Boolean(task.coverageThreshold) || Boolean(task.acceptanceSignal) || Boolean(task.testSpecRefs?.length);
  }

  function needsDiagnosticReview(task: ForgeTask) {
    return Boolean(task.testCommand || task.acceptanceSignal || task.coverageThreshold || task.testSpecRefs?.length);
  }

  function normalizeValidationCommand(command?: string): string | undefined {
    if (!command) return undefined;
    let normalized = command.trim();
    normalized = normalized.replace(/\s+exits?\s+0\s*$/i, "");
    normalized = normalized.replace(/\s+returns?\s+0\s*$/i, "");
    normalized = normalized.replace(/^command:\s*/i, "");
    return normalized.trim() || undefined;
  }

  function detectValidationFramework(command: string, output: string): string {
    const haystack = `${command}\n${output}`.toLowerCase();
    if (haystack.includes("pytest") || haystack.includes("coverage.py") || haystack.includes("pytest-cov")) return "pytest";
    if (haystack.includes("vitest")) return "vitest";
    if (haystack.includes("jest") || haystack.includes("istanbul") || haystack.includes("nyc")) return "jest";
    if (haystack.includes("go test") || /coverage:\s*\d+(?:\.\d+)?%\s+of\s+statements/i.test(output)) return "go";
    if (haystack.includes("cargo llvm-cov") || haystack.includes("llvm-cov")) return "cargo-llvm-cov";
    if (haystack.includes("tarpaulin")) return "tarpaulin";
    if (haystack.includes("cargo test")) return "cargo";
    return "generic";
  }

  function lastCoverageMatch(output: string, pattern: RegExp): number | undefined {
    const values = [...output.matchAll(pattern)]
      .map((m) => Number(m[1]))
      .filter((n) => !Number.isNaN(n));
    return values.length > 0 ? values[values.length - 1] : undefined;
  }

  function extractCoverageWithFramework(output: string, framework: string): number | undefined {
    switch (framework) {
      case "pytest":
        return (
          lastCoverageMatch(output, /TOTAL\s+\d+\s+\d+\s+(\d+(?:\.\d+)?)%/g) ??
          lastCoverageMatch(output, /coverage[^\n]*?(\d+(?:\.\d+)?)%/gi)
        );
      case "vitest":
      case "jest":
        return (
          lastCoverageMatch(output, /All files[^\n]*?\|[^\n]*?\|[^\n]*?\|[^\n]*?\|\s*(\d+(?:\.\d+)?)\s*\|/g) ??
          lastCoverageMatch(output, /Lines\s*:\s*(\d+(?:\.\d+)?)%/gi) ??
          lastCoverageMatch(output, /Statements\s*:\s*(\d+(?:\.\d+)?)%/gi) ??
          lastCoverageMatch(output, /All files[^\n]*?(\d+(?:\.\d+)?)\s*%/g)
        );
      case "go":
        return lastCoverageMatch(output, /coverage:\s*(\d+(?:\.\d+)?)%\s+of\s+statements/gi);
      case "cargo-llvm-cov":
        return (
          lastCoverageMatch(output, /total:\s*\(statements\)\s*(\d+(?:\.\d+)?)%/gi) ??
          lastCoverageMatch(output, /TOTAL(?:\s+COVERAGE)?[^\n]*?(\d+(?:\.\d+)?)%/gi)
        );
      case "tarpaulin":
        return (
          lastCoverageMatch(output, /coverage[^\n]*?(\d+(?:\.\d+)?)%/gi) ??
          lastCoverageMatch(output, /(\d+(?:\.\d+)?)%\s+coverage/gi)
        );
      default:
        return undefined;
    }
  }

  function extractCoverage(output: string, framework: string): number | undefined {
    const frameworkSpecific = extractCoverageWithFramework(output, framework);
    if (frameworkSpecific !== undefined) return frameworkSpecific;

    const patterns: RegExp[] = [
      /Statements\s*:\s*(\d+(?:\.\d+)?)%/gi,
      /Lines\s*:\s*(\d+(?:\.\d+)?)%/gi,
      /Branches\s*:\s*(\d+(?:\.\d+)?)%/gi,
      /Functions\s*:\s*(\d+(?:\.\d+)?)%/gi,
      /coverage:\s*(\d+(?:\.\d+)?)%/gi,
      /TOTAL COVERAGE:\s*(\d+(?:\.\d+)?)%/gi,
      /overall\s+coverage[^\n]*?(\d+(?:\.\d+)?)%/gi,
      /total[^\n]*?coverage[^\n]*?(\d+(?:\.\d+)?)%/gi,
    ];

    for (const pattern of patterns) {
      const value = lastCoverageMatch(output, pattern);
      if (value !== undefined) return value;
    }

    const genericPercentages = [...output.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
      .map((m) => Number(m[1]))
      .filter((n) => !Number.isNaN(n) && n >= 0 && n <= 100);
    return genericPercentages.length > 0 ? genericPercentages[genericPercentages.length - 1] : undefined;
  }

  async function runValidation(ctx: any, task: ForgeTask): Promise<{ passed: boolean; output: string; coverage?: number }> {
    const command = normalizeValidationCommand(task.testCommand || task.acceptanceSignal);
    if (!command) {
      task.validationOutput = "No validation command configured.";
      task.validationFramework = undefined;
      task.lastCoverage = undefined;
      return { passed: true, output: task.validationOutput };
    }

    const result = await pi.exec(
      "bash",
      ["-lc", command],
      { cwd: ctx.cwd, signal: runAbortController?.signal, timeout: seconds(900) } as any,
    );

    let output = [
      `$ ${command}`,
      `exit: ${result.code}`,
      result.stdout || "",
      result.stderr || "",
    ].filter(Boolean).join("\n");

    const framework = detectValidationFramework(command, output);
    const coverage = extractCoverage(output, framework);
    let passed = result.code === 0;
    output += `\n[task-forge] validation framework: ${framework}`;
    if (task.coverageThreshold !== undefined) {
      if (coverage === undefined) {
        passed = false;
        output += `\n[task-forge] coverage threshold ${task.coverageThreshold}% configured, but no coverage value could be parsed from validation output.`;
      } else if (coverage < task.coverageThreshold) {
        passed = false;
        output += `\n[task-forge] coverage ${coverage}% is below threshold ${task.coverageThreshold}%.`;
      }
    }

    task.validationOutput = output;
    task.validationFramework = framework;
    task.lastCoverage = coverage;
    return { passed, output, coverage };
  }

  async function diagnoseTaskFailure(ctx: any, task: ForgeTask) {
    const prompt = [
      "# Diagnose task failure",
      `Task: ${task.id} — ${task.title}`,
      `Mode: ${task.taskMode}`,
      "",
      "## Requirement/Acceptance Context",
      ...task.acceptanceCriteria.map((x) => `- ${x}`),
      "",
      "## Test Spec",
      JSON.stringify(state?.testSpecs?.find((spec) => spec.taskId === task.id) ?? {}, null, 2),
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
      "Return one JSON object:",
      '{ "classification": "implementation_error" | "test_spec_error" | "requirement_or_plan_error", "notes": string, "rewrittenTestSpec": object | null, "blocker": {"reason": string, "suggestion": string, "blockedTasks": [] } | null }',
    ].join("\n");

    const raw = await spawnAgent(ctx, "diagnosticReviewer", prompt, {
      promptAppendix: "Classify the root cause. If the test spec is wrong, provide a rewritten grounded test spec for this task only. Return one JSON object in a ```json fenced block only.",
      timeout: 900,
    });
    return extractJson(raw);
  }

  async function gateReviewTask(ctx: any, task: ForgeTask): Promise<{ passed: boolean; notes: string; blocker?: Blocker }> {
    const prompt = [
      "# Validate task result",
      `Task: ${task.id} — ${task.title}`,
      `Mode: ${task.taskMode}`,
      "",
      "## Acceptance Criteria",
      ...task.acceptanceCriteria.map((x) => `- ${x}`),
      "",
      "## Output Manifest",
      ...(task.outputManifest.length ? task.outputManifest.map((x) => `- ${x}`) : ["- none specified"]),
      "",
      "## Acceptance Signal",
      task.acceptanceSignal || task.testCommand || "none",
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

    const raw = await spawnAgent(ctx, "gateReviewer", prompt, {
      promptAppendix: "Return one JSON object in a ```json fenced block only.",
      timeout: 600,
      modelRole: requiresStrongGateReview(task) ? "integrationReviewer" : "gateReviewer",
    });
    const parsed = extractJson(raw);
    if (!parsed) return { passed: true, notes: "Gate reviewer returned unparsable output; passing conservatively." };

    const blocker = parsed.blocker
      ? {
          taskId: task.id,
          reason: parsed.blocker.reason || "Blocked",
          suggestion: parsed.blocker.suggestion || "Needs user guidance",
          blockedTasks: Array.isArray(parsed.blocker.blockedTasks) ? parsed.blocker.blockedTasks : [],
        }
      : undefined;

    return {
      passed: Boolean(parsed.passed),
      notes: String(parsed.notes ?? ""),
      blocker,
    };
  }

  async function runSinglePassTask(ctx: any, task: ForgeTask) {
    const prompt = await buildTaskContext(ctx, task);
    return await spawnAgent(ctx, "worker", prompt, {
      promptAppendix: "Return a concise implementation report.",
      timeout: 1800,
    });
  }

  async function runIterativeTask(ctx: any, task: ForgeTask) {
    const budget = Math.min(task.turnBudget ?? config.defaultTurnBudget, config.maxTurnBudget);
    const validationCommand = normalizeValidationCommand(task.testCommand || task.acceptanceSignal);
    if (!validationCommand) {
      throw new Error("Iterative task requires testCommand or acceptanceSignal for orchestrator-level TDD enforcement");
    }

    let previousFeedback = "";
    let latestResult = "";
    task.tddPhase = task.tddPhase ?? "red";

    for (let turn = 0; turn < budget; turn++) {
      const phaseInstructions: Record<Exclude<TddPhase, "complete">, string> = {
        red: "You are in RED. Your goal is to establish a failing test or failing validation signal. Do not aim for passing validation yet. If validation passes, the red phase has failed and you must correct the test setup.",
        green: "You are in GREEN. Make the smallest implementation change required to turn validation green. Do not refactor yet.",
        refactor: "You are in REFACTOR. Improve structure without changing behavior. Validation must remain green after this step.",
      };

      const prompt = [
        await buildTaskContext(ctx, task),
        `## Iteration\n${turn + 1}/${budget}`,
        `## TDD Phase\n${task.tddPhase}`,
        `## Phase Instructions\n${phaseInstructions[task.tddPhase as Exclude<TddPhase, "complete">]}`,
        `## Validation Command\n${validationCommand}`,
        previousFeedback ? `## Previous Feedback\n${previousFeedback}` : "",
      ].filter(Boolean).join("\n\n");

      latestResult = await spawnAgent(ctx, "workerIterative", prompt, {
        promptAppendix: `Return a concise iteration report. You are currently in TDD phase: ${task.tddPhase}.`,
        timeout: 1800,
      });
      task.iterationCount = turn + 1;
      task.result = latestResult;
      await withV2Engine(ctx, async (engine) => {
        await engine.markTaskHeartbeat(task.id, TASK_STALL_WARNING_MS);
        await engine.markTaskTddProgress(task.id, task.tddPhase!, {
          iterationCount: task.iterationCount,
          redEstablishedAt: task.redEstablishedAt,
          greenAchievedAt: task.greenAchievedAt,
          refactorValidatedAt: task.refactorValidatedAt,
        });
      });

      const validation = await runValidation(ctx, task);
      await withV2Engine(ctx, (engine) => engine.markTaskValidation(task.id, validation.passed, validation.output, task.validationFramework, validation.coverage));
      await appendFile(
        outputPath(ctx.cwd, "tasks", `${task.id}.iterations.log`),
        `${JSON.stringify({ time: nowIso(), turn: turn + 1, tddPhase: task.tddPhase, passed: validation.passed, coverage: validation.coverage, feedback: validation.output.slice(0, 12000) })}\n`,
        "utf-8",
      );

      if (task.tddPhase === "red") {
        if (!validation.passed) {
          task.redEstablishedAt = task.redEstablishedAt ?? nowIso();
          task.tddPhase = "green";
          await withV2Engine(ctx, (engine) => engine.markTaskTddProgress(task.id, task.tddPhase!, {
            iterationCount: task.iterationCount,
            redEstablishedAt: task.redEstablishedAt,
            greenAchievedAt: task.greenAchievedAt,
            refactorValidatedAt: task.refactorValidatedAt,
          }));
          previousFeedback = `RED established successfully. Validation is failing as expected. Move to GREEN.\n\n${validation.output.slice(0, 12000)}`;
          continue;
        }
        previousFeedback = `RED phase failed: validation already passed. The test/setup is too weak or trivial. Strengthen or correct the failing test before moving on.\n\n${validation.output.slice(0, 12000)}`;
        continue;
      }

      if (task.tddPhase === "green") {
        if (validation.passed) {
          task.greenAchievedAt = task.greenAchievedAt ?? nowIso();
          task.tddPhase = "refactor";
          await withV2Engine(ctx, (engine) => engine.markTaskTddProgress(task.id, task.tddPhase!, {
            iterationCount: task.iterationCount,
            redEstablishedAt: task.redEstablishedAt,
            greenAchievedAt: task.greenAchievedAt,
            refactorValidatedAt: task.refactorValidatedAt,
          }));
          previousFeedback = `GREEN achieved successfully. Now perform one refactor pass while keeping validation green.\n\n${validation.output.slice(0, 12000)}`;
          continue;
        }
        previousFeedback = `Still in GREEN: validation is not yet passing. Keep changes minimal and target the failing signal.\n\n${validation.output.slice(0, 12000)}`;
        continue;
      }

      if (task.tddPhase === "refactor") {
        if (validation.passed) {
          task.refactorValidatedAt = nowIso();
          task.tddPhase = "complete";
          await withV2Engine(ctx, (engine) => engine.markTaskTddProgress(task.id, task.tddPhase!, {
            iterationCount: task.iterationCount,
            redEstablishedAt: task.redEstablishedAt,
            greenAchievedAt: task.greenAchievedAt,
            refactorValidatedAt: task.refactorValidatedAt,
          }));
          return latestResult;
        }
        task.tddPhase = "green";
        await withV2Engine(ctx, (engine) => engine.markTaskTddProgress(task.id, task.tddPhase!, {
          iterationCount: task.iterationCount,
          redEstablishedAt: task.redEstablishedAt,
          greenAchievedAt: task.greenAchievedAt,
          refactorValidatedAt: task.refactorValidatedAt,
        }));
        previousFeedback = `REFACTOR broke green. Return to GREEN, restore passing behavior, then refactor again if budget remains.\n\n${validation.output.slice(0, 12000)}`;
        continue;
      }
    }

    throw new Error(`Iterative TDD budget exhausted before completing ${task.tddPhase ?? "unknown"} phase`);
  }

  async function executeTask(ctx: any, task: ForgeTask) {
    if (!state) throw new Error("No orchestration state");

    task.status = "running";
    task.startedAt = nowIso();
    task.error = undefined;
    task.blocker = undefined;
    task.gateReview = undefined;
    task.stallWarnedAt = undefined;
    if (task.taskMode === "iterative") {
      task.tddPhase = "red";
      task.redEstablishedAt = undefined;
      task.greenAchievedAt = undefined;
      task.refactorValidatedAt = undefined;
    }
    task.resolvedModel = await resolveModelForRole(ctx, task.taskMode === "iterative" ? "workerIterative" : "worker");
    await persistState(ctx, "task_start", { taskId: task.id, mode: task.taskMode });
    await withV2Engine(ctx, async (engine) => {
      await engine.markTaskStarted(task.id, task.retries + 1, task.resolvedModel, undefined, TASK_STALL_WARNING_MS);
      await engine.markTaskRuntime(task.id, {
        retries: task.retries,
        error: null,
        stallWarnedAt: null,
      });
      if (task.taskMode === "iterative") {
        await engine.markTaskTddProgress(task.id, task.tddPhase!, {
          iterationCount: task.iterationCount,
          redEstablishedAt: task.redEstablishedAt,
          greenAchievedAt: task.greenAchievedAt,
          refactorValidatedAt: task.refactorValidatedAt,
        });
      }
    });

    try {
      const result = task.taskMode === "iterative"
        ? await runIterativeTask(ctx, task)
        : await runSinglePassTask(ctx, task);

      task.result = result;
      await withV2Engine(ctx, (engine) => engine.markTaskHeartbeat(task.id, TASK_STALL_WARNING_MS));
      if (task.taskMode !== "iterative") {
        const validation = await runValidation(ctx, task);
        await withV2Engine(ctx, (engine) => engine.markTaskValidation(task.id, validation.passed, validation.output, task.validationFramework, validation.coverage));
      }
      const gate = await gateReviewTask(ctx, task);
      task.gateReview = { passed: gate.passed, notes: gate.notes };
      await withV2Engine(ctx, (engine) => engine.markTaskGateReview(task.id, gate.passed, gate.notes));

      if (gate.blocker) {
        await pauseForHumanIntervention(ctx, task, gate.blocker, "task_blocked", { blocker: gate.blocker.reason });
        await saveArtifact(ctx, `tasks/${task.id}.gate.json`, JSON.stringify(gate, null, 2));
        return;
      }

      if (!gate.passed) {
        throw new Error(gate.notes || "Gate review failed");
      }

      task.status = "completed";
      task.failureSignature = undefined;
      if (task.taskMode === "iterative") task.tddPhase = "complete";
      task.completedAt = nowIso();
      await saveArtifact(ctx, `tasks/${task.id}.md`, task.result ?? "");
      await saveArtifact(ctx, `tasks/${task.id}.gate.json`, JSON.stringify(gate, null, 2));
      await persistState(ctx, "task_complete", { taskId: task.id });
      await withV2Engine(ctx, async (engine) => {
        await engine.markTaskRuntime(task.id, {
          retries: task.retries,
          error: null,
          failureSignature: null,
          stallWarnedAt: null,
        });
        await engine.markTaskCompleted(task.id, task.result);
      });
    } catch (error: any) {
      task.retries += 1;
      task.error = String(error?.message ?? error);
      await withV2Engine(ctx, (engine) => engine.markTaskRuntime(task.id, {
        retries: task.retries,
        error: task.error,
      }));

      const envFailure = classifyEnvironmentFailure(task);
      if (envFailure) {
        task.failureSignature = envFailure.signature;
        await withV2Engine(ctx, (engine) => engine.markTaskRuntime(task.id, {
          retries: task.retries,
          error: task.error,
          failureSignature: task.failureSignature,
        }));
        const blocker = createHumanInterventionBlocker(task, envFailure.reason, envFailure.suggestion);
        await pauseForHumanIntervention(ctx, task, blocker, "task_blocked_environment", { signature: envFailure.signature });
        return;
      }

      const failureSignature = normalizeFailureSignature(task.error);
      if (task.failureSignature && task.failureSignature === failureSignature) {
        const blocker = createHumanInterventionBlocker(
          task,
          "Repeated identical task failure requires human review",
          "The same failure happened again without meaningful progress. Review the task result, logs, and acceptance environment, then provide a concrete resolution before retrying.",
        );
        await pauseForHumanIntervention(ctx, task, blocker, "task_blocked_repeated_failure", { signature: failureSignature });
        return;
      }
      task.failureSignature = failureSignature;
      await withV2Engine(ctx, (engine) => engine.markTaskRuntime(task.id, {
        retries: task.retries,
        error: task.error,
        failureSignature: task.failureSignature,
      }));

      if (task.retries > config.maxRetries) {
        if (needsDiagnosticReview(task) && (task.diagnosticCount ?? 0) < 1) {
          const diagnosis = await diagnoseTaskFailure(ctx, task);
          if (diagnosis) {
            task.diagnostic = {
              classification: String(diagnosis.classification ?? "unknown"),
              notes: String(diagnosis.notes ?? ""),
            };
            task.diagnosticCount = (task.diagnosticCount ?? 0) + 1;
            await withV2Engine(ctx, (engine) => engine.markTaskRuntime(task.id, {
              retries: task.retries,
              error: task.error,
              failureSignature: task.failureSignature,
              diagnostic: task.diagnostic,
              diagnosticCount: task.diagnosticCount,
            }));
            await saveArtifact(ctx, `tasks/${task.id}.diagnostic.json`, JSON.stringify(diagnosis, null, 2));

            if (diagnosis.classification === "test_spec_error" && diagnosis.rewrittenTestSpec) {
              state!.testSpecs = (state!.testSpecs ?? []).filter((s) => s.taskId !== task.id);
              state!.testSpecs.push(diagnosis.rewrittenTestSpec as TestSpecEntry);
              const spec = diagnosis.rewrittenTestSpec as TestSpecEntry;
              task.acceptanceSignal = spec.acceptance_signal || task.acceptanceSignal;
              task.coverageThreshold = typeof spec.coverage_threshold === "number" ? spec.coverage_threshold : task.coverageThreshold;
              task.testSpecRefs = (spec.testFiles ?? []).map((f: any) => f.path);
              await saveArtifact(ctx, "03-test-spec.json", JSON.stringify({ testSpecs: state!.testSpecs }, null, 2));
              await persistTaskDefinitions(ctx);
              await withV2Engine(ctx, (engine) => engine.markTestSpecWritten("03-test-spec.json", state!.testSpecs ?? [], state!.testSpecMarkdownFile));
              task.retries = 0;
              await withV2Engine(ctx, async (engine) => {
                await engine.markTaskRuntime(task.id, {
                  retries: task.retries,
                  error: task.error,
                  failureSignature: task.failureSignature,
                  diagnostic: task.diagnostic,
                  diagnosticCount: task.diagnosticCount,
                });
                await engine.requeueTask(task.id, `diagnostic:${diagnosis.classification}`);
              });
              await reconcileFromAuthoritative(ctx);
              await persistState(ctx, "task_requeued_from_diagnostic", { taskId: task.id, classification: diagnosis.classification });
              return;
            }

            if (diagnosis.classification === "requirement_or_plan_error") {
              const blocker: Blocker = diagnosis.blocker
                ? {
                    taskId: task.id,
                    reason: diagnosis.blocker.reason || task.error || "Requirement/plan error",
                    suggestion: diagnosis.blocker.suggestion || "Review the plan and test contract",
                    blockedTasks: Array.isArray(diagnosis.blocker.blockedTasks) ? diagnosis.blocker.blockedTasks : [],
                  }
                : {
                    taskId: task.id,
                    reason: task.error || "Requirement/plan error",
                    suggestion: String(diagnosis.notes || "Review the requirement, plan, and generated tests together."),
                    blockedTasks: [],
                  };
              await pauseForHumanIntervention(ctx, task, blocker, "task_blocked_from_diagnostic", { classification: diagnosis.classification });
              return;
            }
          }
        }

        await withV2Engine(ctx, async (engine) => {
          await engine.markTaskRuntime(task.id, {
            retries: task.retries,
            error: task.error,
            failureSignature: task.failureSignature,
            diagnostic: task.diagnostic,
            diagnosticCount: task.diagnosticCount,
          });
          await engine.markTaskFailed(task.id, task.error ?? "Task failed");
        });
        await reconcileFromAuthoritative(ctx);
        await persistState(ctx, "task_failed", { taskId: task.id, error: task.error, diagnostic: task.diagnostic?.classification });
      } else {
        await withV2Engine(ctx, async (engine) => {
          await engine.markTaskRuntime(task.id, {
            retries: task.retries,
            error: task.error,
            failureSignature: task.failureSignature,
            diagnostic: task.diagnostic,
            diagnosticCount: task.diagnosticCount,
          });
          await engine.requeueTask(task.id, task.error ?? "retry");
        });
        await reconcileFromAuthoritative(ctx);
        await persistState(ctx, "task_retry", { taskId: task.id, retries: task.retries, error: task.error });
      }
    }
  }

  function dependenciesResolved(task: ForgeTask) {
    return task.dependencies.every((dep) => state?.tasks.find((t) => t.id === dep)?.status === "completed");
  }

  function hasFailedDependency(task: ForgeTask) {
    return failedDependencies(task).length > 0;
  }

  async function executeApprovedPlan(ctx: any) {
    if (!state) throw new Error("No plan to execute");
    if (!state.tasks.length) throw new Error("No tasks available");

    state.status = "executing";
    state.currentPhase = 5;
    state.phaseLabel = "Execution";
    await persistState(ctx, "phase_start", { phase: 5 });
    await withV2Engine(ctx, (engine) => engine.markExecutionPhaseStarted());
    await reconcileFromAuthoritative(ctx);

    while (true) {
      const executionState = await syncExecutionSnapshot(ctx);

      if (runAbortController?.signal.aborted || executionState.effectiveStatus === "aborted") {
        state!.status = "aborted";
        await persistState(ctx, "aborted");
        await withV2Engine(ctx, (engine) => engine.markRunAborted("Execution aborted"));
        await reconcileFromAuthoritative(ctx);
        return;
      }

      if (["paused", "needs_human_intervention", "awaiting_approval"].includes(executionState.effectiveStatus)) {
        await reconcileFromAuthoritative(ctx);
        return;
      }

      const schedulingSync = await syncPendingTaskSchedulingState(ctx);
      const current = schedulingSync.changed ? await syncExecutionSnapshot(ctx) : executionState;

      if (current.unfinished.length === 0 && current.running.length === 0 && current.ready.length === 0) break;

      if (current.ready.length === 0 && current.running.length === 0) {
        const blockedByHuman = current.effectiveStatus === "needs_human_intervention" || Boolean(current.authoritative?.pendingHumanIntervention) || current.blocked.length > 0;
        state!.status = blockedByHuman ? "paused" : "failed";
        await persistState(ctx, "execution_stalled");
        if (blockedByHuman) {
          await withV2Engine(ctx, (engine) => engine.markApprovalRequired("executePlan", "Execution (human intervention required)"));
        } else {
          await withV2Engine(ctx, (engine) => engine.markRunFailed("Execution stalled with no runnable tasks"));
        }
        await reconcileFromAuthoritative(ctx);
        return;
      }

      const batch = current.ready.slice(0, Math.max(0, config.maxWorkers - current.running.length));
      await Promise.allSettled(batch.map((task) => executeTaskWithWatchdog(ctx, task)));
      await reconcileFromAuthoritative(ctx);
    }

    const finalState = await syncExecutionSnapshot(ctx);
    if (finalState.failed.length > 0 || finalState.blocked.length > 0 || finalState.effectiveStatus === "needs_human_intervention") {
      const blockedByHuman = finalState.effectiveStatus === "needs_human_intervention" || Boolean(finalState.authoritative?.pendingHumanIntervention) || finalState.blocked.length > 0;
      state!.status = blockedByHuman ? "paused" : "failed";
      await persistState(ctx, "phase_complete", { phase: 5, status: state!.status });
      if (blockedByHuman) {
        await withV2Engine(ctx, (engine) => engine.markApprovalRequired("executePlan", "Execution (human intervention required)"));
      } else {
        await withV2Engine(ctx, (engine) => engine.markRunFailed("Execution ended with failed tasks and no recovery path"));
      }
      await reconcileFromAuthoritative(ctx);
      return;
    }

    state!.status = "reviewing";
    state!.currentPhase = 6;
    state!.phaseLabel = "Integration Review";
    await persistState(ctx, "phase_complete", { phase: 5, next: 6 });
    await withV2Engine(ctx, (engine) => engine.markIntegrationReviewStarted());
    await reconcileFromAuthoritative(ctx);
    await phaseIntegrationReview(ctx);
  }

  async function phaseIntegrationReview(ctx: any) {
    if (!state) throw new Error("No orchestration state");

    const authoritative = await reconcileFromAuthoritative(ctx);
    const reviewTasks = authoritative ? createV1StateFromV2(authoritative).tasks : state.tasks;
    const requirements = await readArtifactMaybe(ctx, state.requirementsFile);
    const plan = await readArtifactMaybe(ctx, state.planFile);
    const taskResults = reviewTasks
      .filter((t) => t.status === "completed")
      .map((t) => `## ${t.id} — ${t.title}\n\n${t.result ?? ""}`)
      .join("\n\n---\n\n");

    const prompt = [
      "# Review scope",
      "- Cross-component coherence",
      "- Correctness against requirements",
      "- Security, performance, testing, documentation",
      "- Consistency across components",
      "",
      "# Requirements",
      requirements,
      "",
      "# Plan",
      plan,
      "",
      "# Implemented task results",
      taskResults,
    ].join("\n");

    const review = await spawnAgent(ctx, "integrationReviewer", prompt, {
      promptAppendix: "Return Markdown only.",
      timeout: 1200,
    });
    await saveArtifact(ctx, "04-review.md", review);
    state.reviewFile = "04-review.md";
    state.status = "completed";
    state.timestamps.completed = nowIso();
    await persistState(ctx, "phase_complete", { phase: 6, completed: true });
    await withV2Engine(ctx, async (engine) => {
      await engine.markIntegrationReviewCompleted("04-review.md");
      await engine.markRunCompleted();
    });
    await reconcileFromAuthoritative(ctx);
    ctx.ui.notify("[task-forge] Review complete", "success");
  }

  async function continueComplexPlanningAfterCheckpoint(ctx: any) {
    await phasePlan(ctx);
  }

  function startExecutionInBackground(ctx: any, reason: string) {
    if (executionPromise) return executionPromise;

    executionPromise = (async () => {
      try {
        ensureRunAbortController();
        await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
        const authoritative = await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
        if (authoritative) {
          applyAuthoritativeSnapshotToV1(authoritative);
        }

        const v2Engine = new TaskForgeV2Engine(ctx.cwd, config.outputDir);
        const canProceed = await preflightExecutableTasks(ctx, v2Engine);
        if (!canProceed) return;

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

  async function runPlanningFlow(ctx: any, prdFile: string, executeImmediately: boolean) {
    await initState(ctx, prdFile);
    await phaseClassifyScope(ctx);

    if (state?.orchestrationMode === "micro") {
      await phasePlanMicro(ctx);
      if (executeImmediately || config.autoExecute) {
        startExecutionInBackground(ctx, executeImmediately ? "plan --execute" : "auto-execute");
      }
      return;
    }

    await phaseAnalyze(ctx);

    if (state?.orchestrationMode === "complex") {
      state.status = "awaiting_approval";
      state.currentPhase = 1;
      state.phaseLabel = "Complex Checkpoint: Requirements Review";
      state.nextAction = "continuePlanning";
      await persistState(ctx, "complex_checkpoint", { checkpoint: "requirements_review" });
      await withV2Engine(ctx, (engine) => engine.requireApproval("continuePlanning", "Complex Checkpoint: Requirements Review"));
      ctx.ui.notify("[task-forge] Complex mode: review 01-requirements.md, then run /forge execute to continue planning", "info");
      return;
    }

    await phasePlan(ctx);

    if (executeImmediately || config.autoExecute) {
      startExecutionInBackground(ctx, executeImmediately ? "plan --execute" : "auto-execute");
    }
  }

  async function statusSummary(ctx?: any) {
    const authoritative = ctx ? await loadCommandSnapshot(ctx) : null;
    if (authoritative) return statusSummaryFromV2(authoritative);
    if (!state) return "[task-forge] No active orchestration";
    const counts = {
      ready: state.tasks.filter((t) => t.status === "ready").length,
      running: state.tasks.filter((t) => t.status === "running").length,
      completed: state.tasks.filter((t) => t.status === "completed").length,
      pending: state.tasks.filter((t) => t.status === "pending").length,
      failed: state.tasks.filter((t) => t.status === "failed").length,
      blocked: state.tasks.filter((t) => t.status === "blocked").length,
    };
    return [
      `[task-forge] ${statusIcon(state.status)} ${state.status}`,
      `mode: ${state.orchestrationMode ?? "n/a"}`,
      `phase: ${state.phaseLabel}`,
      state.nextAction ? `next action: ${state.nextAction}` : "",
      `prd: ${state.prdFile ?? "n/a"}`,
      `tasks: ${counts.completed}/${state.tasks.length} completed, ${counts.running} running, ${counts.ready} ready, ${counts.pending} pending, ${counts.failed} failed, ${counts.blocked} blocked`,
      state.blockers.length > 0 ? `blockers: ${state.blockers.map((b) => `${b.taskId}`).join(", ")}` : "blockers: none",
    ].filter(Boolean).join("\n");
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
        pi.sendMessage(
          {
            customType: "task-forge-status",
            content: await statusSummary(ctx),
            display: true,
          },
          { triggerTurn: false },
        );
        return;
      }

      if (sub === "help") {
        ctx.ui.notify(
          [
            "[task-forge] Commands:",
            "  /forge <prd-file>             analyze + plan + decompose, stop at approval gate",
            "  /forge <prd-file> --execute   full run without stopping at approval gate",
            "  /forge execute                execute current approved plan",
            "  /forge status                 show status",
            "  /forge blocker <id> --resolve \"...\"  resolve blocker and requeue task",
            "  /forge pause                  pause execution",
            "  /forge resume                 resume execution",
            "  /forge abort                  abort orchestration",
            "  /forge cost                   show current estimate",
            "  /forge models                 show resolved models per role",
            "  /forge config                 show effective config",
          ].join("\n"),
          "info",
        );
        return;
      }

      if (sub === "config") {
        ctx.ui.notify(JSON.stringify(config, null, 2), "info");
        return;
      }

      if (sub === "cost") {
        ctx.ui.notify(state ? formatCost(state.cost) : "[task-forge] No active orchestration", "info");
        return;
      }

      if (sub === "models") {
        const roles: Role[] = ["scopeClassifier", "strategist", "planner", "testDesigner", "worker", "workerIterative", "gateReviewer", "diagnosticReviewer", "integrationReviewer"];
        const lines: string[] = [];
        for (const role of roles) {
          const model = await resolveModelForRole(ctx, role);
          lines.push(`${role}: ${model}`);
        }
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (sub === "pause") {
        const authoritative = await loadCommandSnapshot(ctx);
        const effectiveStatus = effectiveCommandStatus(authoritative);
        if (!["executing", "reviewing"].includes(effectiveStatus)) {
          ctx.ui.notify("[task-forge] Nothing is executing", "warning");
          return;
        }
        const pauseLabel = state?.currentPhase >= 6 ? "Integration Review (paused)" : "Execution (paused)";
        await withV2Engine(ctx, (engine) => engine.markRunPaused(pauseLabel, "executePlan", "Paused by user command"));
        await reconcileFromAuthoritative(ctx);
        if (state) {
          await persistState(ctx, "paused");
        }
        ctx.ui.notify("[task-forge] Paused", "info");
        return;
      }

      if (sub === "resume") {
        const authoritative = await loadCommandSnapshot(ctx);
        const effectiveStatus = effectiveCommandStatus(authoritative);
        if (!state) {
          ctx.ui.notify("[task-forge] No active orchestration", "warning");
          return;
        }
        if (!["awaiting_approval", "paused"].includes(effectiveStatus) || state.nextAction !== "executePlan") {
          ctx.ui.notify("[task-forge] Not resumable", "warning");
          return;
        }
        if (authoritative?.pendingHumanIntervention) {
          ctx.ui.notify(`[task-forge] Resolve blocker ${authoritative.pendingHumanIntervention.taskId} before resuming`, "warning");
          return;
        }
        await withV2Engine(ctx, async (engine) => {
          if (effectiveStatus === "paused") {
            await engine.markRunResumed("Resumed by user command");
          }
          await engine.markApprovalGranted();
        });
        state.status = "executing";
        state.nextAction = undefined;
        await persistState(ctx, "resumed");
        startExecutionInBackground(ctx, "resume");
        return;
      }

      if (sub === "abort") {
        await loadCommandSnapshot(ctx);
        runAbortController?.abort();
        if (state) {
          state.status = "aborted";
          await persistState(ctx, "abort_command");
        }
        await withV2Engine(ctx, (engine) => engine.markRunAborted("Aborted by user command"));
        await reconcileFromAuthoritative(ctx);
        ctx.ui.notify("[task-forge] Aborted", "warning");
        return;
      }

      if (sub === "execute") {
        const authoritative = await loadCommandSnapshot(ctx);

        if (!state) {
          ctx.ui.notify("[task-forge] No plan available", "warning");
          return;
        }

        const effectiveStatus = effectiveCommandStatus(authoritative);

        if (!["awaiting_approval", "paused"].includes(effectiveStatus)) {
          ctx.ui.notify(`[task-forge] Cannot execute from status ${effectiveStatus}`, "warning");
          return;
        }
        if (authoritative?.pendingHumanIntervention && !state.blockers.some((b) => b.taskId === authoritative.pendingHumanIntervention?.taskId)) {
          state.blockers = [
            ...state.blockers,
            {
              taskId: authoritative.pendingHumanIntervention.taskId,
              reason: authoritative.pendingHumanIntervention.reason,
              suggestion: authoritative.pendingHumanIntervention.suggestion,
              blockedTasks: [authoritative.pendingHumanIntervention.taskId],
            },
          ];
        }
        if (authoritative?.pendingHumanIntervention) {
          ctx.ui.notify(`[task-forge] Resolve blocker ${authoritative.pendingHumanIntervention.taskId} before executing`, "warning");
          return;
        }
        if (executionPromise) {
          ctx.ui.notify("[task-forge] Execution already running", "info");
          return;
        }

        if (state.nextAction === "continuePlanning") {
          state.status = "planning";
          state.phaseLabel = "Planning & Decomposition";
          await persistState(ctx, "continue_planning_command");
          await withV2Engine(ctx, async (engine) => {
            if (effectiveStatus === "paused") {
              await engine.markRunResumed("Planning resumed after checkpoint approval");
            }
            await engine.markApprovalGranted();
          });
          await continueComplexPlanningAfterCheckpoint(ctx);
          return;
        }

        if (state.nextAction !== "executePlan") {
          ctx.ui.notify("[task-forge] No executable approval is pending", "warning");
          return;
        }

        await withV2Engine(ctx, async (engine) => {
          if (effectiveStatus === "paused") {
            await engine.markRunResumed("Execution resumed by /forge execute");
          }
          await engine.markApprovalGranted();
        });

        state.status = "executing";
        state.nextAction = undefined;
        await persistState(ctx, "execute_command");
        startExecutionInBackground(ctx, "execute command");
        return;
      }

      if (sub === "blocker") {
        const authoritative = await loadCommandSnapshot(ctx);
        if (!state && !authoritative) {
          ctx.ui.notify("[task-forge] No active orchestration", "warning");
          return;
        }
        const taskId = parts[1];
        const flagIndex = raw.indexOf("--resolve");
        const resolution = flagIndex >= 0 ? raw.slice(flagIndex + "--resolve".length).trim().replace(/^['"]|['"]$/g, "") : "";
        if (!taskId || !resolution) {
          ctx.ui.notify("Usage: /forge blocker <task-id> --resolve \"instruction\"", "warning");
          return;
        }

        const task = state?.tasks.find((t) => t.id === taskId);
        const authoritativeTaskExists = authoritative?.tasks.some((t) => t.id === taskId) || authoritative?.taskState[taskId];
        if (!authoritativeTaskExists && state && !task) {
          ctx.ui.notify(`[task-forge] Unknown task: ${taskId}`, "warning");
          return;
        }

        await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
        const v2Engine = new TaskForgeV2Engine(ctx.cwd, config.outputDir);
        const v2Snapshot = await v2Engine.snapshot();
        const v2TaskExists = v2Snapshot?.tasks.some((t) => t.id === taskId) || v2Snapshot?.taskState[taskId];
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
          await persistState(ctx, "blocker_resolved", { taskId, resolution });
        }
        ctx.ui.notify(`[task-forge] Blocker resolved for ${taskId}. Run /forge execute to continue.`, "success");
        return;
      }

      const authoritative = await loadCommandSnapshot(ctx);
      const activeStatus = effectiveCommandStatus(authoritative);
      if (!isTerminalCommandStatus(activeStatus)) {
        ctx.ui.notify(`[task-forge] Active orchestration already exists (${activeStatus}). Finish or abort it before starting a new run.`, "warning");
        return;
      }

      const executeImmediately = raw.endsWith("--execute");
      const prdFile = executeImmediately ? raw.replace(/\s+--execute\s*$/, "") : raw;
      try {
        await runPlanningFlow(ctx, prdFile, executeImmediately);
      } catch (error: any) {
        if (state) {
          await withV2Engine(ctx, (engine) => engine.markRunFailed(String(error?.message ?? error)));
          await reconcileFromAuthoritative(ctx);
          await persistState(ctx, "plan_flow_failed", { error: String(error?.message ?? error) });
        }
        ctx.ui.notify(`[task-forge] ${String(error?.message ?? error)}`, "error");
      }
    },
  });

  pi.on("session_start", async (_event: any, ctx: any) => {
    config = await loadConfig(ctx.cwd);

    await ensureV2BootstrappedFromCurrentState(ctx.cwd, config.outputDir);
    const authoritative = await sweepOverdueSupervisors(ctx, await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir));

    if (authoritative) {
      applyAuthoritativeSnapshotToV1(authoritative);
    } else {
      let restored: ForgeState | null = null;
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type === "custom" && (entry as any).customType === STATE_ENTRY_TYPE) {
          restored = (entry as any).data as ForgeState;
        }
      }

      if (!restored) {
        const file = outputPath(ctx.cwd, "state.json");
        if (existsSync(file)) {
          try {
            restored = JSON.parse(await readFile(file, "utf-8")) as ForgeState;
          } catch {}
        }
      }

      state = restored;
    }

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
    const refreshed = await loadAuthoritativeSnapshot(ctx.cwd, config.outputDir);
    ctx.ui.setStatus("task-forge", refreshed ? statusLabelFromV2(refreshed) : statusLabel(state));
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
  });
}
