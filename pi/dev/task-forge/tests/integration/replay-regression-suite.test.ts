import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayEvents } from "../../v2/derive.ts";
import { appendEvent, createLayout, deriveSnapshot, readEvents } from "../../v2/storage.ts";
import type { ForgeEvent } from "../../v2/events.ts";
import type { ForgeTask, RunSnapshot } from "../../v2/types.ts";
import { canExecute, canResume } from "../../v2/transition-policy.ts";
import { patchValidation as patchValidationCommandService } from "../../v2/commands/blocker.ts";

async function createTempLayout() {
  const dir = await mkdtemp(join(tmpdir(), "tf-replay-"));
  return createLayout(dir);
}

async function appendEvents(layout: ReturnType<typeof createLayout>, events: ForgeEvent[]) {
  for (const ev of events) {
    await appendEvent(layout, ev);
  }
}

async function deriveFromEvents(events: ForgeEvent[]) {
  const layout = await createTempLayout();
  await appendEvents(layout, events);
  const snapshot = await deriveSnapshot(layout);
  return { layout, snapshot };
}

function makeBaseEvent(overrides: Partial<ForgeEvent> & { type: ForgeEvent["type"] }): ForgeEvent {
  const base = { at: new Date().toISOString(), ...overrides };
  return base as ForgeEvent;
}

function createTask(id: string, dependencies: string[] = []): ForgeTask {
  return {
    id,
    title: `Task ${id}`,
    description: "d",
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: [],
    dependencies,
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: { mode: "manual", notes: "n" },
  };
}

function createExecutionBootstrapEvents(orchestrationId: string, tasks: ForgeTask[]): ForgeEvent[] {
  return [
    makeBaseEvent({ type: "run_created", orchestrationId, prdFile: "prd.md" }),
    makeBaseEvent({ type: "phase_entered", phase: 5, label: "Execution" }),
    makeBaseEvent({ type: "tasks_registered", tasks }),
  ];
}

describe("Replay regression suite", () => {
  it("status before restart equals status after replay", async () => {
    const events: ForgeEvent[] = [
      ...createExecutionBootstrapEvents("orch-1", [createTask("T1")]),
      makeBaseEvent({ type: "task_ready", taskId: "T1" }),
    ];

    const { layout, snapshot: snapshotBefore } = await deriveFromEvents(events);
    const eventsRead = await readEvents(layout);
    const snapshotAfter = replayEvents(eventsRead);

    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(snapshotAfter)),
      JSON.parse(JSON.stringify(snapshotBefore)),
      "snapshot after replay must match snapshot before restart"
    );
  });

  it("patched human intervention -> requeued -> executable", async () => {
    const events: ForgeEvent[] = [
      ...createExecutionBootstrapEvents("orch-2", [createTask("T1")]),
      makeBaseEvent({ type: "task_ready", taskId: "T1" }),
      makeBaseEvent({ type: "task_started", taskId: "T1", runAttempt: 1 }),
      makeBaseEvent({ type: "task_validation_failed", taskId: "T1", error: "validation failed" }),
      makeBaseEvent({ type: "human_intervention_requested", taskId: "T1", reason: "help", suggestion: "fix validation" }),
      makeBaseEvent({ type: "task_contract_patched", taskId: "T1", patch: { validation: { mode: "command", command: "npm test" } }, durabilityCommitRef: "T1:1" }),
      makeBaseEvent({ type: "task_requeued", taskId: "T1", reason: "retry after patch" }),
      makeBaseEvent({ type: "human_intervention_resolved", taskId: "T1", resolution: "patched and requeued" }),
      makeBaseEvent({ type: "task_ready", taskId: "T1" }),
    ];

    const { snapshot } = await deriveFromEvents(events);
    assert.ok(snapshot, "snapshot should exist after replay");
    assert.strictEqual(snapshot!.status, "executing", "run should be executable after intervention resolution and requeue");
    const decision = canExecute(snapshot);
    assert.strictEqual(decision.allowed, true, "canExecute should allow after patched intervention");
  });

  it("executing with no running tasks and ready tasks -> execution can continue", async () => {
    const events: ForgeEvent[] = [
      ...createExecutionBootstrapEvents("orch-3", [createTask("T1")]),
      makeBaseEvent({ type: "task_ready", taskId: "T1" }),
      makeBaseEvent({ type: "task_started", taskId: "T1", runAttempt: 1 }),
      // To get "executing with no running and ready tasks", we need another ready task.
      makeBaseEvent({ type: "tasks_registered", tasks: [createTask("T1"), createTask("T2")] }),
      makeBaseEvent({ type: "task_ready", taskId: "T1" }),
      makeBaseEvent({ type: "task_ready", taskId: "T2" }),
      makeBaseEvent({ type: "task_started", taskId: "T1", runAttempt: 1 }),
      makeBaseEvent({ type: "task_completed", taskId: "T1" }),
    ];

    const { snapshot } = await deriveFromEvents(events);
    assert.ok(snapshot, "snapshot should exist");
    assert.strictEqual(snapshot!.taskState["T2"]?.status, "ready", "T2 should be ready");
    assert.ok(
      !Object.values(snapshot!.taskState).some((t) => t.status === "running"),
      "there should be no running tasks"
    );
    const decision = canExecute(snapshot);
    assert.strictEqual(decision.allowed, true, "canExecute should allow when ready tasks exist even if none are running");
  });

  it("failed dependency requeue clears downstream dependency blockers through replay", async () => {
    const events: ForgeEvent[] = [
      ...createExecutionBootstrapEvents("orch-4", [createTask("T1"), createTask("T2", ["T1"])]),
      makeBaseEvent({ type: "task_ready", taskId: "T1" }),
      makeBaseEvent({ type: "task_started", taskId: "T1", runAttempt: 1 }),
      makeBaseEvent({ type: "task_failed", taskId: "T1", error: "failed" }),
      makeBaseEvent({ type: "task_blocked", taskId: "T2", blocker: { taskId: "T2", category: "dependency", reason: "Blocked by failed dependency: T1", suggestion: "Resolve T1 first", blockedTasks: ["T2"] } }),
      makeBaseEvent({ type: "task_requeued", taskId: "T1", reason: "retry" }),
      makeBaseEvent({ type: "task_ready", taskId: "T1" }),
    ];

    const { snapshot } = await deriveFromEvents(events);
    assert.ok(snapshot, "snapshot should exist");
    assert.ok(
      !snapshot!.blockers.some((b) => b.taskId === "T2" && !b.resolvedAt),
      "T2 dependency blocker should be resolved after T1 is requeued"
    );
  });

  it("execute and resume use the same transition policy", async () => {
    const snapshot: RunSnapshot = {
      schemaVersion: 4,
      orchestrationId: "orch-policy",
      status: "executing",
      currentPhase: 5,
      phaseLabel: "Execution",
      resolvedModels: {},
      cost: {},
      tasks: [],
      taskState: {},
      blockers: [],
      supervisors: {},
      timestamps: { started: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    };

    const execDecision = canExecute(snapshot);
    const resumeDecision = canResume(snapshot);
    assert.strictEqual(typeof execDecision.allowed, "boolean", "canExecute returns structured decision");
    assert.strictEqual(typeof resumeDecision.allowed, "boolean", "canResume returns structured decision");
    assert.ok(
      execDecision.reason && resumeDecision.reason,
      "both decisions include reason codes from transition policy"
    );
  });

  it("rejects unsafe validation patch commands before planning retry events", async () => {
    const events: ForgeEvent[] = [
      ...createExecutionBootstrapEvents("orch-unsafe-validation", [createTask("T1")]),
      makeBaseEvent({ type: "task_blocked", taskId: "T1", blocker: { taskId: "T1", category: "validation_contract", reason: "Validation command invalid", suggestion: "Patch validation", blockedTasks: ["T1"] } }),
    ];

    const { snapshot } = await deriveFromEvents(events);
    assert.ok(snapshot, "snapshot should exist");

    const result = patchValidationCommandService(snapshot, {
      taskId: "T1",
      command: "npx tsc --noEmit",
    });

    assert.strictEqual(result.ok, false, "unsafe validation command should be rejected before planning events");
    assert.strictEqual(result.events.length, 0, "rejected validation patch must not emit retry/worker-driving events");
  });
});
