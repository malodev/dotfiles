import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { applyHostMode, loadConfig } from "../config.ts";
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

describe("notes", () => {
  it("are layered and validated", async () => {
    const a = await writeConfig({ roles: { builder: { provider: "l", model: "m" }, reviewer: { same_as: "builder" } }, notes: ["one"] });
    const b = await writeConfig({ notes: ["two"] });
    assert.deepEqual((await loadConfig([a, b])).notes, ["one", "two"]);
    assert.deepEqual((await loadConfig([a])).notes, ["one"]);
    const bad = await writeConfig({ roles: { builder: { provider: "l", model: "m" }, reviewer: { same_as: "builder" } }, notes: [1] });
    await assert.rejects(loadConfig([bad]), /notes/);
  });
});

describe("host modes", () => {
  const base = async () => loadConfig([await writeConfig({
    roles: { architect: { provider: "pi-llama", model: "pi/A" }, builder: { provider: "pi-llama", model: "pi/B" }, reviewer: { provider: "pi-llama", model: "pi/C" } },
    gpu: { managedProviders: ["pi-llama"] },
    modes: { ds4: { provider: "ds4", model: "deepseek-v4-flash" }, "qwen-flash": { provider: "qwen-flash", model: "malos/qwen3.8-flash-next", thinking: "low" } },
  })]);

  it("team keeps the roles block and leases in team mode", async () => {
    const config = applyHostMode(await base(), "team");
    assert.equal(config.roles.reviewer.model, "pi/C");
    assert.equal(config.gpu.mode, "team");
  });

  it("ds4 and qwen-flash use their one model for every role, manage that provider, and lease in that mode", async () => {
    const ds4 = applyHostMode(await base(), "ds4");
    assert.deepEqual([ds4.roles.architect, ds4.roles.builder, ds4.roles.reviewer].map((role) => `${role?.provider}/${role?.model}`), Array(3).fill("ds4/deepseek-v4-flash"));
    assert.equal(ds4.gpu.mode, "ds4");
    assert.deepEqual(ds4.gpu.managedProviders, ["pi-llama", "ds4"]);
    const qwen = applyHostMode(await base(), "qwen-flash");
    assert.equal(qwen.roles.builder.thinking, "low");
    assert.equal(qwen.gpu.mode, "qwen-flash");
  });

  it("refuses studio, stop, maintenance and unknown, and a mode with no configured model", async () => {
    for (const mode of ["studio", "stop", "maintenance", "unknown"]) {
      assert.throws(() => applyHostMode({ ...awaitedBase }, mode), new RegExp(`${mode} mode[\\s\\S]*team, ds4 or qwen-flash`));
    }
    assert.throws(() => applyHostMode({ ...awaitedBase, modes: {} }, "ds4"), /no "modes\.ds4" model/);
  });

  it("validates the modes section", async () => {
    await assert.rejects(loadConfig([await writeConfig({ roles: { builder: { provider: "l", model: "m" }, reviewer: { same_as: "builder" } }, modes: { ds4: { provider: "ds4" } } })]), /roles\.modes\.ds4/);
  });
});

let awaitedBase: Awaited<ReturnType<typeof loadConfig>>;
import { before } from "node:test";
before(async () => {
  awaitedBase = await loadConfig([await writeConfig({
    roles: { builder: { provider: "pi-llama", model: "pi/B" }, reviewer: { same_as: "builder" } },
    gpu: { managedProviders: ["pi-llama"] },
    modes: { ds4: { provider: "ds4", model: "deepseek-v4-flash" } },
  })]);
});
