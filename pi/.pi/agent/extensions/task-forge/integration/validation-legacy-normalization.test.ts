import { describe, it } from "node:test";
import { normalizeValidationContract } from "../v2/validation.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrows(fn: () => void, expectedMessage: string) {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof Error, `Expected function to throw: ${expectedMessage}`);
  assert(
    error.message.includes(expectedMessage),
    `Expected error message to include ${JSON.stringify(expectedMessage)}, got ${JSON.stringify((error as Error).message)}`,
  );
}

describe("validation-legacy-normalization", () => {
  it("legacy command-only fields normalize into typed command validation when adapter is enabled", () => {
    const result = normalizeValidationContract({
      testCommand: " bash -lc 'pnpm test || npm test' ",
    });

    assert(result.validation.mode === "command", "legacy command should normalize to command mode");
    assert(result.validation.command === "bash -lc 'pnpm test || npm test'", "legacy command should be trimmed");
    assert(result.usedLegacyFields.includes("testCommand"), "legacy field usage should be reported");
    assert(result.warnings[0]?.includes("Normalized legacy validation fields"), "normalization should emit a warning");
  });

  it("legacy prose-only fields normalize into typed manual validation when adapter is enabled", () => {
    const result = normalizeValidationContract({
      acceptanceSignal: "Manually inspect the generated task artifact and confirm the checklist is correct.",
    });

    assert(result.validation.mode === "manual", "legacy prose should normalize to manual mode");
    assert(
      result.validation.notes === "Manually inspect the generated task artifact and confirm the checklist is correct.",
      "legacy prose should populate manual notes",
    );
    assert(result.usedLegacyFields.includes("acceptanceSignal"), "legacy prose field usage should be reported");
    assert(result.warnings[0]?.includes("Normalized legacy validation fields"), "normalization should emit a warning");
  });

  it("typed validation remains authoritative when typed and legacy fields conflict", () => {
    const result = normalizeValidationContract({
      validation: {
        mode: "command",
        command: "node --test agent/extensions/task-forge/v2/validation.contract.test.ts",
      },
      testCommand: "npm test",
      acceptanceSignal: "Review output manually.",
    });

    assert(result.validation.mode === "command", "typed validation should remain authoritative");
    assert(
      result.validation.command === "node --test agent/extensions/task-forge/v2/validation.contract.test.ts",
      "typed command should win over conflicting legacy fields",
    );
    assert(result.usedLegacyFields.length === 0, "legacy fields should not be authoritative when typed validation exists");
    assert(result.warnings[0]?.includes("ignoring legacy fields"), "ignored legacy fields should emit a warning");
  });

  it("legacy normalization can be disabled by policy", () => {
    assertThrows(
      () => normalizeValidationContract({
        acceptanceSignal: "Manually inspect the artifact.",
        legacyAdapterEnabled: false,
      }),
      "legacy compatibility adapter is disabled and validation is required",
    );
  });
});
