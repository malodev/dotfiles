import { describe, it } from "node:test";
import assert from "node:assert";
import { pause } from "../../../v2/commands/pause.ts";
import { abort } from "../../../v2/commands/abort.ts";
import { cost } from "../../../v2/commands/cost.ts";
import { models } from "../../../v2/commands/models.ts";
import { config } from "../../../v2/commands/config.ts";
import type { RunSnapshot } from "../../../v2/types.ts";

function makeSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    schemaVersion: 4,
    orchestrationId: "orch-test",
    status: "executing",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: { worker: "gpt-4" },
    cost: { estimatedUsd: 1.0 },
    tasks: [],
    taskState: {},
    blockers: [],
    supervisors: {},
    timestamps: { started: "2026-04-24T00:00:00.000Z", lastUpdated: "2026-04-24T00:00:00.000Z" },
    ...overrides,
  } as RunSnapshot;
}

describe("remaining V2 command services", () => {
  it("pause emits run_paused when allowed", () => {
    const result = pause(makeSnapshot());
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.events[0].type, "run_paused");
  });

  it("pause denies when not active", () => {
    const result = pause(makeSnapshot({ status: "completed" }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.data?.decision.allowed, false);
  });

  it("abort emits run_aborted when allowed", () => {
    const result = abort(makeSnapshot(), { reason: "user request" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.events[0].type, "run_aborted");
    assert.strictEqual((result.events[0] as any).reason, "user request");
  });

  it("abort denies when already aborted", () => {
    const result = abort(makeSnapshot({ status: "aborted" }), { reason: "test" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.data?.decision.allowed, false);
  });

  it("cost returns snapshot cost", () => {
    const result = cost(makeSnapshot());
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data?.cost.estimatedUsd, 1.0);
  });

  it("models returns resolved models", () => {
    const result = models(makeSnapshot());
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data?.resolvedModels.worker, "gpt-4");
  });

  it("config returns config data", () => {
    const cfg = {
      modelTiers: {}, roleAssignment: {}, modelOverrides: {}, maxWorkers: 1, maxRetries: 1,
      defaultTurnBudget: 1, maxTurnBudget: 1, outputDir: ".", autoExecute: false, contextBudgetPercent: 50, costLimitUsd: 1,
    };
    const result = config(cfg);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data?.config.maxWorkers, 1);
  });
});
