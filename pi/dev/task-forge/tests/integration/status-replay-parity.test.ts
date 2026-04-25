import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent, createLayout, deriveSnapshot, readEvents } from "../../src/storage.ts";
import { replayEvents } from "../../src/derive.ts";
import { status } from "../../src/commands/status.ts";
import type { ForgeEvent } from "../../src/events.ts";

async function createTempLayout() {
  const dir = await mkdtemp(join(tmpdir(), "tf-status-"));
  return createLayout(dir);
}

describe("status replay parity", () => {
  it("status output is identical before restart and after replay", async () => {
    const layout = await createTempLayout();
    const events: ForgeEvent[] = [
      { type: "run_created", at: new Date().toISOString(), orchestrationId: "orch-1", prdFile: "prd.md" },
      { type: "phase_entered", at: new Date().toISOString(), phase: 5, label: "Execution" },
      { type: "tasks_registered", at: new Date().toISOString(), tasks: [
        { id: "T1", title: "Task 1", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: [], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } },
      ]},
      { type: "task_ready", at: new Date().toISOString(), taskId: "T1" },
    ];

    for (const ev of events) {
      await appendEvent(layout, ev);
    }

    const snapshotBefore = await deriveSnapshot(layout);
    const statusBefore = status(snapshotBefore);

    // Simulate restart: re-read events and replay
    const eventsRead = await readEvents(layout);
    const snapshotAfter = replayEvents(eventsRead);
    const statusAfter = status(snapshotAfter);

    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(statusAfter.data)),
      JSON.parse(JSON.stringify(statusBefore.data)),
      "status data must be identical after replay"
    );
  });
});
