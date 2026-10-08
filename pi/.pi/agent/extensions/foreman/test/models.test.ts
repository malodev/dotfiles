import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applyRoles, checkRoles, chooseRoles, filterModels, describeModel, modelsCommand, parseModelsArgs, parseRoleSpec,
  thinkingLevelsFor, type ModelInfo, type ModelsHost,
} from "../models.ts";

const model = (provider: string, id: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({ provider, id, name: id, reasoning: true, contextWindow: 262144, ...extra });
const CATALOG: ModelInfo[] = [
  model("openai-codex", "gpt-sol", { name: "GPT Sol" }),
  model("anthropic", "claude-fable-5"),
  model("openrouter", "qwen/qwen3-coder", { reasoning: false }),
  model("pi-llama", "pi/Qwen3.8-27B-UD-Q5_K_XL", { name: "Qwen3.8 27B" }),
  model("qwen-flash", "malos/qwen3.8-flash-next", { name: "Qwen flash" }),
  model("ds4", "deepseek-v4-flash", { thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high" } }),
];

describe("thinkingLevelsFor", () => {
  it("follows pi's rules: no reasoning means off only; off can be hidden; xhigh and max are opt-in", () => {
    assert.deepEqual(thinkingLevelsFor(model("a", "b", { reasoning: false })), ["off"]);
    assert.deepEqual(thinkingLevelsFor(model("a", "b")), ["off", "minimal", "low", "medium", "high"]);
    assert.deepEqual(thinkingLevelsFor(CATALOG[5]), ["minimal", "low", "medium", "high"], "ds4 hides off");
    assert.deepEqual(thinkingLevelsFor(model("a", "b", { thinkingLevelMap: { xhigh: "xhigh", max: "max" } })), ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  });
});

describe("filterModels", () => {
  it("matches every word, in provider, id or name, ignoring case", () => {
    assert.deepEqual(filterModels(CATALOG, "sol").map((m) => m.id), ["gpt-sol"]);
    assert.deepEqual(filterModels(CATALOG, "QWEN flash").map((m) => m.id), ["malos/qwen3.8-flash-next"]);
    assert.deepEqual(filterModels(CATALOG, "openrouter qwen").map((m) => m.provider), ["openrouter"]);
    assert.equal(filterModels(CATALOG, "").length, CATALOG.length);
    assert.equal(filterModels(CATALOG, "nothing-like-this").length, 0);
  });

  it("describes a model with context size and thinking", () => {
    assert.match(describeModel(CATALOG[0]), /openai-codex\/gpt-sol.*256K.*thinks/);
    assert.doesNotMatch(describeModel(CATALOG[2]), /thinks/);
  });
});

describe("parseRoleSpec / parseModelsArgs", () => {
  it("splits provider from model at the first slash and takes a thinking suffix only when it is a level", () => {
    assert.deepEqual(parseRoleSpec("openai-codex/gpt-sol:high"), { provider: "openai-codex", model: "gpt-sol", thinking: "high" });
    assert.deepEqual(parseRoleSpec("pi-llama/pi/Qwen3.8-27B-UD-Q5_K_XL"), { provider: "pi-llama", model: "pi/Qwen3.8-27B-UD-Q5_K_XL" });
    assert.deepEqual(parseRoleSpec("unsloth/unsloth/Qwen3.8-27B-GGUF:UD-Q5_K_XL"), { provider: "unsloth", model: "unsloth/Qwen3.8-27B-GGUF:UD-Q5_K_XL" }, "a quant suffix is not a thinking level");
    assert.equal(parseRoleSpec("same"), "same");
    assert.throws(() => parseRoleSpec("nonsense"), /provider\/model/);
  });

  it("parses role assignments and flags", () => {
    assert.deepEqual(parseModelsArgs("architect=openai-codex/gpt-sol builder=qwen-flash/malos/qwen3.8-flash-next:low reviewer=same --project"), {
      project: true,
      specs: { architect: { provider: "openai-codex", model: "gpt-sol" }, builder: { provider: "qwen-flash", model: "malos/qwen3.8-flash-next", thinking: "low" }, reviewer: "same" },
    });
    assert.deepEqual(parseModelsArgs(""), { project: false, specs: {} });
    assert.throws(() => parseModelsArgs("operator=a/b"), /unknown role "operator"/);
    assert.throws(() => parseModelsArgs("builder=same"), /only the reviewer/);
    assert.throws(() => parseModelsArgs("builder"), /role=provider\/model/);
  });
});

describe("applyRoles", () => {
  const roles = { architect: { provider: "openai-codex", model: "gpt-sol" }, builder: { provider: "pi-llama", model: "pi/Q", thinking: "high" }, reviewer: "same" as const };

  it("creates a config from nothing, with local providers managed and the selection marked mixed", () => {
    const out = applyRoles({}, roles);
    assert.deepEqual(out.roles, { architect: { provider: "openai-codex", model: "gpt-sol" }, builder: { provider: "pi-llama", model: "pi/Q", thinking: "high" }, reviewer: { same_as: "builder" } });
    assert.equal(out.selection, "mixed");
    assert.deepEqual(out.gpu.managedProviders, ["pi-llama"]);
  });

  it("keeps every other key and does not duplicate managed providers", () => {
    const out = applyRoles({ notes: ["keep"], limits: { buildAttempts: 6 }, modes: { ds4: { provider: "ds4", model: "x" } }, gpu: { managedProviders: ["pi-llama", "ds4"], command: "pi-inference" }, roles: { architect: { provider: "old", model: "old" } } }, roles);
    assert.deepEqual(out.notes, ["keep"]);
    assert.equal(out.limits.buildAttempts, 6);
    assert.deepEqual(out.modes, { ds4: { provider: "ds4", model: "x" } });
    assert.deepEqual(out.gpu.managedProviders, ["pi-llama", "ds4"]);
    assert.equal(out.gpu.command, "pi-inference");
    assert.equal(out.roles.architect.provider, "openai-codex");
  });

  it("a cloud-only selection adds no managed providers", () => {
    const out = applyRoles({}, { architect: { provider: "anthropic", model: "claude-fable-5" }, builder: { provider: "anthropic", model: "claude-fable-5" }, reviewer: "same" });
    assert.deepEqual(out.gpu?.managedProviders ?? [], []);
  });
});

describe("checkRoles", () => {
  const spec = (provider: string, id: string) => ({ provider, model: id });

  it("lists roles whose model is not available on this host", () => {
    const errors = checkRoles({ architect: spec("openai-codex", "gpt-sol"), builder: spec("openai-codex", "gpt-missing"), reviewer: "same" }, CATALOG);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Builder model openai-codex\/gpt-missing is not available on this machine/);
  });

  it("refuses local roles that need two different GPU modes", () => {
    const errors = checkRoles({ architect: spec("anthropic", "claude-fable-5"), builder: spec("ds4", "deepseek-v4-flash"), reviewer: spec("pi-llama", "pi/Qwen3.8-27B-UD-Q5_K_XL") }, CATALOG);
    assert.ok(errors.some((e) => /more than one host mode.*ds4.*team/.test(e)), errors.join("\n"));
  });

  it("accepts cloud roles with one local role", () => {
    assert.deepEqual(checkRoles({ architect: spec("openai-codex", "gpt-sol"), builder: spec("qwen-flash", "malos/qwen3.8-flash-next"), reviewer: "same" }, CATALOG), []);
  });
});

function scriptedHost(script: { inputs?: (string | undefined)[]; selects?: (string | undefined | ((options: string[]) => string | undefined))[] }) {
  const inputs = [...(script.inputs ?? [])];
  const selects = [...(script.selects ?? [])];
  const notes: string[] = [];
  const asked: { kind: string; title: string; options?: string[] }[] = [];
  const host: ModelsHost = {
    cwd: "/x",
    notify: (message) => notes.push(message),
    setStatus: () => {},
    input: async (title) => { asked.push({ kind: "input", title }); return inputs.shift(); },
    select: async (title, options) => {
      asked.push({ kind: "select", title, options });
      const next = selects.shift();
      return typeof next === "function" ? next(options) : next;
    },
  };
  return { host, notes, asked };
}
const pick = (needle: string) => (options: string[]) => options.find((option) => option.includes(needle));

describe("chooseRoles (interactive)", () => {
  it("asks per role: a filter word, the matching models, then the thinking level", async () => {
    const { host, asked } = scriptedHost({
      inputs: ["sol", "flash", ""],
      selects: [pick("gpt-sol"), pick("high"), pick("qwen-flash"), pick("low"), pick("same as builder")],
    });
    const roles = await chooseRoles(host, CATALOG, {});
    assert.deepEqual(roles, { architect: { provider: "openai-codex", model: "gpt-sol", thinking: "high" }, builder: { provider: "qwen-flash", model: "malos/qwen3.8-flash-next", thinking: "low" }, reviewer: "same" });
    const firstChoice = asked.find((entry) => entry.kind === "select");
    assert.deepEqual(firstChoice?.options?.filter((option) => /gpt-sol|claude|pi-llama/.test(option)).length, 1, "the filter narrowed the list to the match");
  });

  it("offers to keep the current model, and lets an empty filter list everything (capped)", async () => {
    const { host, asked } = scriptedHost({ inputs: [""], selects: [pick("keep current")] });
    const roles = await chooseRoles(host, CATALOG, { architect: { provider: "anthropic", model: "claude-fable-5" } }, { only: ["architect"] });
    assert.deepEqual(roles, { architect: { provider: "anthropic", model: "claude-fable-5" } });
    assert.ok(asked[1].options?.some((option) => /keep current: anthropic\/claude-fable-5/.test(option)));
  });

  it("says when nothing matches and asks again", async () => {
    const { host, notes } = scriptedHost({ inputs: ["zzzz", "sol"], selects: [pick("gpt-sol"), pick("high")] });
    const roles = await chooseRoles(host, CATALOG, {}, { only: ["architect"] });
    assert.equal((roles?.architect as { model: string }).model, "gpt-sol");
    assert.ok(notes.some((note) => /No model matches "zzzz"/.test(note)));
  });

  it("cancelling at any prompt returns nothing", async () => {
    assert.equal(await chooseRoles(scriptedHost({ inputs: [undefined] }).host, CATALOG, {}), undefined);
    assert.equal(await chooseRoles(scriptedHost({ inputs: ["sol"], selects: [undefined] }).host, CATALOG, {}), undefined);
  });

  it("skips the thinking question for a model that cannot think", async () => {
    const { host, asked } = scriptedHost({ inputs: ["coder"], selects: [pick("qwen3-coder")] });
    const roles = await chooseRoles(host, CATALOG, {}, { only: ["builder"] });
    assert.deepEqual(roles, { builder: { provider: "openrouter", model: "qwen/qwen3-coder" } });
    assert.equal(asked.filter((entry) => entry.kind === "select").length, 1);
  });
});

describe("modelsCommand", () => {
  async function paths() {
    const dir = await mkdtemp(join(tmpdir(), "foreman-models-"));
    return { global: join(dir, "agent/foreman.json"), project: join(dir, "project/.pi/foreman.json"), dir };
  }

  it("writes roles from arguments, creating the file and its folders", async () => {
    const p = await paths();
    const { host, notes } = scriptedHost({});
    await modelsCommand("architect=openai-codex/gpt-sol builder=qwen-flash/malos/qwen3.8-flash-next:low reviewer=same", host, { models: CATALOG, writePath: () => p.global, current: async () => ({}) });
    const written = JSON.parse(await readFile(p.global, "utf8"));
    assert.equal(written.roles.builder.thinking, "low");
    assert.deepEqual(written.roles.reviewer, { same_as: "builder" });
    assert.equal(written.selection, "mixed");
    assert.deepEqual(written.gpu.managedProviders, ["qwen-flash"]);
    assert.match(notes.join("\n"), /Saved[\s\S]*foreman\.json[\s\S]*architect[\s\S]*openai-codex\/gpt-sol/);
  });

  it("changes only the roles named, keeping the others and all other settings", async () => {
    const p = await paths();
    await mkdir(join(p.global, ".."), { recursive: true });
    await writeFile(p.global, JSON.stringify({ notes: ["n"], roles: { architect: { provider: "anthropic", model: "claude-fable-5" }, builder: { provider: "pi-llama", model: "pi/Qwen3.8-27B-UD-Q5_K_XL" }, reviewer: { same_as: "builder" } } }));
    const { host } = scriptedHost({});
    await modelsCommand("architect=openai-codex/gpt-sol", host, { models: CATALOG, writePath: () => p.global, current: async () => JSON.parse(await readFile(p.global, "utf8")) });
    const written = JSON.parse(await readFile(p.global, "utf8"));
    assert.equal(written.roles.architect.model, "gpt-sol");
    assert.equal(written.roles.builder.model, "pi/Qwen3.8-27B-UD-Q5_K_XL");
    assert.deepEqual(written.notes, ["n"]);
  });

  it("refuses models this host does not have, and writes nothing", async () => {
    const p = await paths();
    const { host, notes } = scriptedHost({});
    await modelsCommand("architect=openai-codex/gpt-missing", host, { models: CATALOG, writePath: () => p.global, current: async () => ({}) });
    assert.match(notes.join("\n"), /not available on this machine/);
    await assert.rejects(readFile(p.global, "utf8"));
  });

  it("refuses to overwrite a config that is not valid JSON", async () => {
    const p = await paths();
    await mkdir(join(p.global, ".."), { recursive: true });
    await writeFile(p.global, "{ not json");
    const { host, notes } = scriptedHost({});
    await modelsCommand("architect=openai-codex/gpt-sol", host, { models: CATALOG, writePath: () => p.global, current: async () => { throw new Error("invalid JSON"); } });
    assert.match(notes.join("\n"), /not valid JSON[\s\S]*left untouched/);
    assert.equal(await readFile(p.global, "utf8"), "{ not json");
  });

  it("with no arguments it runs the interactive picker, and with no UI it just shows the current models", async () => {
    const p = await paths();
    const interactive = scriptedHost({ inputs: ["sol", "", ""], selects: [pick("gpt-sol"), pick("high"), pick("keep"), pick("same as builder")] });
    await modelsCommand("", interactive.host, { models: CATALOG, writePath: () => p.global, current: async () => ({ roles: { builder: { provider: "anthropic", model: "claude-fable-5" } } }) });
    assert.equal(JSON.parse(await readFile(p.global, "utf8")).roles.architect.model, "gpt-sol");

    const bare: ModelsHost = { cwd: "/x", notify: () => {}, setStatus: () => {} };
    const notes: string[] = [];
    bare.notify = (message) => notes.push(message);
    await modelsCommand("", bare, { models: CATALOG, writePath: () => p.global, current: async () => ({}) });
    assert.match(notes.join("\n"), /interactive|architect=provider\/model/i);
  });

  it("--project writes the project file instead", async () => {
    const p = await paths();
    const { host } = scriptedHost({});
    await modelsCommand("architect=anthropic/claude-fable-5 --project", host, { models: CATALOG, writePath: (project) => (project ? p.project : p.global), current: async () => ({}) });
    assert.equal(JSON.parse(await readFile(p.project, "utf8")).roles.architect.provider, "anthropic");
    await assert.rejects(readFile(p.global, "utf8"));
  });
});
