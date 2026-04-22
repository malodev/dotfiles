import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { TaskForgeV2Engine } from "./engine.ts";
import { describeInterruptedExecution } from "./execution.ts";
import { describeInterruptedPlanning } from "./planning-recovery.ts";
import { createLayout, ensureLayout, loadSnapshot, readEvents } from "./storage.ts";
import type { ForgeTask } from "./types.ts";

function makeTask(id: string): ForgeTask {
  return {
    id,
    title: `Task ${id}`,
    description: "Fixture task",
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: [],
    dependencies: [],
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: {
      mode: "command",
      command: `echo ${id}`,
    },
  };
}

async function createHarness() {
  const cwd = await mkdtemp(join(tmpdir(), "tf-session-reconcile-"));
  const outputDir = ".task-forge-test";
  const layout = createLayout(cwd, outputDir);
  await ensureLayout(layout);
  const engine = new TaskForgeV2Engine(cwd, outputDir);
  return { cwd, outputDir, layout, engine };
}

async function writeArtifact(baseDir: string, file: string, content: string) {
  const path = join(baseDir, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
}

async function reconcileSessionStart(engine: TaskForgeV2Engine, layout: ReturnType<typeof createLayout>) {
  const authoritative = await loadSnapshot(layout);

  const recoveredExecution = describeInterruptedExecution(authoritative);
  if (recoveredExecution) {
    for (const taskId of recoveredExecution.requeuedTaskIds) {
      await engine.requeueTask(taskId, "Recovered after pi restart during active execution");
    }
    await engine.markRunPaused(
      recoveredExecution.label,
      recoveredExecution.nextAction,
      "Recovered after pi restart during active execution",
    );
  }

  if (authoritative) {
    const interruptedPlanning = await describeInterruptedPlanning(authoritative, layout);
    if (interruptedPlanning) {
      if (interruptedPlanning.kind === "resumable") {
        await engine.markRunRestored(authoritative.orchestrationId, "planning_interrupted_resumable");
        await engine.markRunPaused(
          `Planning interrupted — resumable (phase ${interruptedPlanning.phase})`,
          "continuePlanning",
          "Planning was interrupted but can be resumed from the last completed phase",
        );
      } else {
        await engine.markRunRestored(authoritative.orchestrationId, "planning_interrupted_restart_required");
        await engine.markRunResumed();
      }
    }
  }

  return await loadSnapshot(layout);
}

describe("session_start planning reconciliation integration", () => {
  it("resumable planning interruption emits run_restored + paused status", async () => {
    const { engine, layout } = await createHarness();

    await engine.createRun("orch-resumable", "prd.md");
    await engine.markRouting("standard", "requires full planning");
    await writeArtifact(layout.baseDir, "00-routing.json", JSON.stringify({ mode: "standard" }));

    await engine.enterPhase(1, "PRD Analysis");
    await engine.markRequirementsWritten("01-requirements.md");
    await writeArtifact(layout.baseDir, "01-requirements.md", "# requirements\n\nnon-empty");

    await engine.enterPhase(2, "Planning & Decomposition");
    await engine.markPlanningPhaseStarted("planner", 2, "Planning & Decomposition");
    await engine.markPlanningPhaseInterrupted("planner", 2);

    const reconciled = await reconcileSessionStart(engine, layout);
    assert.ok(reconciled, "expected reconciled snapshot");
    assert.strictEqual(reconciled.status, "paused");
    assert.strictEqual(reconciled.nextAction, "continuePlanning");
    assert.match(reconciled.phaseLabel, /Planning interrupted — resumable/);

    const events = await readEvents(layout);
    const restored = events.find((event) => event.type === "run_restored" && event.reason === "planning_interrupted_resumable");
    const paused = events.find((event) => event.type === "run_paused" && event.nextAction === "continuePlanning");

    assert.ok(restored, "expected planning_interrupted_resumable run_restored event");
    assert.ok(paused, "expected run_paused event with continuePlanning");
  });

  it("restart-required planning interruption emits restart-required restore events", async () => {
    const { engine, layout } = await createHarness();

    await engine.createRun("orch-restart", "prd.md");
    await engine.enterPhase(0, "Scope Classification");
    await engine.markPlanningPhaseStarted("scopeClassifier", 0, "Scope Classification");
    await engine.markPlanningPhaseInterrupted("scopeClassifier", 0);

    const reconciled = await reconcileSessionStart(engine, layout);
    assert.ok(reconciled, "expected reconciled snapshot");
    assert.strictEqual(reconciled.status, "planning");
    assert.strictEqual(reconciled.nextAction, undefined);

    const events = await readEvents(layout);
    const restored = events.find((event) => event.type === "run_restored" && event.reason === "planning_interrupted_restart_required");
    const resumed = events.find((event) => event.type === "run_resumed");
    const paused = events.find((event) => event.type === "run_paused" && event.nextAction === "continuePlanning");

    assert.ok(restored, "expected planning_interrupted_restart_required run_restored event");
    assert.ok(resumed, "expected run_resumed event to clear continuation action");
    assert.ok(!paused, "restart-required path must not pause with continuePlanning");
  });

  it("legacy planning snapshots are reconciled as restart-required", async () => {
    const { engine, layout } = await createHarness();

    await engine.createRun("orch-legacy", "prd.md");
    await engine.enterPhase(1, "PRD Analysis");

    const authoritative = await loadSnapshot(layout);
    assert.ok(authoritative, "expected authoritative snapshot");
    const interrupted = await describeInterruptedPlanning(authoritative, layout);
    assert.ok(interrupted, "expected interrupted planning to be detected");
    assert.strictEqual(interrupted?.kind, "restart_required");
    if (interrupted?.kind === "restart_required") {
      assert.match(interrupted.reason, /Legacy planning snapshot detected/);
    }

    const reconciled = await reconcileSessionStart(engine, layout);
    assert.ok(reconciled, "expected reconciled snapshot");
    assert.strictEqual(reconciled.status, "planning");
    assert.strictEqual(reconciled.nextAction, undefined);

    const events = await readEvents(layout);
    assert.ok(
      events.some((event) => event.type === "run_restored" && event.reason === "planning_interrupted_restart_required"),
      "expected restart-required restoration event for legacy snapshot",
    );
  });

  it("execution recovery behavior remains intact during session_start", async () => {
    const { engine, layout } = await createHarness();

    await engine.createRun("orch-execution", "prd.md");
    await engine.markExecutionPhaseStarted();
    await engine.registerTasks([makeTask("TASK-001")]);
    await engine.markTaskReady("TASK-001");
    await engine.markTaskStarted("TASK-001", 1, "model-x");

    const reconciled = await reconcileSessionStart(engine, layout);
    assert.ok(reconciled, "expected reconciled snapshot");
    assert.strictEqual(reconciled.status, "paused");
    assert.strictEqual(reconciled.nextAction, "executePlan");
    assert.strictEqual(reconciled.taskState["TASK-001"]?.status, "pending");

    const events = await readEvents(layout);
    assert.ok(
      events.some((event) => event.type === "task_requeued" && event.taskId === "TASK-001"),
      "expected running task to be requeued",
    );
    assert.ok(
      events.some((event) => event.type === "run_paused" && event.nextAction === "executePlan"),
      "expected execution recovery pause event",
    );
    assert.ok(
      !events.some((event) => event.type === "run_restored" && String(event.reason).startsWith("planning_interrupted_")),
      "execution recovery path should not emit planning run_restored events",
    );
  });
});
