import { describe, it } from "node:test";
import assert from "node:assert";

// These tests verify the validation hardening requirements from T11.

describe("validation command policy hardening", () => {
  it("rejects bare npx tsc --noEmit", async () => {
    const mod = await import("../../v2/validation.ts");
    const guard = (mod as Record<string, unknown>).assertSafeValidationCommand as ((cmd: string) => void) | undefined;

    if (!guard) {
      assert.fail("assertSafeValidationCommand is not exported from v2/validation.ts");
    }

    assert.throws(() => guard("npx tsc --noEmit"), /unsafe|rejected|bare tsc/i);
    assert.throws(() => guard("  npx tsc --noEmit  "), /unsafe|rejected|bare tsc/i);
    assert.throws(() => guard("tsc --noEmit"), /unsafe|rejected|bare tsc/i);
    assert.throws(() => guard("tsc --noEmit src/index.ts"), /unsafe|rejected|bare tsc/i);
  });

  it("rejects Deno test commands", async () => {
    const mod = await import("../../v2/validation.ts");
    const guard = (mod as Record<string, unknown>).assertSafeValidationCommand as ((cmd: string) => void) | undefined;

    if (!guard) {
      assert.fail("assertSafeValidationCommand is not exported from v2/validation.ts");
    }

    assert.throws(() => guard("deno test"), /deno|unsupported/i);
    assert.throws(() => guard("deno check main.ts"), /deno|unsupported/i);
    assert.throws(() => guard("deno run --allow-all test.ts"), /deno|unsupported/i);
  });

  it("allows safe Node validation commands", async () => {
    const mod = await import("../../v2/validation.ts");
    const guard = (mod as Record<string, unknown>).assertSafeValidationCommand as ((cmd: string) => void) | undefined;

    if (!guard) {
      assert.fail("assertSafeValidationCommand is not exported from v2/validation.ts");
    }

    // These should not throw
    assert.doesNotThrow(() => guard("npm test"));
    assert.doesNotThrow(() => guard("pnpm test"));
    assert.doesNotThrow(() => guard("node --test"));
    assert.doesNotThrow(() => guard("npx vitest run"));
    assert.doesNotThrow(() => guard("npx tsc -p tsconfig.json --noEmit"));
    assert.doesNotThrow(() => guard("npx tsc --project tsconfig.json --noEmit"));
  });

  it("rejects shell operators", async () => {
    const mod = await import("../../v2/validation.ts");
    const guard = (mod as Record<string, unknown>).assertSafeValidationCommand as ((cmd: string) => void) | undefined;

    if (!guard) {
      assert.fail("assertSafeValidationCommand is not exported from v2/validation.ts");
    }

    assert.throws(() => guard("npm test && echo done"), /shell operators/i);
    assert.throws(() => guard("npm test || echo failed"), /shell operators/i);
    assert.throws(() => guard("npm test; echo done"), /shell operators/i);
    assert.throws(() => guard("npm test | cat"), /shell operators/i);
    assert.throws(() => guard("`npm test`"), /shell operators/i);
    assert.throws(() => guard("$(npm test)"), /shell operators/i);
  });

  it("rejects bare paths", async () => {
    const mod = await import("../../v2/validation.ts");
    const guard = (mod as Record<string, unknown>).assertSafeValidationCommand as ((cmd: string) => void) | undefined;

    if (!guard) {
      assert.fail("assertSafeValidationCommand is not exported from v2/validation.ts");
    }

    assert.throws(() => guard("./run-tests.sh"), /relative or absolute paths/i);
    assert.throws(() => guard("../scripts/test"), /relative or absolute paths/i);
    assert.throws(() => guard("/usr/local/bin/test"), /relative or absolute paths/i);
  });

  it("summarizes noisy evidence while preserving full logs", async () => {
    const mod = await import("../../v2/validation.ts");
    const summarize = (mod as Record<string, unknown>).summarizeValidationEvidence as ((output: string, maxLines?: number) => string) | undefined;

    if (!summarize) {
      assert.fail("summarizeValidationEvidence is not exported from v2/validation.ts");
    }

    const noisy = [
      "tsc: the TypeScript compiler",
      "Usage: tsc [options] [file...]",
      "",
      "Options:",
      "  -h, --help         Show help",
      "  --project          Project config",
      "",
      "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
      "  at src/index.ts:42:15",
      "",
      "error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
      "  at src/index.ts:55:10",
      "",
      "error TS2322: Type 'boolean' is not assignable to type 'string'.",
      "  at src/index.ts:78:3",
      "",
      "Found 3 errors.",
    ].join("\n");

    const summary = summarize(noisy, 4);
    assert.ok(!summary.includes("Usage:"), "should strip usage header");
    assert.ok(!summary.includes("Options:"), "should strip options section");
    assert.ok(!summary.includes("-h, --help"), "should strip flag lines");
    assert.ok(summary.includes("error TS2345"), "should keep actual errors");
    assert.ok(summary.includes("lines omitted"), "should indicate truncation when needed");
  });

  it("preflight rejects unsafe validation commands before execution", async () => {
    const { preflightAcceptanceCommand } = await import("../../v2/preflight.ts");

    const result = preflightAcceptanceCommand({
      id: "T-01",
      title: "Test",
      description: "Desc",
      outputManifest: [],
      validation: { mode: "command", command: "deno test" },
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.kind, "environment_invalid_test_contract");
    assert.ok(result.reason?.includes("Deno"), "should mention Deno in reason");
  });
});
