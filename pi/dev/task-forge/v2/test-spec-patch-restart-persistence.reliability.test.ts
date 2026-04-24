import { describe, it } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskForgeV2Engine } from "./engine.ts";
import { createLayout, ensureLayout, loadSnapshot, readEvents } from "./storage.ts";
import type { ForgeTask, TestSpecEntry } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeTask(id: string, command: string): ForgeTask {
  return {
    id,
    title: `Task ${id}`,
    description: "Task used for restart durability checks",
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

describe("test-spec-patch-restart-persistence.reliability", () => {
  it("test-spec patch remains durable across restart before retry", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
    const layout = createLayout(cwd, ".task-forge-test");
    await ensureLayout(layout);

    const firstEngine = new TaskForgeV2Engine(cwd, ".task-forge-test");
    await firstEngine.createRun("orch-tf-05-restart", "prd.md");
    await firstEngine.registerTasks([makeTask("TF-05", "pnpm test -- stale-command")]);
    await firstEngine.markTestSpecWritten("test-specs.json", [makeSpec("TF-05", "pnpm test -- stale-command")]);

    await firstEngine.markTaskBlocked("TF-05", {
      category: "validation_contract",
      reason: "Plan/test-spec mismatch for acceptance command",
      suggestion: "Patch test spec command and retry",
      blockedTasks: ["TF-05"],
    });
    await firstEngine.requestHumanIntervention("TF-05", "Plan/test-spec mismatch", "Patch test spec command and retry");

    await firstEngine.resolveHumanIntervention(
      "TF-05",
      [
        "Patch test spec JSON:",
        "```json",
        JSON.stringify({ validation: { mode: "command", command: "pnpm test -- corrected-after-restart" } }),
        "```",
      ].join("\n"),
    );

    const reloadedEngine = new TaskForgeV2Engine(cwd, ".task-forge-test");
    const reloadedSnapshot = await reloadedEngine.snapshot();
    assert(reloadedSnapshot, "expected snapshot after restart");

    const targetSpec = reloadedSnapshot.testSpecs?.find((entry) => entry.taskId === "TF-05");
    assert(targetSpec, "expected TF-05 spec after restart");
    assert(
      targetSpec.validation.mode === "command" && targetSpec.validation.command === "pnpm test -- corrected-after-restart",
      "expected corrected spec command to survive restart",
    );

    const events = await readEvents(layout);
    const patchIndex = events.findIndex((event: any) => event.type === "test_spec_patched" && event.taskId === "TF-05");
    const requeueIndex = events.findIndex((event: any) => event.type === "task_requeued" && event.taskId === "TF-05");
    assert(patchIndex >= 0, "expected persisted test_spec_patched event");
    assert(requeueIndex >= 0, "expected task_requeued event");
    assert(patchIndex < requeueIndex, "expected test-spec patch commit before task requeue");

    const persistedSnapshot = await loadSnapshot(layout);
    assert(persistedSnapshot, "expected persisted state file");
    const persistedSpec = persistedSnapshot.testSpecs?.find((entry) => entry.taskId === "TF-05");
    assert(persistedSpec, "expected persisted TF-05 test spec");
    assert(
      persistedSpec.validation.mode === "command" && persistedSpec.validation.command === "pnpm test -- corrected-after-restart",
      "expected persisted snapshot to contain patched command",
    );
  });
});
