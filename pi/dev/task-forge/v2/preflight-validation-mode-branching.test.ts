import { describe, it } from "node:test";
import { preflightAcceptanceCommand } from "./preflight.ts";
import type { ForgeTask } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeTask(overrides: Partial<ForgeTask>): ForgeTask {
  return {
    id: "T4",
    title: "Validation mode preflight fixture",
    description: "Fixture task",
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: ["docs/example.md"],
    dependencies: [],
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: {
      mode: "command",
      command: "node --test",
    },
    ...overrides,
  };
}

describe("preflight-validation-mode-branching", () => {
  it("command-mode task missing command is blocked with actionable message", () => {
    const result = preflightAcceptanceCommand(
      makeTask({
        validation: {
          mode: "command",
        } as unknown as ForgeTask["validation"],
        testCommand: undefined,
        acceptanceSignal: undefined,
        coverageThreshold: undefined,
      })
    );

    assert(result.ok === false, "command mode without command should fail preflight");
    assert(result.kind === "environment_invalid_test_contract", "missing command should map to invalid test contract");
    assert(
      result.reason === "Command validation mode requires an executable validation.command, but none was provided.",
      "reason should explain that command mode requires validation.command"
    );
    assert(
      result.suggestion?.includes('validation: { mode: "command", command: "<your-test-command>" }'),
      "suggestion should include an actionable remediation example"
    );
  });

  it("manual-mode task is not blocked for missing command", () => {
    const result = preflightAcceptanceCommand(
      makeTask({
        validation: {
          mode: "manual",
          notes: "Inspect the generated documentation manually.",
        },
        testCommand: undefined,
        acceptanceSignal: undefined,
        coverageThreshold: undefined,
      })
    );

    assert(result.ok === true, "manual mode should pass preflight without a command");
    assert(result.normalizedCommand === undefined, "manual mode should not emit a normalized command");
  });

  it("preflight output explicitly states command checks skipped for manual mode", () => {
    const result = preflightAcceptanceCommand(
      makeTask({
        validation: {
          mode: "manual",
          notes: "Verify the config change manually.",
        },
        testCommand: undefined,
        acceptanceSignal: undefined,
      })
    );

    assert(result.ok === true, "manual mode should pass preflight");
    assert(
      result.message === "Preflight skipped executable command checks because validation.mode=manual.",
      "manual mode preflight output should explicitly state that command checks were skipped"
    );
  });
});
