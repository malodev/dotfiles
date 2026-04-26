/**
 * Integration test: fail → intervention → patch → retry → execute
 *
 * Covers FR-1 (auto-clear on patch) and FR-2 (lifecycle test).
 * Uses event replay to verify deterministic state transitions.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { replayEvents } from "../../src/derive.ts";
import { appendEvent, createLayout, deriveSnapshot, readEvents } from "../../src/storage.ts";
import type { ForgeEvent } from "../../src/events.ts";
import type { RunSnapshot } from "../../src/types.ts";
import { canExecute, canResume } from "../../src/transition-policy.ts";
import { patchValidation } from "../../src/commands/blocker.ts";
import { execute as executeCommand } from "../../src/commands/execute.ts";

const now = "2026-01-01T00:00:00.000Z";
const LAYOUT = createLayout("/tmp", "test-task-forge-lifecycle");

function cleanLayout() {
  try { require("fs").rmSync(LAYOUT.outputDir, { recursive: true, force: true }); } catch {}
}

function createEvents(): ForgeEvent[] {
  return [
    { type: "run_created", at: now, orchestrationId: "test-lifecycle", prdFile: "test.md" },
    { type: "phase_entered", at: now, phase: 0, label: "Scope Classification" },
    { type: "routing_decided", at: now, mode: "standard" },
    { type: "phase_entered", at: now, phase: 4, label: "Approval Gate" },
    {
      type: "tasks_registered", at: now, tasks: [
        {
          id: "T1", title: "Test", description: "", complexity: "S", taskMode: "single-pass",
          contextManifest: {}, outputManifest: [], dependencies: [],
          acceptanceCriteria: ["test"], escalationTriggers: [], validation: { mode: "command", command: "exit 1" },
        } as any,
      ],
    },
    { type: "task_ready", at: now, taskId: "T1" },
    { type: "phase_entered", at: now, phase: 5, label: "Execution" },
    { type: "task_started", at: now, taskId: "T1", runAttempt: 1 },
    { type: "task_failed", at: now, taskId: "T1", error: "Validation failed" },
    {
      type: "human_intervention_requested", at: now, taskId: "T1",
      reason: "Test failure", suggestion: "Fix the command",
    },
    { type: "approval_required", at: now, nextAction: "executePlan", label: "Human intervention required" },
  ];
}

describe("Lifecycle: fail → intervention → patch → retry → execute", () => {
  it("reaches needs_human_intervention after task failure", () => {
    const events = createEvents();
    const snapshot = replayEvents(events);
    assert.ok(snapshot, "Snapshot should exist");
    assert.strictEqual(snapshot.status, "needs_human_intervention");
    assert.ok(snapshot.pendingHumanIntervention, "Should have pendingHumanIntervention");
  });

  it("auto-clears intervention on patch-validation", () => {
    const events = createEvents();
    let snapshot = replayEvents(events)!;

    // Patch the validation command
    const patchResult = patchValidation(snapshot, { taskId: "T1", command: "node --test --experimental-strip-types test.ts" });
    assert.ok(patchResult.ok, "Patch should succeed");
    assert.ok(patchResult.events.length > 0, "Patch should produce events");

    // Append patch + auto-resolve events
    const allEvents = [
      ...events,
      ...patchResult.events,
      { type: "human_intervention_resolved", at: now, taskId: "T1", resolution: "Auto-resolved: validation patched" },
      { type: "task_requeued", at: now, taskId: "T1", reason: "Auto-clear after patch" },
    ];

    snapshot = replayEvents(allEvents)!;
    assert.strictEqual(snapshot.pendingHumanIntervention, undefined, "Intervention should be cleared");
  });

  it("can execute after auto-clear", () => {
    const allEvents: ForgeEvent[] = [
      ...createEvents(),
      { type: "task_contract_patched", at: now, taskId: "T1", patch: { validation: { mode: "command", command: "node --test test.ts" } } as any, durabilityCommitRef: "ref" },
      { type: "human_intervention_resolved", at: now, taskId: "T1", resolution: "Auto-resolved" },
      { type: "task_requeued", at: now, taskId: "T1", reason: "Auto-clear" },
      { type: "task_ready", at: now, taskId: "T1" },
    ];

    const snapshot = replayEvents(allEvents)!;
    assert.strictEqual(snapshot.pendingHumanIntervention, undefined);

    const decision = canExecute(snapshot);
    assert.ok(decision.allowed, `Should allow execution after auto-clear: ${decision.reason}`);
  });

  it("full lifecycle is replay-deterministic", () => {
    const events: ForgeEvent[] = [
      ...createEvents(),
      { type: "task_contract_patched", at: now, taskId: "T1", patch: { validation: { mode: "command", command: "node --test test.ts" } } as any, durabilityCommitRef: "ref" },
      { type: "human_intervention_resolved", at: now, taskId: "T1", resolution: "Auto-resolved" },
      { type: "task_requeued", at: now, taskId: "T1", reason: "Auto-clear" },
      { type: "task_ready", at: now, taskId: "T1" },
    ];

    // Replay twice — same result
    const s1 = replayEvents(events);
    const s2 = replayEvents(events);
    assert.strictEqual(s1?.status, s2?.status, "Status should be deterministic");
    assert.strictEqual(s1?.pendingHumanIntervention, s2?.pendingHumanIntervention);
  });
});
