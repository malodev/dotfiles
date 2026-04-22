import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { TaskForgeV2Engine } from "../../../agent/extensions/task-forge/v2/engine.ts";
import { createLayout, ensureLayout, loadSnapshot, readEvents } from "../../../agent/extensions/task-forge/v2/storage.ts";
import type { ForgeTask, TestSpecEntry } from "../../../agent/extensions/task-forge/v2/types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeTask(taskId: string, command: string): ForgeTask {
  return {
    id: taskId,
    title: taskId,
    description: "plan/test mismatch fixture",
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

function makeSpec(taskId: string, command: string): TestSpecEntry {
  return {
    taskId,
    validation: {
      mode: "command",
      command,
    },
    acceptance_signal: command,
  };
}

it("Plan/test-spec mismatch remediation applies patch or replan before retry", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
  const layout = createLayout(cwd, ".task-forge-test");
  await ensureLayout(layout);

  const engine = new TaskForgeV2Engine(cwd, ".task-forge-test");
  await engine.createRun("orch-plan-spec-mismatch", "prd.md");
  await engine.registerTasks([makeTask("TF-08C", "pnpm test -- stale-task-command")]);
  await engine.markTestSpecWritten("test-specs.json", [makeSpec("TF-08C", "pnpm test -- stale-spec-command")]);

  await engine.markTaskBlocked("TF-08C", {
    category: "validation_contract",
    reason: "Plan/test-spec mismatch: generated tests point to wrong acceptance command",
    suggestion: "Patch test spec validation command before retry",
    blockedTasks: ["TF-08C"],
  });
  await engine.requestHumanIntervention("TF-08C", "Plan/test-spec mismatch", "Patch test spec validation command");

  await engine.resolveHumanIntervention(
    "TF-08C",
    [
      "Patch test spec:",
      "```json",
      JSON.stringify({ validation: { mode: "command", command: "pnpm test -- corrected-spec-command" } }),
      "```",
    ].join("\n"),
  );

  const events = await readEvents(layout);
  const patchIndex = events.findIndex((event: any) => event.type === "test_spec_patched" && event.taskId === "TF-08C");
  const replanIndex = events.findIndex((event: any) => event.type === "test_spec_written");
  const requeueIndex = events.findIndex((event: any) => event.type === "task_requeued" && event.taskId === "TF-08C");

  assert(requeueIndex >= 0, "expected retry requeue event");
  assert(
    (patchIndex >= 0 && patchIndex < requeueIndex) || (replanIndex >= 0 && replanIndex < requeueIndex),
    "expected patch/replan artifact persisted before retry",
  );

  const snapshot = await loadSnapshot(layout);
  assert(snapshot, "expected snapshot");

  const task = snapshot.tasks.find((entry) => entry.id === "TF-08C");
  assert(task, "expected target task");
  assert(
    task.validation.mode === "command" && task.validation.command === "pnpm test -- stale-task-command",
    "expected task contract to remain unchanged for spec-only remediation",
  );

  const testSpec = snapshot.testSpecs?.find((entry) => entry.taskId === "TF-08C");
  assert(testSpec, "expected patched test spec");
  assert(
    testSpec.validation.mode === "command" && testSpec.validation.command === "pnpm test -- corrected-spec-command",
    "expected corrected validation command persisted in test spec",
  );
});
