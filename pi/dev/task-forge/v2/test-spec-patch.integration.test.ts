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
    description: "Task used for test-spec patch remediation",
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
    testFiles: [
      {
        path: `src/${taskId.toLowerCase()}.spec.ts`,
        type: "integration",
        targets: ["spec patch target"],
      },
    ],
  };
}

describe("test-spec-patch.integration", () => {
  it("plan/test-spec mismatch blockers are remediated by scoped test-spec patching", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
    const layout = createLayout(cwd, ".task-forge-test");
    await ensureLayout(layout);

    const engine = new TaskForgeV2Engine(cwd, ".task-forge-test");
    await engine.createRun("orch-tf-05", "prd.md");

    const targetTask = makeTask("TF-05", "pnpm test -- stale-command");
    const unrelatedTask = makeTask("TF-99", "pnpm test -- unrelated-task");
    await engine.registerTasks([targetTask, unrelatedTask]);

    await engine.markTestSpecWritten("test-specs.json", [
      makeSpec("TF-05", "pnpm test -- stale-command"),
      makeSpec("TF-99", "pnpm test -- unrelated-spec"),
    ]);

    await engine.markTaskBlocked("TF-05", {
      category: "validation_contract",
      reason: "Plan/test-spec mismatch: generated test spec points to wrong acceptance command",
      suggestion: "Patch test spec validation command only",
      blockedTasks: ["TF-05"],
    });
    await engine.requestHumanIntervention("TF-05", "Plan/test-spec mismatch", "Patch test spec validation command only");

    await engine.resolveHumanIntervention(
      "TF-05",
      [
        "Patch test spec with this scoped payload:",
        "```json",
        JSON.stringify({ validation: { mode: "command", command: "pnpm test -- corrected-command" } }),
        "```",
      ].join("\n"),
    );

    const events = await readEvents(layout);
    const patchIndex = events.findIndex((event: any) => event.type === "test_spec_patched" && event.taskId === "TF-05");
    const requeueIndex = events.findIndex((event: any) => event.type === "task_requeued" && event.taskId === "TF-05");
    assert(patchIndex >= 0, "expected durable test_spec_patched event for TF-05");
    assert(requeueIndex >= 0, "expected task_requeued event for TF-05");
    assert(patchIndex < requeueIndex, "expected test-spec patch durability commit before requeue");

    const snapshot = await loadSnapshot(layout);
    assert(snapshot, "expected snapshot");

    const patchedSpec = snapshot.testSpecs?.find((entry) => entry.taskId === "TF-05");
    assert(patchedSpec, "expected TF-05 test spec entry");
    assert(patchedSpec.validation.mode === "command", "expected patched TF-05 validation mode to remain command");
    assert(
      patchedSpec.validation.mode === "command" && patchedSpec.validation.command === "pnpm test -- corrected-command",
      "expected TF-05 test spec validation command to be patched",
    );

    const unrelatedSpec = snapshot.testSpecs?.find((entry) => entry.taskId === "TF-99");
    assert(unrelatedSpec, "expected unrelated TF-99 test spec entry to remain");
    assert(
      unrelatedSpec.validation.mode === "command" && unrelatedSpec.validation.command === "pnpm test -- unrelated-spec",
      "expected unrelated test spec to stay unchanged",
    );
  });
});
