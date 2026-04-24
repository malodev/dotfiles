import { describe, it } from "node:test";
import { applyBlockerResolutionPatch, deriveBlockerResolutionPatch } from "./blocker-resolution.ts";
import type { ForgeTask, TestSpecEntry } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeTask(): ForgeTask {
  return {
    id: "T5",
    title: "Validation task",
    description: "Task",
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: [],
    dependencies: [],
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: { mode: "command", command: "pnpm test || npm test" },
  };
}

describe("blocker-resolution", () => {
  it("deriveBlockerResolutionPatch extracts command-mode patch from explicit resolution command", () => {
    const patch = deriveBlockerResolutionPatch(
      "Use the correct repository validation command: `node --test --experimental-strip-types integration/blocker-resolution.test.ts`. Do not use pnpm/npm.",
    );

    assert(patch?.validation?.mode === "command", "expected command-mode patch");
    assert(
      patch?.validation?.mode === "command" && patch.validation.command === "node --test --experimental-strip-types integration/blocker-resolution.test.ts",
      "expected extracted command to match explicit resolution command",
    );
  });

  it("deriveBlockerResolutionPatch extracts manual-validation patch from manual-review wording", () => {
    const resolution = "This is a manual validation task; no executable acceptance command is required. Reviewer should inspect the updated docs and confirm they are coherent.";
    const patch = deriveBlockerResolutionPatch(resolution);

    assert(patch?.validation?.mode === "manual", "expected manual-mode patch");
    assert(patch?.validation?.mode === "manual" && patch.validation.notes === resolution, "expected manual notes to preserve resolution text");
  });

  it("applyBlockerResolutionPatch updates task and matching test spec contracts", () => {
    const task = makeTask();
    const specs: TestSpecEntry[] = [{
      taskId: "T5",
      validation: { mode: "command", command: "pnpm test || npm test" },
    }];

    const patch = deriveBlockerResolutionPatch(
      "Use this exact acceptance command: node --test --experimental-strip-types integration/planner-testdesigner-validation-mode.integration.test.ts",
    );
    if (!patch) throw new Error("expected patch");

    const result = applyBlockerResolutionPatch("T5", task, specs, patch);

    assert(result.task.validation.mode === "command", "task validation should be command mode");
    assert(result.task.validation.mode === "command" && result.task.validation.command.includes("--experimental-strip-types"), "task command should be replaced");
    assert(result.task.acceptanceSignal?.includes("node --test --experimental-strip-types"), "legacy acceptance signal should mirror command");
    assert(result.testSpecs[0].validation.mode === "command", "test spec validation should update too");
    assert(result.testSpecs[0].validation.mode === "command" && result.testSpecs[0].validation.command.includes("planner-testdesigner"), "test spec command should update");
  });

  it("applyBlockerResolutionPatch rejects patch fields outside allowlist", () => {
    const task = makeTask();
    const specs: TestSpecEntry[] = [{
      taskId: "T5",
      validation: { mode: "command", command: "pnpm test || npm test" },
    }];

    let rejected = false;
    try {
      applyBlockerResolutionPatch("T5", task, specs, {
        validation: { mode: "command", command: "node --test --experimental-strip-types" },
        title: "do not allow arbitrary mutation",
      });
    } catch (error: any) {
      rejected = String(error?.message ?? "").includes("outside allowlist");
    }

    assert(rejected, "expected out-of-allowlist patch field rejection");
  });
});
