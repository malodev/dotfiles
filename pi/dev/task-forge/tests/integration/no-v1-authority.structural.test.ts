import { describe, it } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const INDEX_PATH = resolve(import.meta.dirname, "../../index.ts");

describe("No V1 runtime authority in active paths", () => {
  let source: string;

  it("can read index.ts source", async () => {
    source = await readFile(INDEX_PATH, "utf-8");
    assert.ok(source.length > 0);
  });

  it("does not import v1-status-helpers for runtime decisions", () => {
    assert.ok(
      !source.includes('from "./v1-status-helpers"') && !source.includes("from './v1-status-helpers'"),
      "index.ts should not import v1-status-helpers"
    );
  });

  it("does not call createV1StateFromV2 in command handlers", () => {
    // After T10, this helper should be deleted or quarantined to migration-only
    assert.ok(
      !source.includes("createV1StateFromV2"),
      "index.ts should not reference createV1StateFromV2"
    );
  });

  it("does not call applyAuthoritativeSnapshotToV1 in command handlers", () => {
    assert.ok(
      !source.includes("applyAuthoritativeSnapshotToV1"),
      "index.ts should not reference applyAuthoritativeSnapshotToV1"
    );
  });

  it("does not call taskListFromAuthoritative in command handlers", () => {
    assert.ok(
      !source.includes("taskListFromAuthoritative"),
      "index.ts should not reference taskListFromAuthoritative"
    );
  });

  it("does not use V1 statusLabel for runtime status rendering", () => {
    assert.ok(
      !source.includes("statusLabel("),
      "index.ts should not call V1 statusLabel"
    );
  });

  it("does not treat session restore as authoritative", () => {
    // Session entries can be advisory, but must not override V2 snapshot authority
    const commandHandlerRegion = source.slice(source.indexOf('pi.registerCommand("forge"'));
    assert.ok(
      !commandHandlerRegion.includes("sessionManager.getEntries()"),
      "command handlers should not use sessionManager.getEntries() as authority"
    );
  });
});
