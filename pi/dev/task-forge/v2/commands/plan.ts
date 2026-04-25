/**
 * V2 Planning Command Service
 *
 * Pure V2 planning flow. Reads V2 snapshot, appends V2 events.
 * No dependency on ForgeState, state variable, persistState, or reconcileFromAuthoritative.
 *
 * Each phase function:
 * 1. Reads current state from V2 snapshot (reloaded between phases)
 * 2. Spawns an agent via hooks
 * 3. Saves artifacts via hooks
 * 4. Returns event intents (no side effects)
 */

import type { RunSnapshot, ForgeTask } from "../types.ts";
import type { ForgeEvent } from "../events.ts";
import type { CommandResult } from "./contracts.ts";
import type { TaskForgeConfig } from "../../task-forge.json" with { "resolution-mode": "import" };

// ── Hooks (provided by index.ts) ─────────────────────────────────────

export interface PlanningHooks {
  cwd: string;
  config: TaskForgeConfig;
  outputDir: string;
  ensureRunAbortController: () => void;
  genId: () => string;
  nowIso: () => string;
  spawnAgent: (ctx: any, role: string, prompt: string, options?: any) => Promise<string>;
  saveArtifact: (ctx: any, path: string, content: string) => Promise<void>;
  readFile: (path: string, encoding: string) => Promise<string>;
  readArtifact: (ctx: any, name?: string) => Promise<string>;
  gatherCodebaseSummary: (ctx: any) => Promise<string>;
  notify: (msg: string, level: string) => void;
  loadSnapshot: () => Promise<RunSnapshot | null>;
  withEngine: <T>(fn: (engine: any) => Promise<T>) => Promise<T>;
  ensureDir: (path: string) => Promise<void>;
  outputPath: (...parts: string[]) => string;
  extractJson: (text: string) => any;
  resolveModelForRole?: (ctx: any, role: string) => Promise<string>;
  persistArtifact?: (path: string, content: string) => Promise<void>;
  existsSync: (path: string) => boolean;
  resolve: (...parts: string[]) => string;
}

// ── Planning result ──────────────────────────────────────────────────

export interface PlanResult {
  snapshot: RunSnapshot | null;
  status: "completed" | "awaiting_approval" | "failed";
  nextAction?: string;
  mode?: "micro" | "standard" | "complex";
  error?: string;
}

// ── Orchestration ────────────────────────────────────────────────────

export async function runPlanningFlow(
  ctx: any,
  hooks: PlanningHooks,
  prdFile: string,
  executeImmediately: boolean,
): Promise<PlanResult> {
  // Phase 0: Init + Scope Classification
  let snapshot = await initRun(ctx, hooks, prdFile);
  if (!snapshot) return { snapshot: null, status: "failed", error: "Failed to initialize run" };

  snapshot = await classifyScope(ctx, hooks, snapshot);
  if (!snapshot) return { snapshot: null, status: "failed", error: "Scope classification failed" };

  // Phase 1: PRD Analysis
  snapshot = await analyzeRequirements(ctx, hooks, snapshot);
  if (!snapshot) return { snapshot: null, status: "failed", error: "Requirements analysis failed" };

  // Complex mode checkpoint
  if (snapshot.orchestrationMode === "complex") {
    await hooks.withEngine(async (engine) => {
      await engine.requireApproval("continuePlanning", "Complex Checkpoint: Requirements Review");
    });
    return {
      snapshot: await hooks.loadSnapshot(),
      status: "awaiting_approval",
      nextAction: "continuePlanning",
      mode: "complex",
    };
  }

  // Phase 2: Planning & Decomposition
  snapshot = await planDecomposition(ctx, hooks, snapshot);
  if (!snapshot) return { snapshot: null, status: "failed", error: "Planning failed" };

  // Phase 3: Test Design
  snapshot = await designTests(ctx, hooks, snapshot);
  if (!snapshot) return { snapshot: null, status: "failed", error: "Test design failed" };

  // Execution gate
  if (executeImmediately || hooks.config.autoExecute) {
    return { snapshot: await hooks.loadSnapshot(), status: "completed", nextAction: "executePlan" };
  }

  // Phase 4: Approval Gate
  await hooks.withEngine(async (engine) => {
    await engine.markPlanWritten(
      snapshot.planFile ?? "02-plan.md",
      snapshot.tasksFile ?? "03-tasks.json",
      snapshot.tasksMarkdownFile ?? "03-tasks.md",
      snapshot.costFile ?? "03-cost-estimate.md",
    );
    await engine.registerTasks((snapshot as any).tasks ?? []);
    await engine.markPlanningPhaseCompleted("testDesigner", 3);
    await engine.requireApproval("executePlan", "Approval Gate");
  });

  return {
    snapshot: await hooks.loadSnapshot(),
    status: "awaiting_approval",
    nextAction: "executePlan",
    mode: snapshot.orchestrationMode,
  };
}

export async function continueComplexPlanning(
  ctx: any,
  hooks: PlanningHooks,
  snapshot: RunSnapshot,
): Promise<PlanResult> {
  if (!snapshot.requirementsFile) {
    return { snapshot, status: "failed", error: "Missing requirements artifact (expected from complex checkpoint)" };
  }

  await hooks.withEngine(async (engine) => {
    await engine.markApprovalGranted();
  });

  // Resume at Phase 2: Planning
  let next = await planDecomposition(ctx, hooks, snapshot);
  if (!next) return { snapshot, status: "failed", error: "Planning failed" };

  // Phase 3: Test Design
  next = await designTests(ctx, hooks, next);
  if (!next) return { snapshot, status: "failed", error: "Test design failed" };

  // Phase 4: Approval Gate
  await hooks.withEngine(async (engine) => {
    await engine.markApprovalGranted(); // clear nextAction
    await engine.requireApproval("executePlan", "Approval Gate after complex planning");
  });

  return {
    snapshot: await hooks.loadSnapshot(),
    status: "awaiting_approval",
    nextAction: "executePlan",
    mode: next.orchestrationMode ?? snapshot.orchestrationMode,
  };
}

// ── Phase: Init ──────────────────────────────────────────────────────

export async function initRun(
  ctx: any,
  hooks: PlanningHooks,
  prdFile: string,
): Promise<RunSnapshot | null> {
  const prdPath = hooks.resolve(hooks.cwd, prdFile);
  if (!hooks.existsSync(prdPath)) throw new Error(`PRD file not found: ${prdFile}`);

  hooks.ensureRunAbortController();
  const orchestrationId = hooks.genId();

  await hooks.ensureDir(hooks.outputPath());
  await hooks.ensureDir(hooks.outputPath("tasks"));
  await hooks.ensureDir(hooks.outputPath("tmp"));

  await hooks.withEngine(async (engine) => {
    await engine.createRun(orchestrationId, prdFile);
    await engine.enterPhase(0, "Scope Classification");
  });

  return await hooks.loadSnapshot();
}

// ── Phase 0: Scope Classification ───────────────────────────────────

export async function classifyScope(
  ctx: any,
  hooks: PlanningHooks,
  snapshot: RunSnapshot,
): Promise<RunSnapshot | null> {
  const prdContent = await hooks.readFile(hooks.resolve(hooks.cwd, snapshot.prdFile), "utf-8");
  const tree = await hooks.gatherCodebaseSummary(ctx);

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

  await hooks.withEngine(async (engine) => {
    await engine.enterPhase(0, "Scope Classification");
    await engine.markPlanningPhaseStarted("scopeClassifier", 0, "Scope Classification");
  });

  const raw = await hooks.spawnAgent(ctx, "scopeClassifier", prompt, {
    promptAppendix: "Return one JSON object in a ```json fenced block only.",
    timeout: 120,
  });

  const parsed = hooks.extractJson(raw) ?? {};
  const mode: "micro" | "standard" | "complex" =
    parsed.mode === "micro" || parsed.mode === "complex" ? parsed.mode : "standard";
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale : undefined;

  await hooks.saveArtifact(ctx, "00-routing.json", JSON.stringify(parsed, null, 2));

  await hooks.withEngine(async (engine) => {
    await engine.markRouting(mode, rationale);
    await engine.markPlanningPhaseCompleted("scopeClassifier", 0);
  });

  hooks.notify(`[task-forge] Routing mode: ${mode}${rationale ? ` — ${rationale}` : ""}`, "info");
  return await hooks.loadSnapshot();
}

// ── Phase 1: PRD Analysis ───────────────────────────────────────────

export async function analyzeRequirements(
  ctx: any,
  hooks: PlanningHooks,
  snapshot: RunSnapshot,
): Promise<RunSnapshot | null> {
  const prdContent = await hooks.readFile(hooks.resolve(hooks.cwd, snapshot.prdFile), "utf-8");
  const tree = await hooks.gatherCodebaseSummary(ctx);

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

  await hooks.withEngine(async (engine) => {
    await engine.enterPhase(1, "PRD Analysis");
    await engine.markPlanningPhaseStarted("strategist", 1, "PRD Analysis");
  });

  const requirements = await hooks.spawnAgent(ctx, "strategist", prompt, {
    promptAppendix: "Return Markdown only.",
    timeout: 900,
  });

  await hooks.saveArtifact(ctx, "01-requirements.md", requirements);

  await hooks.withEngine(async (engine) => {
    await engine.markRequirementsWritten("01-requirements.md");
    await engine.markPlanningPhaseCompleted("strategist", 1);
  });

  hooks.notify("[task-forge] Phase 1 complete: requirements written", "success");
  return await hooks.loadSnapshot();
}

// ── Phase 2: Planning & Decomposition ───────────────────────────────

export async function planDecomposition(
  ctx: any,
  hooks: PlanningHooks,
  snapshot: RunSnapshot,
): Promise<RunSnapshot | null> {
  const requirements = await hooks.readArtifact(ctx, snapshot.requirementsFile ?? "01-requirements.md");
  const originalPrd = await hooks.readFile(hooks.resolve(hooks.cwd, snapshot.prdFile), "utf-8");
  const tree = await hooks.gatherCodebaseSummary(ctx);

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
    "- every task must include validation with explicit mode",
    "- do not omit validation.mode in any emitted task",
    "- command validation uses validation={ mode, command, coverageThreshold? }",
    "- command validation.command must be a runnable shell command only, not prose",
    "- manual review uses validation={ mode, notes } and must not place guidance in test_command or acceptance_signal",
    "- do not emit deprecated legacy validation fields such as test_command, acceptance_signal, or coverage_threshold in new task JSON",
    "- documentation/config/manual-review tasks should usually use validation.mode=manual with reviewer notes",
    "- implementation tasks should use validation.mode=command with a real executable command",
    "- for TypeScript projects using Node native test runner with --experimental-strip-types, use `node --test --experimental-strip-types <files>` directly; do not prepend `tsc --noEmit` because it ignores tsconfig.json when run without -p",
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

  await hooks.withEngine(async (engine) => {
    await engine.enterPhase(2, "Planning & Decomposition");
    await engine.markPlanningPhaseStarted("planner", 2, "Planning & Decomposition");
  });

  const raw = await hooks.spawnAgent(ctx, "planner", prompt, {
    promptAppendix: "Return one JSON object in a ```json fenced block only.",
    timeout: 1200,
  });

  const parsed = hooks.extractJson(raw);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    await hooks.saveArtifact(ctx, "02-plan.raw.txt", raw);
    const preview = raw.slice(0, 500).replace(/\n/g, "\\n");
    throw new Error(`Planner did not return valid task JSON. Raw output preview: ${preview}`);
  }

  const tasks = parsed.tasks.map(coerceTask);
  const cost = parsed.costEstimate ?? {};
  const planMarkdown = typeof parsed.planMarkdown === "string" ? parsed.planMarkdown : "# Plan\n\nNo plan markdown returned.";
  const tasksMarkdown = typeof parsed.tasksMarkdown === "string" ? parsed.tasksMarkdown : tasksToMarkdown(tasks);

  await hooks.saveArtifact(ctx, "02-plan.md", planMarkdown);
  await hooks.saveArtifact(ctx, "03-tasks.json", JSON.stringify({ tasks, costEstimate: cost }, null, 2));
  await hooks.saveArtifact(ctx, "03-tasks.md", tasksMarkdown);
  await hooks.saveArtifact(ctx, "03-cost-estimate.md", formatCost(cost));

  await hooks.withEngine(async (engine) => {
    await engine.markPlanWritten("02-plan.md", "03-tasks.json", "03-tasks.md", "03-cost-estimate.md");
    await engine.registerTasks(tasks as any);
    await engine.markPlanningPhaseCompleted("planner", 2);
  });

  if (cost.estimatedUsd !== undefined && cost.estimatedUsd > hooks.config.costLimitUsd) {
    hooks.notify(
      `[task-forge] Warning: estimated cost $${cost.estimatedUsd.toFixed(2)} exceeds configured limit $${hooks.config.costLimitUsd.toFixed(2)}`,
      "warning",
    );
  }

  return await hooks.loadSnapshot();
}

// ── Phase 3: Test Design ─────────────────────────────────────────────

export async function designTests(
  ctx: any,
  hooks: PlanningHooks,
  snapshot: RunSnapshot,
): Promise<RunSnapshot | null> {
  const requirements = await hooks.readArtifact(ctx, snapshot.requirementsFile ?? "01-requirements.md");
  const plan = await hooks.readArtifact(ctx, snapshot.planFile ?? "02-plan.md");
  const tasksArtifact = await hooks.readArtifact(ctx, snapshot.tasksFile ?? "03-tasks.json");
  const tree = await hooks.gatherCodebaseSummary(ctx);

  const prompt = [
    "# Goal",
    "Design grounded, executable test specs for the planned tasks.",
    "",
    "# Requirements",
    requirements,
    "",
    "# Plan",
    plan,
    "",
    "# Task JSON",
    tasksArtifact,
    "",
    "# Existing repository file tree",
    tree || "(none)",
    "",
    "# Output schema",
    "Return one JSON object with keys:",
    "- testSpecs: TestSpecEntry[] (one per implementation task that can be tested)",
    "- testSpecMarkdown: string (human-readable summary for the Approval Gate)",
    "- ambiguities: string[] (structure and interface-level gaps the Planner must clarify)",
    "",
    "Each TestSpecEntry:",
    '{ "taskId": string, "testFiles": [{"path": string, "type": string, "targets": string[], "fixtures_required": string[], "derived_from": string[] }], "validation": { "mode": "command|manual", "command": string?, "notes": string?, "coverageThreshold": number? }, "ambiguities": string[] }',
    "",
    "# Test design rules",
    "- Every implementation task must have at least one test file entry",
    "- Derive test files from acceptance criteria and measurable targets",
    "- Prefer concrete, runnable test files over abstract description",
    "- Each test file entry must declare which source modules it targets",
    "- Put manual reviewer guidance in validation.notes, never in acceptance_signal or test_command.",
    "- Do not emit deprecated legacy validation fields such as acceptance_signal, test_command, or coverage_threshold in new test-spec JSON.",
    "- For TypeScript tasks validated with Node tests, use `node --test --experimental-strip-types <targeted test files>` directly. Do not prepend `tsc --noEmit` because bare `tsc` ignores tsconfig.json settings like `allowImportingTsExtensions` and `esModuleInterop`.",
  ].join("\n");

  await hooks.withEngine(async (engine) => {
    await engine.enterPhase(3, "Test Design");
    await engine.markPlanningPhaseStarted("testDesigner", 3, "Test Design");
  });

  const raw = await hooks.spawnAgent(ctx, "testDesigner", prompt, {
    promptAppendix: "Return one JSON object in a ```json fenced block only.",
    timeout: 1200,
  });

  const parsed = hooks.extractJson(raw);
  if (!parsed) {
    await hooks.saveArtifact(ctx, "03-test-spec.raw.txt", raw);
    const preview = raw.slice(0, 500).replace(/\n/g, "\\n");
    throw new Error(`Test designer did not return valid JSON. Raw output preview: ${preview}`);
  }

  const specs = parsed.testSpecs ?? [];
  const markdown = typeof parsed.testSpecMarkdown === "string" ? parsed.testSpecMarkdown : "# Test Specs\n\nNo test spec markdown returned.";
  const ambiguities = parsed.ambiguities ?? [];

  await hooks.saveArtifact(ctx, "03-test-spec.json", JSON.stringify({ testSpecs: specs, ambiguities }, null, 2));
  await hooks.saveArtifact(ctx, "03-test-spec.md", markdown);

  await hooks.withEngine(async (engine) => {
    await engine.markTestSpecWritten("03-test-spec.json", specs, "03-test-spec.md");
    await engine.markPlanningPhaseCompleted("testDesigner", 3);
  });

  hooks.notify(`[task-forge] Phase 3 complete: ${specs.length} test spec(s) designed`, "success");
  return await hooks.loadSnapshot();
}

// ── Micro plan (shortcut for small tasks) ────────────────────────────

export async function runMicroPlan(
  ctx: any,
  hooks: PlanningHooks,
  snapshot: RunSnapshot,
): Promise<PlanResult> {
  const requirements = await hooks.readArtifact(ctx, snapshot.requirementsFile ?? "01-requirements.md");
  const tree = await hooks.gatherCodebaseSummary(ctx);

  const prompt = [
    "# Goal",
    "Produce a compact task list for micro-scope work (3-5 small, tightly scoped tasks).",
    "",
    "# Output",
    "Return a single JSON object with keys:",
    "- planMarkdown: string",
    "- tasksMarkdown: string",
    "- costEstimate: { totalInputTokens, totalOutputTokens, iterativeBudgetTokens, estimatedUsd }",
    "- tasks: ForgeTask[] (3-5 tasks max)",
    "",
    "# Task rules (same as standard planner, but keep it small)",
    "- every task must include validation with explicit mode",
    "- command validation.command must be executable shell only, not prose",
    "- for TypeScript projects using Node native test runner with --experimental-strip-types, use `node --test --experimental-strip-types <files>` directly; do not prepend `tsc --noEmit`",
    "",
    "# Existing codebase file tree",
    tree || "(none)",
    "",
    "# Requirements",
    requirements,
  ].join("\n");

  await hooks.withEngine(async (engine) => {
    await engine.enterPhase(2, "Planning & Decomposition (micro)");
    await engine.markPlanningPhaseStarted("planner", 2, "Planning & Decomposition (micro)");
  });

  const raw = await hooks.spawnAgent(ctx, "planner", prompt, {
    promptAppendix: "Return one JSON object in a ```json fenced block only.",
    timeout: 600,
  });

  const parsed = hooks.extractJson(raw);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    const preview = raw.slice(0, 500).replace(/\n/g, "\\n");
    throw new Error(`Micro planner did not return valid task JSON. Raw output preview: ${preview}`);
  }

  const tasks = parsed.tasks.map(coerceTask);
  const cost = parsed.costEstimate ?? {};
  const planMarkdown = typeof parsed.planMarkdown === "string" ? parsed.planMarkdown : "# Plan\n\nMicro plan.";
  const tasksMarkdown = typeof parsed.tasksMarkdown === "string" ? parsed.tasksMarkdown : tasksToMarkdown(tasks);

  await hooks.saveArtifact(ctx, "02-plan.md", planMarkdown);
  await hooks.saveArtifact(ctx, "03-tasks.json", JSON.stringify({ tasks, costEstimate: cost }, null, 2));
  await hooks.saveArtifact(ctx, "03-tasks.md", tasksMarkdown);
  await hooks.saveArtifact(ctx, "03-cost-estimate.md", formatCost(cost));

  await hooks.withEngine(async (engine) => {
    await engine.markPlanWritten("02-plan.md", "03-tasks.json", "03-tasks.md", "03-cost-estimate.md");
    await engine.registerTasks(tasks as any);
    await engine.markPlanningPhaseCompleted("planner", 2);
    await engine.requireApproval("executePlan", "Approval Gate");
  });

  return {
    snapshot: await hooks.loadSnapshot(),
    status: "awaiting_approval",
    nextAction: "executePlan",
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function coerceTask(raw: any, index?: number): ForgeTask {
  const taskMode: "single-pass" | "iterative" = raw.task_mode === "iterative" ? "iterative" : "single-pass";
  const complexity: "S" | "M" | "L" = raw.complexity === "L" || raw.complexity === "S" ? raw.complexity : "M";
  const validation = raw.validation ?? {};
  const id = raw.id || `TASK-${String((index ?? 0) + 1).padStart(3, "0")}`;

  return {
    id,
    title: raw.title || `Task ${(index ?? 0) + 1}`,
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
    turnBudget: Math.min(Math.max(Number(raw.turn_budget ?? 50), 1), 200),
    validation,
    testSpecRefs: raw.test_spec_refs ?? [],
    status: "pending",
    retries: 0,
  } as ForgeTask;
}

function tasksToMarkdown(tasks: ForgeTask[]): string {
  const lines = ["# Tasks", ""];
  for (const task of tasks) {
    lines.push(`## ${task.id}: ${task.title}`);
    lines.push("");
    lines.push(`- **Mode:** ${task.taskMode}`);
    lines.push(`- **Complexity:** ${task.complexity}`);
    lines.push(`- **Dependencies:** ${(task.dependencies ?? []).join(", ") || "none"}`);
    lines.push(`- **Acceptance criteria:**`);
    for (const ac of task.acceptanceCriteria) {
      lines.push(`  - ${ac}`);
    }
    if (task.description) {
      lines.push("");
      lines.push(task.description);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatCost(cost: any): string {
  const lines = ["# Cost Estimate", ""];
  if (cost.totalInputTokens !== undefined) lines.push(`- **Total input tokens:** ${cost.totalInputTokens}`);
  if (cost.totalOutputTokens !== undefined) lines.push(`- **Total output tokens:** ${cost.totalOutputTokens}`);
  if (cost.iterativeBudgetTokens !== undefined) lines.push(`- **Iterative budget tokens:** ${cost.iterativeBudgetTokens}`);
  if (cost.estimatedUsd !== undefined) lines.push(`- **Estimated USD:** $${cost.estimatedUsd.toFixed(2)}`);
  return lines.join("\n");
}
