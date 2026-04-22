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
    description: "Task used for replan scope selection integration checks",
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

function replanResolution(scope: "task" | "subgraph", specs: TestSpecEntry[]) {
  return [
    `Apply ${scope} replan and persist regenerated artifacts before retry:`,
    "```json",
    JSON.stringify({ replan: { scope, specs } }),
    "```",
  ].join("\n");
}

async function setupGraph() {
  const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
  const layout = createLayout(cwd, ".task-forge-test");
  await ensureLayout(layout);

  const engine = new TaskForgeV2Engine(cwd, ".task-forge-test");
  await engine.createRun("orch-replan-scope", "prd.md");

  await engine.registerTasks([
    makeTask("TF-06", [], "pnpm test -- tf-06-initial"),
    makeTask("TF-07", ["TF-06"], "pnpm test -- tf-07-initial"),
    makeTask("TF-99", [], "pnpm test -- tf-99-initial"),
  ]);

  await engine.markTestSpecWritten("test-specs.json", [
    makeSpec("TF-06", "pnpm test -- tf-06-initial"),
    makeSpec("TF-07", "pnpm test -- tf-07-initial"),
    makeSpec("TF-99", "pnpm test -- tf-99-initial"),
  ]);

  return { cwd, layout, engine };
}

describe("replan-scope-selection.integration", () => {
  it("task-only replan affects only intended task when sufficient", async () => {
    const { layout, engine } = await setupGraph();

    await engine.markTaskBlocked("TF-06", {
      category: "plan_contract",
      reason: "Task plan is invalid and requires replanning only this task",
      suggestion: "Replan task only and regenerate only TF-06 artifacts",
      blockedTasks: ["TF-06"],
    });
    await engine.requestHumanIntervention("TF-06", "Task plan mismatch", "Replan task only");

    await engine.resolveHumanIntervention(
      "TF-06",
      replanResolution("task", [makeSpec("TF-06", "pnpm test -- tf-06-replanned")]),
    );

    const events = await readEvents(layout);
    const resolutionEvent = [...events].reverse().find((event: any) => event.type === "human_intervention_resolved" && event.taskId === "TF-06");
    assert(resolutionEvent?.resolutionMode === "replan_task", "expected resolution mode to be replan_task");

    const resolutionIndex = events.findIndex((event: any) => event === resolutionEvent);
    const replanSpecsEvent = events.slice(resolutionIndex + 1).find((event: any) => event.type === "test_spec_written");
    const requeueIndex = events.findIndex((event: any) => event.type === "task_requeued" && event.taskId === "TF-06");
    const replanIndex = events.findIndex((event: any) => event === replanSpecsEvent);

    assert(replanSpecsEvent, "expected a regenerated test_spec_written event after replan_task resolution");
    assert(replanIndex < requeueIndex, "expected regenerated artifacts to persist before task retry");

    const regeneratedTaskIds = (replanSpecsEvent as any).specs.map((entry: any) => entry.taskId).sort();
    assert(regeneratedTaskIds.length === 1 && regeneratedTaskIds[0] === "TF-06", "expected only TF-06 artifacts to be regenerated");

    const snapshot = await loadSnapshot(layout);
    assert(snapshot, "expected snapshot");
    const tf06 = snapshot.testSpecs?.find((entry) => entry.taskId === "TF-06");
    const tf07 = snapshot.testSpecs?.find((entry) => entry.taskId === "TF-07");
    assert(tf06?.validation.mode === "command" && tf06.validation.command === "pnpm test -- tf-06-replanned", "expected TF-06 spec to be regenerated");
    assert(tf07?.validation.mode === "command" && tf07.validation.command === "pnpm test -- tf-07-initial", "expected TF-07 to remain unchanged on task-only path");
  });

  it("subgraph replan affects dependency-impacted subset when required", async () => {
    const { layout, engine } = await setupGraph();

    await engine.markTaskBlocked("TF-06", {
      category: "plan_contract",
      reason: "Dependency chain is invalid and needs subgraph replan",
      suggestion: "Replan affected task subtree (subgraph)",
      blockedTasks: ["TF-06", "TF-07"],
    });
    await engine.requestHumanIntervention("TF-06", "Plan invalid for dependency chain", "Replan affected subgraph");

    await engine.resolveHumanIntervention(
      "TF-06",
      replanResolution("subgraph", [
        makeSpec("TF-06", "pnpm test -- tf-06-subgraph"),
        makeSpec("TF-07", "pnpm test -- tf-07-subgraph"),
      ]),
    );

    const events = await readEvents(layout);
    const resolutionEvent = [...events].reverse().find((event: any) => event.type === "human_intervention_resolved" && event.taskId === "TF-06");
    assert(resolutionEvent?.resolutionMode === "replan_subgraph", "expected resolution mode to be replan_subgraph");

    const resolutionIndex = events.findIndex((event: any) => event === resolutionEvent);
    const replanSpecsEvent = events.slice(resolutionIndex + 1).find((event: any) => event.type === "test_spec_written");
    assert(replanSpecsEvent, "expected regenerated test_spec_written event for replan_subgraph");

    const regeneratedTaskIds = (replanSpecsEvent as any).specs.map((entry: any) => entry.taskId).sort();
    assert(
      regeneratedTaskIds.join(",") === "TF-06,TF-07",
      "expected subgraph replan to regenerate only dependency-impacted subset",
    );
    assert(!regeneratedTaskIds.includes("TF-99"), "expected unrelated TF-99 artifacts to remain untouched");
  });
});
