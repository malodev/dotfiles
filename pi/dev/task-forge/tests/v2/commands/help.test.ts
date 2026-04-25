import { describe, it } from "node:test";
import assert from "node:assert";
import type { CommandResult } from "../../../src/commands/contracts.ts";

// This test verifies the committed v2/commands/help.ts interface.
// The module is planned per PRD and task T8 but does not yet exist.

describe("v2/commands/help", () => {
  it("exports a help function that returns a CommandResult", async () => {
    const mod = await import("../../../src/commands/help.ts");
    assert.strictEqual(typeof mod.help, "function", "help.ts should export a help function");

    const result: CommandResult<{ commands: string[] }> = mod.help();
    assert.strictEqual(result.ok, true, "help should succeed");
    assert.ok(Array.isArray(result.events), "help should return events array");
    assert.ok(Array.isArray(result.data?.commands), "help should list commands");
    assert.ok(
      result.data!.commands.includes("/forge status"),
      "help should mention /forge status"
    );
  });
});
