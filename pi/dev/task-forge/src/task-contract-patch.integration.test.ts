import { describe, it } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskForgeV2Engine } from "./engine.ts";
import { createLayout, ensureLayout, loadSnapshot, readEvents } from "./storage.ts";
import type { ForgeTask } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeTask(id: string): ForgeTask {
  return {
    id,
    title: "Repair validation contract",
    description: "Fix invalid validation contract",
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: [],
    dependencies: [],
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: {
      mode: "command",
      command: "pnpm test -- broken",
    },
  };
}

async function setupBlockedValidationContractTask(taskId: string) {
  const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
  const layout = createLayout(cwd, ".task-forge-test");
  await ensureLayout(layout);
  const engine = new TaskForgeV2Engine(cwd, ".task-forge-test");

  await engine.createRun(`orch-${taskId}`, "prd.md");
  await engine.registerTasks([makeTask(taskId)]);
  await engine.markTaskBlocked(taskId, {
    category: "validation_contract",
    reason: "Validation contract is prose and not executable",
    suggestion: "Patch task validation contract",
    blockedTasks: [taskId],
  });
  await engine.requestHumanIntervention(taskId, "Validation contract is prose and not executable", "Patch task validation contract");

  return { layout, engine };
}

describe("task-contract-patch.integration", () => {
  it("task contract patch persists durably before requeue and updates task contract", async () => {
    const { layout, engine } = await setupBlockedValidationContractTask("TF-04");

    await engine.resolveHumanIntervention("TF-04", "Use executable checker invocation: `node --test ./agent/extensions/task-forge/v2`");

    const events = await readEvents(layout);
    const patchIndex = events.findIndex((event) => event.type === "task_contract_patched" && event.taskId === "TF-04");
    const requeueIndex = events.findIndex((event) => event.type === "task_requeued" && event.taskId === "TF-04");
    assert(patchIndex >= 0, "expected a durable task_contract_patched event");
    assert(requeueIndex >= 0, "expected a task_requeued event");
    assert(patchIndex < requeueIndex, "expected patch commit to be persisted before requeue transition");

    const snapshot = await loadSnapshot(layout);
    assert(snapshot, "expected snapshot");
    const task = snapshot.tasks.find((entry) => entry.id === "TF-04");
    assert(task, "expected patched task in snapshot");
    assert(task.validation.mode === "command", "expected task validation to remain command mode");
    assert(task.validation.mode === "command" && task.validation.command.includes("node --test"), "expected snapshot to hold updated validation command");
  });

  it("out-of-allowlist task contract patch fields are rejected", async () => {
    const { engine } = await setupBlockedValidationContractTask("TF-04-INVALID");

    let rejected = false;
    try {
      await engine.resolveHumanIntervention(
        "TF-04-INVALID",
        [
          "Apply this patch:",
          "```json",
          JSON.stringify({
            validation: { mode: "command", command: "node --test" },
            title: "should-not-be-mutable",
          }),
          "```",
        ].join("\n"),
      );
    } catch (error: any) {
      rejected = String(error?.message ?? "").includes("outside allowlist");
    }

    assert(rejected, "expected out-of-allowlist task contract patch rejection");
  });
});
