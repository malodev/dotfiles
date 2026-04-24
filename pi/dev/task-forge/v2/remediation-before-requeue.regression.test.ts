import { describe, it } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskForgeV2Engine } from "./engine.ts";
import { createLayout, ensureLayout, loadSnapshot } from "./storage.ts";
import type { ForgeTask } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeTask(id: string): ForgeTask {
  return {
    id,
    title: "Validation contract repair",
    description: "Fix and retry",
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: [],
    dependencies: [],
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: {
      mode: "command",
      command: "manual verification only",
    },
  };
}

describe("remediation-before-requeue.regression", () => {
  it("corrected task contract remediation prevents immediate re-block loop", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
    const layout = createLayout(cwd, ".task-forge-test");
    await ensureLayout(layout);
    const engine = new TaskForgeV2Engine(cwd, ".task-forge-test");

    await engine.createRun("orch-regression", "prd.md");
    await engine.registerTasks([makeTask("TF-04-REG")]);
    await engine.markTaskBlocked("TF-04-REG", {
      category: "validation_contract",
      reason: "Validation command is not executable",
      suggestion: "Provide executable command",
      blockedTasks: ["TF-04-REG"],
    });
    await engine.requestHumanIntervention("TF-04-REG", "Validation command is not executable", "Provide executable command");

    await engine.resolveHumanIntervention("TF-04-REG", "Use this executable command: `node --test ./agent/extensions/task-forge/v2/blocker-resolution.test.ts`");

    const snapshot = await loadSnapshot(layout);
    assert(snapshot, "expected snapshot");
    const task = snapshot.tasks.find((entry) => entry.id === "TF-04-REG");
    assert(task, "expected updated task");

    const preflight = await engine.preflightTask(task);
    assert(preflight.ok, "expected preflight to pass using remediated task contract");
  });
});
