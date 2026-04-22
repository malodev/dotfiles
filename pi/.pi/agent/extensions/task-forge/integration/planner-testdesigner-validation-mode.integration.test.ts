import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeGeneratedValidationContract } from "../v2/validation.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readPrompt(relativePath: string) {
  const absolutePath = resolve(__dirname, relativePath);
  return await readFile(absolutePath, "utf-8");
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

function assertTestDesignerPromptContract(prompt: string, variant: string) {
  assert(prompt.includes('"validation"'), `${variant} prompt should include validation object examples`);
  assert(prompt.includes('"mode": "command"'), `${variant} prompt should describe command mode`);
  assert(prompt.includes('"mode": "manual"'), `${variant} prompt should describe manual mode`);
  assert(prompt.includes("validation.notes"), `${variant} prompt should direct manual guidance into validation.notes`);
  assert(prompt.includes("must include `validation.mode` explicitly"), `${variant} prompt should require explicit validation.mode`);
  assert(prompt.includes("documentation, configuration, and reviewer-only tasks"), `${variant} prompt should guide docs/config/manual-review tasks toward manual mode`);
  assert(prompt.includes("real executable test or verification command"), `${variant} prompt should require runnable command validation for implementation tasks`);
  assert(prompt.includes("Do not emit deprecated legacy validation fields"), `${variant} prompt should forbid legacy validation fields in new output`);
}

describe("planner-testdesigner-validation-mode.integration", () => {
  it("planner prompt requires typed validation.mode and notes-based manual guidance", async () => {
    const prompt = await readPrompt("../agents/planner.md");

    assert(prompt.includes("validation"), "planner prompt should mention validation");
    assert(prompt.includes('"mode": "command"'), "planner prompt should describe command mode");
    assert(prompt.includes('"mode": "manual"'), "planner prompt should describe manual mode");
    assert(prompt.includes("validation.notes"), "planner prompt should direct manual guidance into validation.notes");
    assert(prompt.includes("Do not omit `validation.mode`"), "planner prompt should require explicit validation.mode");
    assert(prompt.includes("documentation, configuration, content, or reviewer-only tasks"), "planner prompt should guide docs/config/manual-review tasks toward manual mode");
    assert(prompt.includes("Code implementation task"), "planner prompt should include a command-mode implementation example");
    assert(prompt.includes("Do not emit deprecated legacy validation fields"), "planner prompt should forbid legacy validation fields in new output");
  });

  it("test-designer prompt requires typed validation.mode and notes-based manual guidance", async () => {
    const prompt = await readPrompt("../agents/test-designer.md");
    assertTestDesignerPromptContract(prompt, "test-designer");
  });

  it("test-designer Claude prompt variant requires the same typed validation contract", async () => {
    const prompt = await readPrompt("../agents/test-designer-claude.md");
    assertTestDesignerPromptContract(prompt, "test-designer Claude");
  });

  it("planner generated command-mode fixture is accepted via typed validation contract", () => {
    const result = normalizeGeneratedValidationContract({
      source: "planner",
      validation: {
        mode: "command",
        command: "node --test agent/extensions/task-forge/v2/validation.contract.test.ts",
        coverageThreshold: 0,
      },
    });

    assert(result.validation.mode === "command", "planner command fixture should parse as command mode");
    assert(result.validation.command === "node --test agent/extensions/task-forge/v2/validation.contract.test.ts", "planner command fixture should preserve command");
  });

  it("planner generated manual-mode fixture is accepted only when guidance lives in validation.notes", () => {
    const result = normalizeGeneratedValidationContract({
      source: "planner",
      validation: {
        mode: "manual",
        notes: "Reviewer should inspect the updated contract docs and persisted task artifact.",
      },
    });

    assert(result.validation.mode === "manual", "planner manual fixture should parse as manual mode");
    assert(result.validation.notes?.includes("Reviewer should inspect"), "manual guidance should be preserved in validation.notes");
  });

  it("test-designer generated command-mode fixture is accepted via typed validation contract", () => {
    const result = normalizeGeneratedValidationContract({
      source: "test-designer",
      validation: {
        mode: "command",
        command: "node --test agent/extensions/task-forge/integration/planner-testdesigner-validation-mode.integration.test.ts",
        coverageThreshold: 0,
      },
    });

    assert(result.validation.mode === "command", "test-designer command fixture should parse as command mode");
    assert(result.validation.command?.includes("planner-testdesigner-validation-mode.integration.test.ts"), "test-designer command fixture should preserve command");
  });

  it("test-designer generated manual-mode fixture is accepted only when guidance lives in validation.notes", () => {
    const result = normalizeGeneratedValidationContract({
      source: "test-designer",
      validation: {
        mode: "manual",
        notes: "Reviewer should inspect the generated test contract JSON and confirm parser coverage.",
      },
    });

    assert(result.validation.mode === "manual", "test-designer manual fixture should parse as manual mode");
    assert(result.validation.notes?.includes("generated test contract JSON"), "manual guidance should be preserved in validation.notes");
  });

  it("parser rejects malformed or ambiguous generated validation shapes", () => {
    assertThrows(
      () => normalizeGeneratedValidationContract({
        source: "planner",
        testCommand: "node --test",
      }),
      "generated artifacts must include validation.mode explicitly",
    );

    assertThrows(
      () => normalizeGeneratedValidationContract({
        source: "planner",
        validation: {
          mode: "manual",
          notes: "Inspect the docs output manually.",
        },
        acceptanceSignal: "Manual acceptance: inspect the docs output manually.",
      }),
      "generated artifacts must not use legacy fields (acceptance_signal)",
    );

    assertThrows(
      () => normalizeGeneratedValidationContract({
        source: "test-designer",
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
          mode: "command",
          command: "node --test",
          coverageThreshold: 80,
        },
        coverageThreshold: 60,
      }),
      "generated artifacts must not use legacy fields (coverage_threshold)",
    );
  });
});
