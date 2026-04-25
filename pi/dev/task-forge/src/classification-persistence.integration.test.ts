import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLayout, ensureLayout, loadSnapshot, writeSnapshot } from "./storage.ts";
import type { RunSnapshot } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeSnapshot(): RunSnapshot {
  return {
    schemaVersion: 4,
    orchestrationId: "orch-classification",
    status: "needs_human_intervention",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: {},
    cost: {},
    tasks: [],
    taskState: {
      "TF-02": {
        taskId: "TF-02",
        status: "blocked",
        retries: 1,
        runAttempt: 1,
        diagnostic: {
          classification: "requirement_or_plan_error",
          notes: "Acceptance command is prose, not executable",
          blockerCategory: "validation_contract",
        },
        blocker: {
          taskId: "TF-02",
          category: "validation_contract",
          reason: "Acceptance command is prose, not executable",
          suggestion: "Replace the prose validation with manual validation or an executable command",
          blockedTasks: ["TF-02"],
        },
      },
      "TF-03": {
        taskId: "TF-03",
        status: "blocked",
        retries: 0,
        runAttempt: 1,
        blocker: {
          taskId: "TF-03",
          category: "dependency",
          reason: "Blocked by failed dependency: TF-02",
          suggestion: "Resolve TF-02 first",
          blockedTasks: ["TF-03", "TF-02"],
        },
      },
    },
    blockers: [
      {
        taskId: "TF-02",
        category: "validation_contract",
        reason: "Acceptance command is prose, not executable",
        suggestion: "Replace the prose validation with manual validation or an executable command",
        blockedTasks: ["TF-02"],
      },
      {
        taskId: "TF-03",
        category: "dependency",
        reason: "Blocked by failed dependency: TF-02",
        suggestion: "Resolve TF-02 first",
        blockedTasks: ["TF-03", "TF-02"],
      },
    ],
    supervisors: {},
    timestamps: {
      started: "2026-04-18T15:00:00.000Z",
      lastUpdated: "2026-04-18T15:05:00.000Z",
    },
  };
}

describe("classification-persistence", () => {
  it("classification metadata is durably persisted", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
    const layout = createLayout(cwd, ".task-forge-test");
    await ensureLayout(layout);
    await writeSnapshot(layout, makeSnapshot());

    const persisted = JSON.parse(await readFile(layout.snapshotFile, "utf-8")) as RunSnapshot;
    assert(persisted.taskState["TF-02"].diagnostic?.blockerCategory === "validation_contract", "expected diagnostic blocker category in persisted snapshot");
    assert(persisted.blockers.find((blocker) => blocker.taskId === "TF-03")?.category === "dependency", "expected dependency blocker category to persist distinctly");
  });

  it("classification metadata is recoverable after restart", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
    const layout = createLayout(cwd, ".task-forge-test");
    await ensureLayout(layout);
    await writeSnapshot(layout, makeSnapshot());

    const restored = await loadSnapshot(layout);
    assert(restored, "expected snapshot to reload after restart");
    assert(restored.taskState["TF-02"].diagnostic?.blockerCategory === "validation_contract", "expected diagnostic blocker category after reload");
    assert(restored.taskState["TF-02"].blocker?.category === "validation_contract", "expected root blocker category after reload");
    assert(restored.taskState["TF-03"].blocker?.category === "dependency", "expected dependency blocker category after reload");
  });
});
