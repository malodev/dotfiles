// @ts-nocheck
import { describe, it } from "node:test";
import assert from "node:assert";
import { resume } from "../../../v2/commands/resume.ts";
import type { RunSnapshot } from "../../../v2/types.ts";

function makeSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    schemaVersion: 4,
    orchestrationId: "orch-test",
    status: "planning",
    currentPhase: 0,
    phaseLabel: "Test",
    resolvedModels: {},
    cost: {},
    tasks: [],
    taskState: {},
    blockers: [],
    supervisors: {},
    timestamps: { started: "2026-04-24T00:00:00.000Z", lastUpdated: "2026-04-24T00:00:00.000Z" },
    ...overrides,
  } as RunSnapshot;
}

describe("resume command service", () => {
  it("returns error for null snapshot", () => {
    const result = resume(null);
    assert.strictEqual(result.ok, false);
    assert.ok(result.message?.includes("No run snapshot"));
  });

  it("allows resume when paused", () => {
    const snapshot = makeSnapshot({ status: "paused" });
    const result = resume(snapshot);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.events[0].type, "run_resumed");
    assert.strictEqual(result.data?.decision.reason, "run_is_paused");
  });

  it("allows resume when executing with running tasks", () => {
    const snapshot = makeSnapshot({
      status: "executing",
      currentPhase: 5,
      taskState: {
        T1: { taskId: "T1", status: "running", retries: 0, runAttempt: 1, startedAt: "2026-04-24T00:00:00.000Z", lastHeartbeatAt: "2026-04-24T00:00:00.000Z" },
      },
    });
    const result = resume(snapshot);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data?.decision.reason, "has_interrupted_tasks");
  });

  it("denies resume when executing with ready tasks but no running tasks", () => {
    const snapshot = makeSnapshot({
      status: "executing",
      currentPhase: 5,
      taskState: {
        T1: { taskId: "T1", status: "completed", retries: 0, runAttempt: 1 },
        T2: { taskId: "T2", status: "ready", retries: 0, runAttempt: 1 },
      },
    });
    const result = resume(snapshot);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.data?.decision.reason, "no_interrupted_execution");
  });

  it("denies resume when completed", () => {
    const snapshot = makeSnapshot({ status: "completed" });
    const result = resume(snapshot);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.data?.decision.reason, "run_is_completed");
  });

  it("denies resume when failed", () => {
    const snapshot = makeSnapshot({ status: "failed" });
    const result = resume(snapshot);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.data?.decision.reason, "run_is_failed");
  });
});
