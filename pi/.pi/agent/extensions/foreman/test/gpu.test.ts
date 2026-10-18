import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Gpu, providerOf, readHostMode, shellLeaseClient, type CommandRunner, type LeaseClient } from "../gpu.ts";

function fakeClient() {
  const calls: string[] = [];
  let renewFails = false;
  const client: LeaseClient = {
    async acquire() { calls.push("acquire"); },
    async renew() { calls.push("renew"); if (renewFails) throw new Error("manager busy"); },
    async release() { calls.push("release"); },
  };
  return { client, calls, failRenewals: (value: boolean) => { renewFails = value; } };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function gpu(client: LeaseClient, overrides: Partial<ConstructorParameters<typeof Gpu>[0]> = {}) {
  const lost: Error[] = [];
  const instance = new Gpu({
    client,
    isManaged: (provider) => provider === "local",
    ttlMs: 10_000, renewIntervalMs: 10_000, expiryMarginMs: 100,
    onLeaseLost: (error) => lost.push(error),
    ...overrides,
  });
  return { instance, lost };
}

describe("providerOf", () => {
  it("takes the part before the first slash", () => {
    assert.equal(providerOf("local/unsloth/Qwen:Q5"), "local");
    assert.equal(providerOf("bare"), "bare");
  });
});

describe("Gpu.withModel", () => {
  it("acquires once, however many managed calls follow, and releases on close", async () => {
    const { client, calls } = fakeClient();
    const { instance } = gpu(client);
    await instance.withModel("local/a", async () => {});
    await instance.withModel("local/a", async () => {});
    await instance.close();
    assert.deepEqual(calls, ["acquire", "release"]);
  });

  it("counts a swap only when the resident model changes", async () => {
    const { client } = fakeClient();
    const { instance } = gpu(client);
    await instance.withModel("local/a", async () => {});
    await instance.withModel("local/a", async () => {});
    assert.equal(instance.swaps, 0);
    await instance.withModel("local/b", async () => {});
    assert.equal(instance.swaps, 1);
    assert.equal(instance.loadedModel, "local/b");
    await instance.withModel("local/a", async () => {});
    assert.equal(instance.swaps, 2);
    await instance.close();
  });

  it("unmanaged providers never lease and never evict the resident model", async () => {
    const { client, calls } = fakeClient();
    const { instance } = gpu(client);
    const result = await instance.withModel("anthropic/claude", async () => 42);
    assert.equal(result, 42);
    assert.deepEqual(calls, []);
    await instance.withModel("local/a", async () => {});
    await instance.withModel("anthropic/claude", async () => {});
    await instance.withModel("local/a", async () => {});
    assert.equal(instance.swaps, 0);
    await instance.close();
  });

  it("close without a lease does not call release", async () => {
    const { client, calls } = fakeClient();
    await gpu(client).instance.close();
    assert.deepEqual(calls, []);
  });

  it("propagates the work's result and errors and keeps the lease", async () => {
    const { client, calls } = fakeClient();
    const { instance } = gpu(client);
    await assert.rejects(instance.withModel("local/a", async () => { throw new Error("boom"); }), /boom/);
    await instance.withModel("local/a", async () => {});
    assert.deepEqual(calls, ["acquire"]);
    await instance.close();
  });
});

describe("Gpu heartbeat", () => {
  it("renews on the interval", async () => {
    const { client, calls } = fakeClient();
    const { instance } = gpu(client, { renewIntervalMs: 20, ttlMs: 60_000 });
    await instance.withModel("local/a", async () => {});
    await sleep(90);
    await instance.close();
    assert.ok(calls.filter((call) => call === "renew").length >= 2);
  });

  it("survives failed renewals until the lease would really have lapsed", async () => {
    const { client, failRenewals } = fakeClient();
    const { instance, lost } = gpu(client, { renewIntervalMs: 20, ttlMs: 400, expiryMarginMs: 50 });
    await instance.withModel("local/a", async () => {});
    failRenewals(true);
    await sleep(150);
    assert.equal(lost.length, 0, "a stalled manager is tolerated while the lease is still valid");
    await sleep(400);
    assert.equal(lost.length, 1);
    assert.match(lost[0].message, /lapsed/);
    await assert.rejects(instance.withModel("local/a", async () => {}), /lost/);
    await instance.close();
  });

  it("recovers when renewals succeed again before the lapse", async () => {
    const { client, failRenewals } = fakeClient();
    const { instance, lost } = gpu(client, { renewIntervalMs: 20, ttlMs: 400, expiryMarginMs: 50 });
    await instance.withModel("local/a", async () => {});
    failRenewals(true);
    await sleep(120);
    failRenewals(false);
    await sleep(500);
    assert.equal(lost.length, 0);
    await instance.close();
  });
});

describe("shellLeaseClient", () => {
  it("drives the pi-inference CLI with a stable owner and configured mode/TTL", async () => {
    const seen: { args: string[]; env: NodeJS.ProcessEnv; timeoutMs: number }[] = [];
    const run: CommandRunner = async (_command, args, env, timeoutMs) => { seen.push({ args, env, timeoutMs }); };
    const client = shellLeaseClient({ command: "pi-inference", mode: "team", ttlSeconds: 300, acquireTimeoutSeconds: 210 }, run);
    await client.acquire();
    await client.renew();
    await client.release();
    assert.deepEqual(seen.map((call) => call.args), [["acquire", "--mode", "team"], ["renew"], ["release"]]);
    assert.equal(seen[0].timeoutMs, 210_000);
    assert.equal(seen[0].env.PI_INFERENCE_TTL, "300");
    assert.match(String(seen[0].env.PI_INFERENCE_OWNER), /:foreman:/);
    assert.equal(seen[0].env.PI_INFERENCE_OWNER, seen[2].env.PI_INFERENCE_OWNER);
  });
});

describe("lease owner", () => {
  const ownerOf = async (config: Parameters<typeof shellLeaseClient>[0]) => {
    let owner = "";
    const client = shellLeaseClient(config, async (_command, _args, env) => { owner = String(env.PI_INFERENCE_OWNER); });
    await client.acquire();
    return owner;
  };
  const base = { command: "pi-inference", mode: "team", ttlSeconds: 300, acquireTimeoutSeconds: 210 };

  it("names the host, pid, phase and project, so a holder can be found from any machine", async () => {
    const owner = await ownerOf({ ...base, label: "plan", project: "foreman-test" });
    assert.match(owner, new RegExp(`^[A-Za-z0-9._-]+:${process.pid}:foreman:plan:foreman-test:[0-9a-f]{8}$`));
  });

  it("is stable for one client, different between clients, and defaults to a run", async () => {
    const calls: string[] = [];
    const client = shellLeaseClient({ ...base, project: "p" }, async (_c, _a, env) => { calls.push(String(env.PI_INFERENCE_OWNER)); });
    await client.acquire();
    await client.renew();
    assert.equal(calls[0], calls[1]);
    assert.match(calls[0], /:foreman:run:p:/);
    assert.notEqual(await ownerOf({ ...base, project: "p" }), calls[0]);
  });

  it("only uses characters the manager accepts, and stays under its length limit", async () => {
    const owner = await ownerOf({ ...base, label: "plan", project: "My Project (copy) é/ü #1 ".repeat(20) });
    assert.match(owner, /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,239}$/);
    assert.ok(owner.length <= 240);
    assert.match(owner, /:foreman:plan:/);
  });
});

describe("readHostMode", () => {
  it("returns the mode the manager reports", async () => {
    const seen: string[][] = [];
    const mode = await readHostMode("pi-inference", async (_command, args) => { seen.push(args); return JSON.stringify({ mode: "ds4", lease: null }); });
    assert.equal(mode, "ds4");
    assert.deepEqual(seen, [["--json", "status"]]);
  });

  it("fails closed on an unreachable manager, invalid JSON, or a missing mode", async () => {
    await assert.rejects(readHostMode("x", async () => { throw new Error("connection refused"); }), /Could not read the host mode: connection refused/);
    await assert.rejects(readHostMode("x", async () => "not json"), /invalid JSON/);
    await assert.rejects(readHostMode("x", async () => "{}"), /reported none/);
  });
});
