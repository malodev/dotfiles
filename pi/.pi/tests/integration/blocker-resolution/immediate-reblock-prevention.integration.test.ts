import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { TaskForgeV2Engine } from "../../../agent/extensions/task-forge/v2/engine.ts";
import { createLayout, ensureLayout, loadSnapshot, readEvents } from "../../../agent/extensions/task-forge/v2/storage.ts";
import type { ForgeTask, RunSnapshot } from "../../../agent/extensions/task-forge/v2/types.ts";

const TEST_ROOT = ".task-forge-test";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeCommandTask(taskId: string, command: string): ForgeTask {
  return {
    id: taskId,
    title: `Task ${taskId}`,
    description: "Contract-aware remediation fixture",
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: [],
    dependencies: [],
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: {
      mode: "command",
      command,
    },
  };
}

async function setupEngine(orchestrationId: string) {
  const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
  const layout = createLayout(cwd, TEST_ROOT);
  await ensureLayout(layout);

  const engine = new TaskForgeV2Engine(cwd, TEST_ROOT);
  await engine.createRun(orchestrationId, "prd.md");

  return { cwd, layout, engine };
}

function toPatchResolution(prefix: string, patch: unknown): string {
  return [prefix, "```json", JSON.stringify(patch), "```"].join("\n");
}

function findTask(snapshot: RunSnapshot, taskId: string) {
  const task = snapshot.tasks.find((entry) => entry.id === taskId);
  assert(task, `expected task ${taskId}`);
  return task;
}

it("Invalid/non-executable acceptance command scenario is structurally corrected before retry and does not immediately re-block", async () => {
  const { layout, engine } = await setupEngine("orch-invalid-contract");
  await engine.registerTasks([makeCommandTask("TF-08A", "Validate manually by reading logs")]);

  await engine.markTaskBlocked("TF-08A", {
    category: "validation_contract",
    reason: "Validation contract is prose and cannot be executed",
    suggestion: "Patch task validation contract with an executable command",
    blockedTasks: ["TF-08A"],
  });
  await engine.requestHumanIntervention("TF-08A", "Validation contract is prose and cannot be executed", "Patch task validation contract");

  await engine.resolveHumanIntervention(
    "TF-08A",
    toPatchResolution("Apply patch:", {
      validation: { mode: "command", command: "pnpm test -- tests/integration/blocker-resolution" },
    }),
  );

  const events = await readEvents(layout);
  const patchIndex = events.findIndex((event: any) => event.type === "task_contract_patched" && event.taskId === "TF-08A");
  const requeueIndex = events.findIndex((event: any) => event.type === "task_requeued" && event.taskId === "TF-08A");
  assert(patchIndex >= 0, "expected durable task contract patch event");
  assert(requeueIndex >= 0, "expected task requeue after remediation");
  assert(patchIndex < requeueIndex, "expected contract patch to commit before retry requeue");

  const snapshot = await loadSnapshot(layout);
  assert(snapshot, "expected snapshot");
  const task = findTask(snapshot, "TF-08A");
  assert(task.validation.mode === "command", "expected executable validation mode");
  assert(
    task.validation.mode === "command" && task.validation.command === "pnpm test -- tests/integration/blocker-resolution",
    "expected corrected executable command persisted to task contract",
  );
  assert(snapshot.taskState["TF-08A"]?.status === "pending", "expected task to be pending after retry queueing");
  assert(!snapshot.taskState["TF-08A"]?.blocker, "expected no immediate re-blocker after structural correction");

  const preflight = await engine.preflightTask(task);
  assert(preflight.ok, "expected patched contract to pass preflight and avoid immediate re-block");
});

it("Manual validation misrepresented as executable is corrected and persisted", async () => {
  const { cwd, layout, engine } = await setupEngine("orch-manual-correction");
  await engine.registerTasks([makeCommandTask("TF-08B", "manual verification required")]);

  await engine.markTaskBlocked("TF-08B", {
    category: "validation_contract",
    reason: "Manual validation was misrepresented as an executable command",
    suggestion: "Convert validation contract to manual mode",
    blockedTasks: ["TF-08B"],
  });
  await engine.requestHumanIntervention("TF-08B", "Contract mismatch", "Convert to manual validation");

  await engine.resolveHumanIntervention(
    "TF-08B",
    toPatchResolution("Apply patch:", {
      validation: {
        mode: "manual",
        notes: "Manual validation: reviewer checks generated remediation notes and approval log.",
      },
    }),
  );

  const reloadedEngine = new TaskForgeV2Engine(cwd, ".task-forge-test");
  const snapshot = await reloadedEngine.snapshot();
  assert(snapshot, "expected snapshot after restart");
  const task = findTask(snapshot, "TF-08B");
  assert(task.validation.mode === "manual", "expected validation mode migrated to manual");
  assert(
    task.validation.mode === "manual" && task.validation.notes.includes("Manual validation"),
    "expected persisted manual validation notes",
  );

  const events = await readEvents(layout);
  const patchEvents = events.filter((event: any) => event.type === "task_contract_patched" && event.taskId === "TF-08B");
  assert(patchEvents.length === 1, "expected exactly one durable contract correction event for manual-mode fix");
});
