import { describe, it } from "node:test";
import assert from "node:assert";
import { normalizeValidationCommand } from "../../v2/validation.ts";

describe("normalizeValidationCommand — tsc stripping", () => {
  it("strips tsc without -p flag (bare tsc)", () => {
    const input = "tsc --noEmit && node --test tests/v2/transition-policy.test.ts";
    assert.strictEqual(normalizeValidationCommand(input), "node --test tests/v2/transition-policy.test.ts");
  });

  it("strips npx tsc without -p flag (with file args)", () => {
    const input = "npx tsc --noEmit tests/v2/commands/contract-shape.test.ts tests/v2/commands/models.test.ts && node --test --experimental-strip-types tests/v2/commands/contract-shape.test.ts tests/v2/commands/models.test.ts";
    assert.strictEqual(
      normalizeValidationCommand(input),
      "node --test --experimental-strip-types tests/v2/commands/contract-shape.test.ts tests/v2/commands/models.test.ts",
    );
  });

  it("preserves tsc with -p flag (user knows what they're doing)", () => {
    const input = "npx tsc -p tsconfig.json --noEmit && node --test tests/v2/transition-policy.test.ts";
    assert.strictEqual(normalizeValidationCommand(input), input);
  });

  it("preserves tsc with --project flag", () => {
    const input = "tsc --project tsconfig.json --noEmit && node --test tests/v2/transition-policy.test.ts";
    assert.strictEqual(normalizeValidationCommand(input), input);
  });

  it("preserves plain node --test (no tsc)", () => {
    const input = "node --test tests/v2/transition-policy.test.ts";
    assert.strictEqual(normalizeValidationCommand(input), input);
  });

  it("preserves non-TS commands", () => {
    const input = "pytest tests/";
    assert.strictEqual(normalizeValidationCommand(input), "pytest tests/");
  });

  it("strips trailing 'exits 0' / 'returns 0' prose", () => {
    const input = "node --test tests/v2/transition-policy.test.ts exits 0";
    assert.strictEqual(normalizeValidationCommand(input), "node --test tests/v2/transition-policy.test.ts");
  });
});
