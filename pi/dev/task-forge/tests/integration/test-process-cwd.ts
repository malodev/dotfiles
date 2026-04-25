import { describe, it } from "node:test";
import * as assert from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const INDEX_PATH = resolve(process.cwd(), "index.ts");

describe("test", () => {
  it("works", async () => {
    const source = await readFile(INDEX_PATH, "utf-8");
    assert.ok(source.length > 0);
  });
});
