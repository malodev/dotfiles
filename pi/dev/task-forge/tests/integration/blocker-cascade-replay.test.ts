import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent, createLayout, deriveSnapshot, readEvents } from "../../src/storage.ts";
import { replayEvents } from "../../src/derive.ts";
import type { ForgeEvent } from "../../src/events.ts";

async function createTempLayout() {
  const dir = await mkdtemp(join(tmpdir(), "tf-blocker-"));
  return createLayout(dir);
}

describe("blocker cascade replayability", () => {
  it("dependency unblock cascade is event-backed and replayable", async () => {
    const layout = await createTempLayout();
    const events: ForgeEvent[] = [
      { type: "run_created", at: "2026-04-24T00:00:00.000Z", orchestrationId: "orch-1", prdFile: "prd.md" },
      { type: "phase_entered", at: "2026-04-24T00:00:01.000Z", phase: 5, label: "Execution" },
      { type: "tasks_registered", at: "2026-04-24T00:00:02.000Z", tasks: [
        { id: "T1", title: "Task 1", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: [], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } },
        { id: "T2", title: "Task 2", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: ["T1"], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } },
        { id: "T3", title: "Task 3", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: ["T2"], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } },
      ]},
      { type: "task_ready", at: "2026-04-24T00:00:03.000Z", taskId: "T1" },
      { type: "task_started", at: "2026-04-24T00:00:04.000Z", taskId: "T1", runAttempt: 1 },
      { type: "task_failed", at: "2026-04-24T00:00:05.000Z", taskId: "T1", error: "failed" },
      { type: "task_blocked", at: "2026-04-24T00:00:06.000Z", taskId: "T2", blocker: { taskId: "T2", category: "dependency", reason: "Blocked by failed dependency: T1", suggestion: "Resolve T1 first", blockedTasks: ["T2"] } },
      { type: "task_blocked", at: "2026-04-24T00:00:07.000Z", taskId: "T3", blocker: { taskId: "T3", category: "dependency", reason: "Blocked by failed dependency: T2", suggestion: "Resolve T2 first", blockedTasks: ["T3"] } },
      // Resolve T1 via requeue
      { type: "task_requeued", at: "2026-04-24T00:00:08.000Z", taskId: "T1", reason: "retry" },
      { type: "task_ready", at: "2026-04-24T00:00:09.000Z", taskId: "T1" },
    ];

    for (const ev of events) {
      await appendEvent(layout, ev);
    }

    const snapshot = await deriveSnapshot(layout);
    assert.ok(snapshot, "snapshot should exist");

    // After T1 is requeued and ready, T2 and T3 dependency blockers should be resolved
    const t2Blocker = snapshot!.blockers.find((b) => b.taskId === "T2");
    const t3Blocker = snapshot!.blockers.find((b) => b.taskId === "T3");

    assert.ok(t2Blocker, "T2 blocker should exist in snapshot");
    assert.ok(t3Blocker, "T3 blocker should exist in snapshot");

    // Note: derive.ts may not auto-resolve dependency blockers on requeue yet.
    // This test captures the expected replayable cascade behavior.
    assert.ok(
      t2Blocker!.resolvedAt || snapshot!.taskState["T2"]?.status !== "blocked",
      "T2 blocker should be resolved or T2 should be unblocked after T1 requeue"
    );
    assert.ok(
      t3Blocker!.resolvedAt || snapshot!.taskState["T3"]?.status !== "blocked",
      "T3 blocker should be resolved or T3 should be unblocked after upstream requeue"
    );

    // Replay determinism
    const eventsRead = await readEvents(layout);
    const replayed = replayEvents(eventsRead);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(replayed?.blockers)),
      JSON.parse(JSON.stringify(snapshot!.blockers)),
      "blocker state must be deterministic after replay"
    );
  });
});
