import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { TaskForgeV2Engine } from "../../../agent/extensions/task-forge/v2/engine.ts";
import { createLayout, ensureLayout, loadSnapshot, readEvents } from "../../../agent/extensions/task-forge/v2/storage.ts";
import type { ForgeTask } from "../../../agent/extensions/task-forge/v2/types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeTask(taskId: string): ForgeTask {
  return {
    id: taskId,
    title: taskId,
    description: "restart recovery fixture",
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: [],
    dependencies: [],
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: {
      mode: "command",
      command: "Acceptance is prose and non-executable",
    },
  };
}

it("Restart during remediation does not requeue stale contract/spec", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
  const layout = createLayout(cwd, ".task-forge-test");
  await ensureLayout(layout);

  const firstEngine = new TaskForgeV2Engine(cwd, ".task-forge-test");
  await firstEngine.createRun("orch-restart-recovery", "prd.md");
  await firstEngine.registerTasks([makeTask("TF-08D")]);

  await firstEngine.markTaskBlocked("TF-08D", {
    category: "validation_contract",
    reason: "Acceptance command is not executable",
    suggestion: "Patch validation command before requeue",
    blockedTasks: ["TF-08D"],
  });
  await firstEngine.requestHumanIntervention("TF-08D", "Acceptance command is not executable", "Patch validation command");

  const resolution = [
    "Patch contract:",
    "```json",
    JSON.stringify({ validation: { mode: "command", command: "pnpm test -- tests/reliability/restart-recovery" } }),
    "```",
  ].join("\n");

  // crash_between_commit_and_requeue_fixture:
  // persist resolution + durable patch, but intentionally skip task_requeued before restart.
  await firstEngine.append({
    type: "human_intervention_resolved",
    at: "2026-04-19T12:00:00.000Z",
    taskId: "TF-08D",
    resolution,
    resolutionMode: "patch_task_contract",
  });
  await firstEngine.append({
    type: "task_contract_patched",
    at: "2026-04-19T12:00:01.000Z",
    taskId: "TF-08D",
    patch: { validation: { mode: "command", command: "pnpm test -- tests/reliability/restart-recovery" } },
    durabilityCommitRef: "TF-08D:durable-patch-before-crash",
  });

  // restart_recovery_harness
  const restartedEngine = new TaskForgeV2Engine(cwd, ".task-forge-test");
  const snapshotAfterRestart = await restartedEngine.snapshot();
  assert(snapshotAfterRestart, "expected snapshot after restart");

  const task = snapshotAfterRestart.tasks.find((entry) => entry.id === "TF-08D");
  assert(task, "expected task after restart");
  assert(
    task.validation.mode === "command" && task.validation.command === "pnpm test -- tests/reliability/restart-recovery",
    "expected durable patched contract to survive restart",
  );

  const requeueEventsBeforeResume = (await readEvents(layout)).filter((event: any) => event.type === "task_requeued" && event.taskId === "TF-08D");
  assert(requeueEventsBeforeResume.length === 0, "expected no stale requeue emitted before recovery resumes");

  const persistedSnapshot = await loadSnapshot(layout);
  assert(persistedSnapshot, "expected persisted state");
  assert(
    persistedSnapshot.tasks.find((entry) => entry.id === "TF-08D")?.validation.mode === "command",
    "expected persisted snapshot to include patched validation contract",
  );

  await restartedEngine.requeueTask("TF-08D", "resume after restart");
  const resumedTask = (await restartedEngine.snapshot())?.tasks.find((entry) => entry.id === "TF-08D");
  assert(resumedTask, "expected task after explicit resume");
  const preflight = await restartedEngine.preflightTask(resumedTask);
  assert(preflight.ok, "expected resumed task to use patched contract instead of stale contract");
});
