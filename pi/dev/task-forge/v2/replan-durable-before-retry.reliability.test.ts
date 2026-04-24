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

function makeTask(id: string, dependencies: string[], command: string): ForgeTask {
  return {
    id,
    title: `Task ${id}`,
    description: "Task used for replan durability checks",
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: [],
    dependencies,
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

function subgraphReplanResolution(specs: TestSpecEntry[]) {
  return [
    "Apply subgraph replan and commit regenerated artifacts before retry:",
    "```json",
    JSON.stringify({ replan: { scope: "subgraph", specs } }),
    "```",
  ].join("\n");
}

describe("replan-durable-before-retry.reliability", () => {
  it("regenerated replan artifacts are durable before retry and survive restart", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
    const layout = createLayout(cwd, ".task-forge-test");
    await ensureLayout(layout);

    const firstEngine = new TaskForgeV2Engine(cwd, ".task-forge-test");
    await firstEngine.createRun("orch-replan-durable", "prd.md");
    await firstEngine.registerTasks([
      makeTask("TF-06", [], "pnpm test -- tf-06-initial"),
      makeTask("TF-07", ["TF-06"], "pnpm test -- tf-07-initial"),
    ]);
    await firstEngine.markTestSpecWritten("test-specs.json", [
      makeSpec("TF-06", "pnpm test -- tf-06-initial"),
      makeSpec("TF-07", "pnpm test -- tf-07-initial"),
    ]);

    await firstEngine.markTaskBlocked("TF-06", {
      category: "plan_contract",
      reason: "Subgraph dependencies invalid",
      suggestion: "Replan affected subgraph and retry",
      blockedTasks: ["TF-06", "TF-07"],
    });
    await firstEngine.requestHumanIntervention("TF-06", "Dependency impact detected", "Replan subgraph and retry");

    await firstEngine.resolveHumanIntervention(
      "TF-06",
      subgraphReplanResolution([
        makeSpec("TF-06", "pnpm test -- tf-06-replanned"),
        makeSpec("TF-07", "pnpm test -- tf-07-replanned"),
      ]),
    );

    const events = await readEvents(layout);
    const resolutionIndex = events.findIndex((event: any) => event.type === "human_intervention_resolved" && event.taskId === "TF-06");
    const replanIndex = events.findIndex((event: any, index: number) => index > resolutionIndex && event.type === "test_spec_written");
    const requeueIndex = events.findIndex((event: any) => event.type === "task_requeued" && event.taskId === "TF-06");

    assert(replanIndex >= 0, "expected durable replan artifact write event");
    assert(requeueIndex >= 0, "expected task requeue event");
    assert(replanIndex < requeueIndex, "expected regenerated artifacts to persist before retry transition");

    const reloadedEngine = new TaskForgeV2Engine(cwd, ".task-forge-test");
    const reloadedSnapshot = await reloadedEngine.snapshot();
    assert(reloadedSnapshot, "expected snapshot after restart");

    const tf06 = reloadedSnapshot.testSpecs?.find((entry) => entry.taskId === "TF-06");
    const tf07 = reloadedSnapshot.testSpecs?.find((entry) => entry.taskId === "TF-07");
    assert(tf06?.validation.mode === "command" && tf06.validation.command === "pnpm test -- tf-06-replanned", "expected TF-06 replanned spec after restart");
    assert(tf07?.validation.mode === "command" && tf07.validation.command === "pnpm test -- tf-07-replanned", "expected TF-07 replanned spec after restart");

    const persisted = await loadSnapshot(layout);
    assert(persisted, "expected persisted snapshot");
  });
});
