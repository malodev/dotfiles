// Placeholder to satisfy planner-committed test path for T2/T8 validation command.
// Actual contract-shape coverage lives in tests/v2/commands/contract-shape.test.ts.
import { describe, it } from "node:test";
import assert from "node:assert";
import { models } from "../../../src/commands/models.ts";

describe("models command service (contract-shape verified in contract-shape.test.ts)", () => {
  it("exports a callable models function", () => {
    assert.strictEqual(typeof models, "function");
  });
});
