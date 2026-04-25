// @ts-nocheck
import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent, createLayout, deriveSnapshot } from "../../src/storage.ts";
import { canExecute, canResume } from "../../src/transition-policy.ts";
import { execute } from "../../src/commands/execute.ts";
import { resume } from "../../src/commands/resume.ts";
import type { ForgeEvent } from "../../src/events.ts";

async function createTempLayout() {
  const dir = await mkdtemp(join(tmpdir(), "tf-exec-res-"));
  return createLayout(dir);
}

describe("execute/resume regression scenarios", () => {
  it("patched human intervention + no blockers -> executable", async () => {
    const layout = await createTempLayout();
    const events: ForgeEvent[] = [
      { type: "run_created", at: "2026-04-24T00:00:00.000Z", orchestrationId: "orch-1", prdFile: "prd.md" },
      { type: "phase_entered", at: "2026-04-24T00:00:01.000Z", phase: 5, label: "Execution" },
      { type: "tasks_registered", at: "2026-04-24T00:00:02.000Z", tasks: [
        { id: "T1", title: "Task 1", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: [], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } },
      ]},
      { type: "task_ready", at: "2026-04-24T00:00:03.000Z", taskId: "T1" },
      { type: "task_started", at: "2026-04-24T00:00:04.000Z", taskId: "T1", runAttempt: 1 },
      { type: "task_validation_failed", at: "2026-04-24T00:00:05.000Z", taskId: "T1", error: "validation failed" },
      { type: "human_intervention_requested", at: "2026-04-24T00:00:06.000Z", taskId: "T1", reason: "help", suggestion: "patch validation" },
      { type: "task_contract_patched", at: "2026-04-24T00:00:07.000Z", taskId: "T1", patch: { validation: { mode: "command", command: "npm test" } }, durabilityCommitRef: "T1:1" },
      { type: "task_requeued", at: "2026-04-24T00:00:08.000Z", taskId: "T1", reason: "retry after patch" },
      { type: "human_intervention_resolved", at: "2026-04-24T00:00:09.000Z", taskId: "T1", resolution: "patched and requeued" },
      { type: "task_ready", at: "2026-04-24T00:00:10.000Z", taskId: "T1" },
    ];

    for (const ev of events) {
      await appendEvent(layout, ev);
    }

    const snapshot = await deriveSnapshot(layout);
    assert.ok(snapshot, "snapshot should be derivable after patch->retry flow");
    assert.strictEqual(snapshot!.status, "executing", "status should become executing after intervention is resolved and task is ready");

    const execDecision = canExecute(snapshot);
    assert.strictEqual(execDecision.allowed, true, "execute should be allowed after patched intervention");

    const execResult = execute(snapshot);
    assert.strictEqual(execResult.ok, true, "execute command should succeed");
  });

  it("executing with no running tasks and ready tasks -> execution can continue/recover", async () => {
    const layout = await createTempLayout();
    const events: ForgeEvent[] = [
      { type: "run_created", at: "2026-04-24T00:00:00.000Z", orchestrationId: "orch-2", prdFile: "prd.md" },
      { type: "phase_entered", at: "2026-04-24T00:00:01.000Z", phase: 5, label: "Execution" },
      { type: "tasks_registered", at: "2026-04-24T00:00:02.000Z", tasks: [
        { id: "T1", title: "Task 1", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: [], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } },
        { id: "T2", title: "Task 2", description: "d", complexity: "S", taskMode: "single-pass", contextManifest: {}, outputManifest: [], dependencies: [], acceptanceCriteria: [], escalationTriggers: [], validation: { mode: "manual", notes: "n" } },
      ]},
      { type: "task_ready", at: "2026-04-24T00:00:03.000Z", taskId: "T1" },
      { type: "task_ready", at: "2026-04-24T00:00:03.000Z", taskId: "T2" },
      { type: "task_started", at: "2026-04-24T00:00:04.000Z", taskId: "T1", runAttempt: 1 },
      { type: "task_completed", at: "2026-04-24T00:00:05.000Z", taskId: "T1" },
      // T1 completed, T2 ready, no running tasks
    ];

    for (const ev of events) {
      await appendEvent(layout, ev);
    }

    const snapshot = await deriveSnapshot(layout);
    assert.ok(snapshot, "snapshot should exist");
    assert.ok(
      !Object.values(snapshot!.taskState).some((t) => t.status === "running"),
      "no tasks should be running"
    );
    assert.strictEqual(snapshot!.taskState["T2"]?.status, "ready", "T2 should be ready");

    const execDecision = canExecute(snapshot);
    assert.strictEqual(execDecision.allowed, true, "execute should be allowed when ready tasks exist");

    const resumeDecision = canResume(snapshot);
    assert.strictEqual(resumeDecision.allowed, false, "resume should not be allowed when no tasks are running");
  });
});
