import { describe, it } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLayout, ensureLayout, loadSnapshot, writeSnapshot } from "./storage.ts";
import type { RunSnapshot } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeLegacySnapshot(): RunSnapshot {
  return {
    schemaVersion: 2,
    orchestrationId: "orch-1",
    status: "needs_human_intervention",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: {},
    cost: {},
    tasks: [],
    taskState: {
      T1: {
        taskId: "T1",
        status: "blocked",
        retries: 1,
        runAttempt: 1,
        blocker: {
          taskId: "T1",
          reason: "Acceptance command is prose, not executable",
          suggestion: "Provide a real validation command",
          blockedTasks: ["T1"],
        },
      },
    },
    blockers: [
      {
        taskId: "T1",
        reason: "Acceptance command is prose, not executable",
        suggestion: "Provide a real validation command",
        blockedTasks: ["T1"],
      },
    ],
    supervisors: {},
    timestamps: {
      started: "2026-04-18T11:00:00.000Z",
      lastUpdated: "2026-04-18T11:05:00.000Z",
    },
  } as unknown as RunSnapshot;
}

describe("blocker-remediation-model.migration", () => {
  it("existing persisted blocker entries remain loadable after migration", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
    const layout = createLayout(cwd, ".task-forge-test");
    await ensureLayout(layout);
    await writeFile(layout.snapshotFile, JSON.stringify(makeLegacySnapshot(), null, 2), "utf-8");

    const loaded = await loadSnapshot(layout);
    assert(loaded, "expected migrated snapshot to load");
    assert(loaded.schemaVersion === 4, "expected snapshot schema version to migrate to 4");
    assert(loaded.blockers[0].category === "validation_contract", "expected legacy blocker category to be inferred");
    assert(loaded.taskState.T1.blocker?.category === "validation_contract", "expected runtime blocker category to be inferred");
  });

  it("new writes use typed model fields without deprecated untyped fallback", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
    const layout = createLayout(cwd, ".task-forge-test");
    const snapshot: RunSnapshot = {
      schemaVersion: 4,
      orchestrationId: "orch-2",
      status: "needs_human_intervention",
      currentPhase: 5,
      phaseLabel: "Execution",
      resolvedModels: {},
      cost: {},
      tasks: [],
      taskState: {
        T2: {
          taskId: "T2",
          status: "blocked",
          retries: 0,
          runAttempt: 1,
          blocker: {
            taskId: "T2",
            category: "plan_contract",
            reason: "Generated tests contradict the task contract",
            suggestion: "Regenerate the affected task subtree",
            blockedTasks: ["T2"],
            remediation: {
              mode: "replan_task",
              category: "plan_contract",
              rationale: "Re-enter planning for the task with corrected validation contract",
              durabilityCommitRef: "events:77",
              durabilityCommittedAt: "2026-04-18T12:30:00.000Z",
            },
          },
        },
      },
      blockers: [
        {
          taskId: "T2",
          category: "plan_contract",
          reason: "Generated tests contradict the task contract",
          suggestion: "Regenerate the affected task subtree",
          blockedTasks: ["T2"],
          remediation: {
            mode: "replan_task",
            category: "plan_contract",
            rationale: "Re-enter planning for the task with corrected validation contract",
            durabilityCommitRef: "events:77",
            durabilityCommittedAt: "2026-04-18T12:30:00.000Z",
          },
        },
      ],
      supervisors: {},
      timestamps: {
        started: "2026-04-18T12:00:00.000Z",
        lastUpdated: "2026-04-18T12:30:00.000Z",
      },
    };

    await writeSnapshot(layout, snapshot);
    const persisted = JSON.parse(await readFile(layout.snapshotFile, "utf-8")) as Record<string, unknown>;
    const blockers = persisted.blockers as Array<Record<string, unknown>>;
    assert(blockers[0].category === "plan_contract", "expected typed blocker category in persisted snapshot");
    assert(!("blockerCategory" in blockers[0]), "expected no deprecated blockerCategory fallback field");
    assert(typeof blockers[0].remediation === "object", "expected remediation record to be persisted");

    const reloaded = await loadSnapshot(layout);
    assert(reloaded?.blockers[0].remediation?.mode === "replan_task", "expected typed remediation mode after reload");
    assert(reloaded?.blockers[0].remediation?.durabilityCommitRef === "events:77", "expected durability commit ref after reload");
  });
});
