import { describe, it } from "node:test";
import {
  assertValidValidationContract,
  materializeLegacyValidationFields,
  normalizeGeneratedValidationContract,
  normalizeValidationContract,
} from "./validation.ts";

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
  assert(error.message.includes(expectedMessage), `Expected error message to include ${JSON.stringify(expectedMessage)}, got ${JSON.stringify((error as Error).message)}`);
}

describe("validation.contract", () => {
  it("accepts command mode with non-empty validation.command", () => {
    const result = normalizeValidationContract({
      validation: {
        mode: "command",
        command: "npm test",
        coverageThreshold: 80,
      },
    });

    assert(result.validation.mode === "command", "mode should be command");
    assert(result.validation.command === "npm test", "command should be normalized");
    assert(result.validation.coverageThreshold === 80, "coverage threshold should be preserved");
    assert(result.warnings.length === 0, "typed validation should not emit warnings");
    const legacy = materializeLegacyValidationFields(result.validation);
    assert(legacy.acceptanceSignal === "npm test", "command mode should mirror acceptanceSignal for compatibility");
  });

  it("accepts manual mode without command", () => {
    const result = normalizeValidationContract({
      validation: {
        mode: "manual",
        notes: "Review generated docs output manually.",
      },
    });

    assert(result.validation.mode === "manual", "mode should be manual");
    assert(result.validation.command === undefined, "manual mode should not include a command");
    assert(result.validation.notes === "Review generated docs output manually.", "notes should be preserved");
    assert(result.warnings.length === 0, "typed manual validation should not emit warnings");
  });

  it("rejects command mode missing command", () => {
    assertThrows(
      () => assertValidValidationContract({ mode: "command" }),
      "mode=command requires a non-empty validation.command",
    );
  });

  it("rejects manual mode without notes, or with command/coverage threshold", () => {
    assertThrows(
      () => assertValidValidationContract({ mode: "manual" }),
      "mode=manual requires non-empty validation.notes",
    );
    assertThrows(
      () => assertValidValidationContract({ mode: "manual", command: "npm test", notes: "Inspect manually." }),
      "mode=manual cannot include validation.command",
    );
    assertThrows(
      () => assertValidValidationContract({ mode: "manual", coverageThreshold: 50, notes: "Inspect manually." }),
      "mode=manual cannot include validation.coverageThreshold",
    );
  });

  it("derives command mode from legacy testCommand", () => {
    const result = normalizeValidationContract({
      testCommand: " npm test ",
      coverageThreshold: 90,
    });

    assert(result.validation.mode === "command", "legacy testCommand should derive command mode");
    assert(result.validation.command === "npm test", "legacy command should be normalized");
    assert(result.usedLegacyFields.includes("testCommand"), "legacy usage should be reported");
    assert(result.warnings[0]?.includes("Normalized legacy validation fields"), "legacy normalization should emit a warning");
  });

  it("derives manual mode from legacy prose acceptanceSignal", () => {
    const result = normalizeValidationContract({
      acceptanceSignal: "Manual acceptance: verify README examples were updated.",
    });

    assert(result.validation.mode === "manual", "prose acceptanceSignal should derive manual mode");
    assert(result.validation.notes === "Manual acceptance: verify README examples were updated.", "manual notes should carry prose guidance");
    assert(result.warnings[0]?.includes("Normalized legacy validation fields"), "legacy prose normalization should emit a warning");
  });

  it("rejects incompatible legacy manual prose with coverage threshold", () => {
    assertThrows(
      () => normalizeValidationContract({
        acceptanceSignal: "Manual acceptance: inspect generated files.",
        coverageThreshold: 75,
      }),
      "mode=manual cannot include validation.coverageThreshold",
    );
  });

  it("typed validation ignores legacy fields as authority and emits warning", () => {
    const result = normalizeValidationContract({
      validation: {
        mode: "manual",
        notes: "Use manual review.",
      },
      testCommand: "node --test",
      acceptanceSignal: "npm test",
      coverageThreshold: 80,
    });

    assert(result.validation.mode === "manual", "typed validation should remain authoritative");
    assert(result.usedLegacyFields.length === 0, "legacy fields should not be treated as authoritative");
    assert(result.warnings[0]?.includes("ignoring legacy fields"), "ignored legacy fields should emit a warning");
  });

  it("legacy adapter can be disabled for strict parsing", () => {
    assertThrows(
      () => normalizeValidationContract({
        testCommand: "node --test",
        legacyAdapterEnabled: false,
      }),
      "legacy compatibility adapter is disabled and validation is required",
    );
  });

  it("generated planner/test-designer outputs reject deprecated legacy validation fields", () => {
    assertThrows(
      () => normalizeGeneratedValidationContract({
        source: "planner",
        validation: {
          mode: "command",
          command: "node --test",
        },
        acceptanceSignal: "node --test",
      }),
      "generated artifacts must not use legacy fields (acceptance_signal)",
    );

    assertThrows(
      () => normalizeGeneratedValidationContract({
        source: "test-designer",
        validation: {
          mode: "manual",
          notes: "Reviewer should inspect the generated docs output.",
        },
        coverageThreshold: 80,
      }),
      "generated artifacts must not use legacy fields (coverage_threshold)",
    );
  });
});
