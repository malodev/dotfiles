import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadConfig } from "../config.ts";
import { builderTask, parseVerdict, reviewerTask, tail } from "../prompts.ts";

const task = { id: "t1", goal: "Do it", dependsOn: [], files: ["a.ts"], successTests: ["npm test"] };

describe("prompts", () => {
  it("builderTask carries goal, tests, owner note and previous failure", () => {
    const text = builderTask(task, 2, 4, { ownerNote: "use helper", previous: "exit 1" });
    for (const part of ["t1", "attempt 2/4", "Do it", "npm test", "use helper", "exit 1", "a.ts"]) assert.ok(text.includes(part), part);
    assert.ok(!builderTask(task, 1, 4, {}).includes("What went wrong"));
  });

  it("reviewerTask demands an exact verdict heading", () => {
    assert.match(reviewerTask(task, 1), /## Verdict/);
  });

  it("parseVerdict reads only an exact verdict section", () => {
    assert.deepEqual(parseVerdict("intro\n## Verdict\nAPPROVE\n"), { verdict: "approve", notes: "" });
    assert.deepEqual(parseVerdict("## Verdict\n**REQUEST_CHANGES**\n- fix x\n- fix y"), { verdict: "changes", notes: "- fix x\n- fix y" });
    assert.equal(parseVerdict("I approve of this."), undefined);
    assert.equal(parseVerdict("## Verdict\nmaybe"), undefined);
  });

  it("tail keeps the end of long output", () => {
    assert.equal(tail("short"), "short");
    assert.match(tail("x".repeat(10) + "END", 5), /truncated.*\nxxEND$/s);
  });
});

async function writeConfig(json: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foreman-config-"));
  const path = join(dir, "foreman.json");
  await writeFile(path, JSON.stringify(json));
  return path;
}

describe("loadConfig", () => {
  const roles = { builder: { provider: "local", model: "m1" }, reviewer: { same_as: "builder" } };

  it("applies defaults and resolves reviewer same_as", async () => {
    const config = await loadConfig([await writeConfig({ roles })]);
    assert.deepEqual(config.roles.reviewer, { provider: "local", model: "m1" });
    assert.equal(config.limits.buildAttempts, 4);
    assert.equal(config.gpu.mode, "team");
    assert.equal(config.roles.architect, undefined);
  });

  it("layers later files over earlier ones and skips missing files", async () => {
    const global = await writeConfig({ roles, limits: { buildAttempts: 6 } });
    const project = await writeConfig({ roles: { reviewer: { provider: "local", model: "m2" } }, limits: { reviewAttempts: 3 } });
    const config = await loadConfig([global, "/nonexistent/foreman.json", project]);
    assert.equal(config.limits.buildAttempts, 6);
    assert.equal(config.limits.reviewAttempts, 3);
    assert.equal(config.roles.reviewer.model, "m2");
  });

  it("rejects bad values with a clear message", async () => {
    await assert.rejects(loadConfig([await writeConfig({ roles: { reviewer: { same_as: "builder" } } })]), /roles\.builder/);
    await assert.rejects(loadConfig([await writeConfig({ roles, limits: { buildAttempts: 0 } })]), /limits\.buildAttempts/);
    await assert.rejects(loadConfig([await writeConfig({ roles, gpu: { leaseTtlSeconds: 100, renewIntervalSeconds: 90, expiryMarginSeconds: 20 } })]), /less than/);
    await assert.rejects(loadConfig([await writeConfig({ roles: { ...roles, reviewer: { same_as: "architect" } } })]), /same_as/);
  });
});
