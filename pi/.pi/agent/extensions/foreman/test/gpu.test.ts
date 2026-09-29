import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Gpu, providerOf, shellLeaseClient, type CommandRunner, type LeaseClient } from "../gpu.ts";

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
