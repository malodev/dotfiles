const { describe, it } = require("node:test");
const assert = require("node:assert");
const { resolve } = require("node:path");

describe("test", () => {
  it("works", () => {
    assert.ok(resolve(__dirname, "../../index.ts").includes("index.ts"));
  });
});
