// @ts-nocheck
import { readFile, appendFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ForgeEvent } from "./events.ts";
import type { Blocker, ForgeTask, RunPhase, RunSnapshot, TestSpecEntry } from "./types.ts";
import { replayEvents } from "./derive.ts";
import { normalizeBlocker } from "./blocker-model.ts";
import { materializeLegacyValidationFields, normalizeValidationContract } from "./validation.ts";
import type { V2StorageLayout } from "./storage.ts";

interface V1Task {
  id: string;
  title: string;
  description: string;
  complexity: "S" | "M" | "L";
  taskMode: "single-pass" | "iterative";
  contextManifest: {
    artifacts?: string[];
    codebaseFiles?: string[];
    dependencyOutputs?: string[];
  };
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
  status: "pending" | "ready" | "running" | "completed" | "failed" | "blocked" | "skipped";
  retries: number;
  resolvedModel?: string;
  result?: string;
  error?: string;
  blocker?: Blocker;
  startedAt?: string;
  completedAt?: string;
  resolutionInstruction?: string;
}

interface V1TestSpecEntry {
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

function toV2TestSpec(spec: V1TestSpecEntry): TestSpecEntry {
  const { validation } = normalizeValidationContract({
    acceptanceSignal: spec.acceptance_signal,
    coverageThreshold: spec.coverage_threshold,
  });
  const legacy = materializeLegacyValidationFields(validation);

  return {
    ...spec,
    validation,
    acceptance_signal: legacy.acceptanceSignal,
    coverage_threshold: legacy.coverageThreshold,
  };
}

interface V1State {
  orchestrationId: string;
  status: string;
  currentPhase: RunPhase;
  phaseLabel: string;
  prdFile?: string;
  orchestrationMode?: "micro" | "standard" | "complex";
  nextAction?: "continuePlanning" | "executePlan";
  routingRationale?: string;
  requirementsFile?: string;
  planFile?: string;
  tasksFile?: string;
  tasksMarkdownFile?: string;
  costFile?: string;
  testSpecFile?: string;
  testSpecMarkdownFile?: string;
  reviewFile?: string;
  blockers: Blocker[];
  tasks: V1Task[];
  testSpecs?: V1TestSpecEntry[];
  timestamps: {
    started: string;
    completed?: string;
  };
}

function toV2Task(task: V1Task): ForgeTask {
  const { validation } = normalizeValidationContract({
    testCommand: task.testCommand,
    acceptanceSignal: task.acceptanceSignal,
    coverageThreshold: task.coverageThreshold,
  });
  const legacy = materializeLegacyValidationFields(validation);

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    complexity: task.complexity,
    taskMode: task.taskMode,
    contextManifest: task.contextManifest,
    outputManifest: task.outputManifest,
    dependencies: task.dependencies,
    acceptanceCriteria: task.acceptanceCriteria,
    escalationTriggers: task.escalationTriggers,
    measurableTargets: task.measurableTargets,
    turnBudget: task.turnBudget,
    validation,
    testCommand: legacy.testCommand,
    acceptanceSignal: legacy.acceptanceSignal,
    coverageThreshold: legacy.coverageThreshold,
    testSpecRefs: task.testSpecRefs,
  };
}

export function migrateV1StateToEvents(v1: V1State): ForgeEvent[] {
  const at = v1.timestamps.started;
  const events: ForgeEvent[] = [
    {
      type: "run_created",
      at,
      orchestrationId: v1.orchestrationId,
      prdFile: v1.prdFile ?? "unknown",
    },
    {
      type: "phase_entered",
      at,
      phase: v1.currentPhase,
      label: v1.phaseLabel,
    },
  ];

  if (v1.orchestrationMode) {
    events.push({
      type: "routing_decided",
      at,
      mode: v1.orchestrationMode,
      rationale: v1.routingRationale,
    });
  }

  if (v1.requirementsFile) {
    events.push({ type: "requirements_written", at, file: v1.requirementsFile });
  }
  if (v1.planFile) {
    events.push({
      type: "plan_written",
      at,
      planFile: v1.planFile,
      tasksFile: v1.tasksFile,
      tasksMarkdownFile: v1.tasksMarkdownFile,
      costFile: v1.costFile,
    });
  }
  if (v1.testSpecFile && v1.testSpecs) {
    events.push({
      type: "test_spec_written",
      at,
      file: v1.testSpecFile,
      markdownFile: v1.testSpecMarkdownFile,
      specs: v1.testSpecs.map(toV2TestSpec),
    });
  }

  events.push({
    type: "tasks_registered",
    at,
    tasks: v1.tasks.map(toV2Task),
  });

  if (v1.nextAction) {
    events.push({
      type: "approval_required",
      at,
      nextAction: v1.nextAction,
      label: v1.phaseLabel,
    });
  }

  for (const task of v1.tasks) {
    const taskAt = task.startedAt ?? at;
    if (task.status === "ready") {
      events.push({ type: "task_ready", at: taskAt, taskId: task.id });
    }
    if (task.status === "running") {
      events.push({
        type: "task_started",
        at: taskAt,
        taskId: task.id,
        runAttempt: task.retries + 1,
        model: task.resolvedModel,
      });
    }
    if (task.status === "blocked" && task.blocker) {
      events.push({
        type: "task_blocked",
        at: taskAt,
        taskId: task.id,
        blocker: normalizeBlocker(task.blocker),
      });
      events.push({
        type: "human_intervention_requested",
        at: taskAt,
        taskId: task.id,
        reason: task.blocker.reason,
        suggestion: task.blocker.suggestion,
      });
    }
    if (task.status === "completed") {
      events.push({
        type: "task_completed",
        at: task.completedAt ?? taskAt,
        taskId: task.id,
        result: task.result,
      });
    }
    if (task.status === "failed") {
      events.push({
        type: "task_failed",
        at: task.completedAt ?? taskAt,
        taskId: task.id,
        error: task.error ?? "Task failed",
      });
    }
  }

  if (v1.reviewFile) {
    events.push({
      type: "integration_review_completed",
      at: v1.timestamps.completed ?? at,
      reviewFile: v1.reviewFile,
    });
  } else if (v1.status === "completed") {
    events.push({ type: "run_completed", at: v1.timestamps.completed ?? at });
  } else if (v1.status === "aborted") {
    events.push({ type: "run_aborted", at: v1.timestamps.completed ?? at, reason: "Migrated from v1 aborted state" });
  } else if (v1.status === "failed") {
    events.push({ type: "run_failed", at: v1.timestamps.completed ?? at, reason: "Migrated from v1 failed state" });
  }

  return events;
}

export function migrateV1StateToSnapshot(v1: V1State) {
  return replayEvents(migrateV1StateToEvents(v1));
}

export async function shouldImportLegacyState(layout: V2StorageLayout): Promise<boolean> {
  // If V2 events already exist, never re-import.
  if (existsSync(layout.eventsFile)) {
    try {
      const raw = await readFile(layout.eventsFile, "utf-8");
      const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length > 0) return false;
    } catch {
      // Treat read errors as empty.
    }
  }

  if (!existsSync(layout.snapshotFile)) return false;

  try {
    const raw = JSON.parse(await readFile(layout.snapshotFile, "utf-8"));
    // Already a V2 snapshot — do not treat as legacy.
    if (raw?.schemaVersion === 2 || raw?.schemaVersion === 3 || raw?.schemaVersion === 4) {
      return false;
    }
    // Presence of V1-shaped fields suggests legacy state.
    if (raw && typeof raw.orchestrationId === "string" && Array.isArray(raw.tasks)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function importLegacyState(layout: V2StorageLayout): Promise<{ imported: boolean; events: ForgeEvent[]; snapshot: RunSnapshot | null }> {
  if (!(await shouldImportLegacyState(layout))) {
    return { imported: false, events: [], snapshot: null };
  }

  const raw = JSON.parse(await readFile(layout.snapshotFile, "utf-8"));
  const events = migrateV1StateToEvents(raw);
  const snapshot = replayEvents(events);

  await mkdir(layout.baseDir, { recursive: true });

  for (const event of events) {
    await appendFile(layout.eventsFile, `${JSON.stringify(event)}\n`, "utf-8");
  }

  if (snapshot) {
    await writeFile(layout.snapshotFile, JSON.stringify(snapshot, null, 2), "utf-8");
  }

  return { imported: true, events, snapshot };
}

export function migrateV3ToV4(snapshot: Omit<RunSnapshot, "schemaVersion"> & { schemaVersion: 3 }): RunSnapshot {
  return {
    ...snapshot,
    schemaVersion: 4,
    planningRuntime: undefined,
  };
}

function normalizeSnapshotShape(snapshot: Partial<RunSnapshot> & { schemaVersion?: number }): RunSnapshot {
  const now = new Date().toISOString();
  return {
    ...(snapshot as RunSnapshot),
    schemaVersion: 4,
    orchestrationId: snapshot.orchestrationId ?? "unknown",
    status: snapshot.status ?? "planning",
    currentPhase: snapshot.currentPhase ?? 0,
    phaseLabel: snapshot.phaseLabel ?? "Scope Classification",
    prdFile: snapshot.prdFile ?? "unknown",
    resolvedModels: snapshot.resolvedModels ?? {},
    cost: snapshot.cost ?? {},
    tasks: snapshot.tasks ?? [],
    taskState: snapshot.taskState ?? {},
    blockers: snapshot.blockers ?? [],
    supervisors: snapshot.supervisors ?? {},
    timestamps: {
      started: snapshot.timestamps?.started ?? now,
      lastUpdated: snapshot.timestamps?.lastUpdated ?? snapshot.timestamps?.started ?? now,
      completed: snapshot.timestamps?.completed,
    },
  };
}

export function migrateSnapshot(snapshot: RunSnapshot): RunSnapshot {
  if (snapshot.schemaVersion === 4) {
    return normalizeSnapshotShape(snapshot);
  }

  if (snapshot.schemaVersion === 3) {
    return normalizeSnapshotShape(migrateV3ToV4(snapshot as Omit<RunSnapshot, "schemaVersion"> & { schemaVersion: 3 }));
  }

  return normalizeSnapshotShape(migrateV3ToV4({
    ...snapshot,
    schemaVersion: 3,
    planningRuntime: undefined,
  } as Omit<RunSnapshot, "schemaVersion"> & { schemaVersion: 3 }));
}
