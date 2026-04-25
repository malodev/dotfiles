import { describe, it } from "node:test";
import assert from "node:assert";
import type { CommandResult } from "../../../src/commands/contracts.ts";
import { status } from "../../../src/commands/status.ts";
import { execute } from "../../../src/commands/execute.ts";
import { resume } from "../../../src/commands/resume.ts";
import { pause } from "../../../src/commands/pause.ts";
import { abort } from "../../../src/commands/abort.ts";
import { cost } from "../../../src/commands/cost.ts";
import { models } from "../../../src/commands/models.ts";
import { config } from "../../../src/commands/config.ts";
import { listBlockers, resolveBlocker, retryTask, patchValidation } from "../../../src/commands/blocker.ts";

function assertCommandResult(result: CommandResult<unknown>) {
  assert.strictEqual(typeof result.ok, "boolean", "CommandResult.ok must be a boolean");
  assert.ok(Array.isArray(result.events), "CommandResult.events must be an array");
  if (result.snapshot !== undefined) {
    assert.strictEqual(typeof result.snapshot, "object", "CommandResult.snapshot must be an object when present");
  }
  if (result.message !== undefined) {
    assert.strictEqual(typeof result.message, "string", "CommandResult.message must be a string when present");
  }
}

describe("command service contract shape", () => {
  it("status returns valid CommandResult", () => {
    assertCommandResult(status(null));
    assertCommandResult(status({
      schemaVersion: 4, orchestrationId: "o", status: "planning", currentPhase: 0, phaseLabel: "p",
      resolvedModels: {}, cost: {}, tasks: [], taskState: {}, blockers: [], supervisors: {},
      timestamps: { started: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    }));
  });

  it("execute returns valid CommandResult", () => {
    assertCommandResult(execute(null));
    assertCommandResult(execute({
      schemaVersion: 4, orchestrationId: "o", status: "executing", currentPhase: 5, phaseLabel: "p",
      resolvedModels: {}, cost: {}, tasks: [], taskState: {}, blockers: [], supervisors: {},
      timestamps: { started: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    }));
  });

  it("resume returns valid CommandResult", () => {
    assertCommandResult(resume(null));
    assertCommandResult(resume({
      schemaVersion: 4, orchestrationId: "o", status: "paused", currentPhase: 5, phaseLabel: "p",
      resolvedModels: {}, cost: {}, tasks: [], taskState: {}, blockers: [], supervisors: {},
      timestamps: { started: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    }));
  });

  it("pause returns valid CommandResult", () => {
    assertCommandResult(pause(null));
    assertCommandResult(pause({
      schemaVersion: 4, orchestrationId: "o", status: "executing", currentPhase: 5, phaseLabel: "p",
      resolvedModels: {}, cost: {}, tasks: [], taskState: {}, blockers: [], supervisors: {},
      timestamps: { started: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    }));
  });

  it("abort returns valid CommandResult", () => {
    assertCommandResult(abort(null, { reason: "test" }));
    assertCommandResult(abort({
      schemaVersion: 4, orchestrationId: "o", status: "executing", currentPhase: 5, phaseLabel: "p",
      resolvedModels: {}, cost: {}, tasks: [], taskState: {}, blockers: [], supervisors: {},
      timestamps: { started: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    }, { reason: "test" }));
  });

  it("cost returns valid CommandResult", () => {
    assertCommandResult(cost(null));
    assertCommandResult(cost({
      schemaVersion: 4, orchestrationId: "o", status: "planning", currentPhase: 0, phaseLabel: "p",
      resolvedModels: {}, cost: {}, tasks: [], taskState: {}, blockers: [], supervisors: {},
      timestamps: { started: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    }));
  });

  it("models returns valid CommandResult", () => {
    assertCommandResult(models(null));
    assertCommandResult(models({
      schemaVersion: 4, orchestrationId: "o", status: "planning", currentPhase: 0, phaseLabel: "p",
      resolvedModels: {}, cost: {}, tasks: [], taskState: {}, blockers: [], supervisors: {},
      timestamps: { started: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    }));
  });

  it("config returns valid CommandResult", () => {
    assertCommandResult(config(null));
    assertCommandResult(config({
      modelTiers: {}, roleAssignment: {}, modelOverrides: {}, maxWorkers: 1, maxRetries: 1,
      defaultTurnBudget: 1, maxTurnBudget: 1, outputDir: ".", autoExecute: false, contextBudgetPercent: 50, costLimitUsd: 1,
    }));
  });

  it("blocker commands return valid CommandResult", () => {
    const snapshot = {
      schemaVersion: 4, orchestrationId: "o", status: "planning", currentPhase: 0, phaseLabel: "p",
      resolvedModels: {}, cost: {}, tasks: [], taskState: {}, blockers: [], supervisors: {},
      timestamps: { started: new Date().toISOString(), lastUpdated: new Date().toISOString() },
    };
    assertCommandResult(listBlockers(null));
    assertCommandResult(listBlockers(snapshot as any));
    assertCommandResult(resolveBlocker(null, { taskId: "T1", resolution: "fix" }));
    assertCommandResult(resolveBlocker(snapshot as any, { taskId: "T1", resolution: "fix" }));
    assertCommandResult(retryTask(null, { taskId: "T1" }));
    assertCommandResult(retryTask(snapshot as any, { taskId: "T1" }));
    assertCommandResult(patchValidation(null, { taskId: "T1", command: "npm test" }));
    assertCommandResult(patchValidation(snapshot as any, { taskId: "T1", command: "npm test" }));
  });
});
