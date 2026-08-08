/**
 * Unit tests for project-config.ts — per-project model overrides.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { parseTeamConfig, type TeamConfig } from "./config.ts";
import {
  readProjectOverrides,
  writeProjectOverride,
  resolveEffectiveConfig,
  effectiveModel,
  buildModelList,
} from "./project-config.ts";

function hostConfig(): TeamConfig {
  return parseTeamConfig(JSON.stringify({
    version: 1,
    providers: {
      "test-provider": { name: "Test", baseUrl: "http://localhost:8080/v1", api: "openai-completions", apiKey: "sk-test" },
    },
    roles: {
      architect: { provider: "test-provider", model: "arch-default", name: "Arch", reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 4096, thinking: "off" },
      builder: { provider: "test-provider", model: "build-default", name: "Build", reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 4096, thinking: "off" },
      reviewer: { provider: "test-provider", model: "review-default", name: "Review", reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 4096, thinking: "off" },
    },
    limits: { builderAttempts: 3, reviewerAttempts: 3, roleTimeoutSeconds: 300, idleTimeoutSeconds: 60 },
    lifecycle: { managedProviders: [], enterTeamCommand: "echo ok", leaseTtlSeconds: 300, leaseRenewIntervalSeconds: 100, restoreStudioAfterRun: false },
    queue: {},
  }), "test");
}

async function tempRepo(): Promise<{ repo: string; cleanup: () => Promise<void> }> {
  const repo = await mkdtemp(resolve(tmpdir(), "project-config-test-"));
  return { repo, cleanup: async () => await rm(repo, { recursive: true, force: true }) };
}

test("readProjectOverrides returns empty when no file exists", async () => {
  const { repo, cleanup } = await tempRepo();
  try {
    const overrides = await readProjectOverrides(repo);
    assert.deepEqual(overrides, {});
  } finally {
    await cleanup();
  }
});

test("writeProjectOverride creates team/models.json with one override", async () => {
  const { repo, cleanup } = await tempRepo();
  try {
    await writeProjectOverride(repo, "architect", "custom-arch");
    const overrides = await readProjectOverrides(repo);
    assert.deepEqual(overrides, { architect: { model: "custom-arch" } });

    const raw = JSON.parse(await readFile(resolve(repo, "team/models.json"), "utf8"));
    assert.equal(raw.version, 1);
    assert.deepEqual(raw.roles.architect, { model: "custom-arch" });
    assert.equal(raw.roles.builder, undefined);
    assert.equal(raw.roles.reviewer, undefined);
  } finally {
    await cleanup();
  }
});

test("writeProjectOverride with null removes an existing override", async () => {
  const { repo, cleanup } = await tempRepo();
  try {
    await writeProjectOverride(repo, "architect", "custom-arch");
    await writeProjectOverride(repo, "builder", "custom-build");
    assert.deepEqual(await readProjectOverrides(repo), {
      architect: { model: "custom-arch" },
      builder: { model: "custom-build" },
    });

    await writeProjectOverride(repo, "architect", null);
    const overrides = await readProjectOverrides(repo);
    assert.equal(overrides.architect, null);
    assert.deepEqual(overrides.builder, { model: "custom-build" });

    const raw = JSON.parse(await readFile(resolve(repo, "team/models.json"), "utf8"));
    assert.equal(raw.roles.architect, null);
    assert.deepEqual(raw.roles.builder, { model: "custom-build" });
  } finally {
    await cleanup();
  }
});

test("resolveEffectiveConfig overlays project model overrides", async () => {
  const { repo, cleanup } = await tempRepo();
  try {
    await writeProjectOverride(repo, "architect", "custom-arch");
    await writeProjectOverride(repo, "builder", "custom-build");
    const overrides = await readProjectOverrides(repo);
    const host = hostConfig();
    const effective = resolveEffectiveConfig(host, overrides);

    assert.equal(effective.roles.architect.model, "custom-arch");
    assert.equal(effective.roles.builder.model, "custom-build");
    assert.equal(effective.roles.reviewer.model, "review-default"); // no override
    // Non-model fields preserved
    assert.equal(effective.roles.architect.provider, "test-provider");
    assert.equal(effective.limits.builderAttempts, 3);
  } finally {
    await cleanup();
  }
});

test("resolveEffectiveConfig with explicit null keeps host default", async () => {
  const { repo, cleanup } = await tempRepo();
  try {
    await writeProjectOverride(repo, "architect", "custom-arch");
    await writeProjectOverride(repo, "architect", null);
    const overrides = await readProjectOverrides(repo);
    const host = hostConfig();
    const effective = resolveEffectiveConfig(host, overrides);
    assert.equal(effective.roles.architect.model, "arch-default");
  } finally {
    await cleanup();
  }
});

test("effectiveModel returns project override when present", () => {
  const host = hostConfig();
  const overrides = { builder: { model: "custom-build" } };
  assert.equal(effectiveModel(host, overrides, "builder"), "test-provider/custom-build");
});

test("effectiveModel returns host default when no override", () => {
  const host = hostConfig();
  assert.equal(effectiveModel(host, {}, "architect"), "test-provider/arch-default");
});

test("effectiveModel returns host default for explicit null", () => {
  const host = hostConfig();
  const overrides = { architect: null };
  assert.equal(effectiveModel(host, overrides, "architect"), "test-provider/arch-default");
});

test("resolveEffectiveConfig handles full provider/model override", () => {
  const host = hostConfig();
  const overrides = { builder: { model: "anthropic/claude-sonnet-4-5" } };
  const effective = resolveEffectiveConfig(host, overrides);
  assert.equal(effective.roles.builder.provider, "anthropic");
  assert.equal(effective.roles.builder.model, "claude-sonnet-4-5");
  // Architect unchanged
  assert.equal(effective.roles.architect.provider, "test-provider");
  assert.equal(effective.roles.architect.model, "arch-default");
});

test("effectiveModel returns full provider/model override as-is", () => {
  const host = hostConfig();
  const overrides = { architect: { model: "openai/gpt-5" } };
  assert.equal(effectiveModel(host, overrides, "architect"), "openai/gpt-5");
});

test("effectiveModel returns bare model prefixed with host provider", () => {
  const host = hostConfig();
  const overrides = { builder: { model: "custom-build" } };
  assert.equal(effectiveModel(host, overrides, "builder"), "test-provider/custom-build");
});

test("v2 config roles carry provider/model from string format", () => {
  const config = parseTeamConfig(JSON.stringify({
    version: 2,
    infrastructure: {
      "pi-llama": { baseUrl: "https://llm.example.com/v1", credentialCommand: "echo key" },
    },
    roles: {
      architect: "pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL",
      builder: "anthropic/claude-sonnet-4-5",
      reviewer: "pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL",
    },
    limits: { builderAttempts: 3, reviewerAttempts: 3, roleTimeoutSeconds: 300, idleTimeoutSeconds: 60 },
    lifecycle: { managedProviders: [], enterTeamCommand: "echo ok", leaseTtlSeconds: 300, leaseRenewIntervalSeconds: 100, restoreStudioAfterRun: false },
    queue: {},
  }));
  assert.equal(config.roles.architect.provider, "pi-llama");
  assert.equal(config.roles.builder.provider, "anthropic");
});

test("v2 config + full provider/model override changes both", () => {
  const config = parseTeamConfig(JSON.stringify({
    version: 2,
    infrastructure: {
      "pi-llama": { baseUrl: "https://llm.example.com/v1", credentialCommand: "echo key" },
    },
    roles: {
      architect: "pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL",
      builder: "pi-llama/pi/Qwen3.6-27B-MTP-UD-Q5_K_XL",
      reviewer: "pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL",
    },
    limits: { builderAttempts: 3, reviewerAttempts: 3, roleTimeoutSeconds: 300, idleTimeoutSeconds: 60 },
    lifecycle: { managedProviders: [], enterTeamCommand: "echo ok", leaseTtlSeconds: 300, leaseRenewIntervalSeconds: 100, restoreStudioAfterRun: false },
    queue: {},
  }));
  const overrides = { builder: { model: "anthropic/claude-sonnet-4-5" } };
  const effective = resolveEffectiveConfig(config, overrides);
  assert.equal(effective.roles.builder.provider, "anthropic");
  assert.equal(effective.roles.builder.model, "claude-sonnet-4-5");
});

test("v2 config + bare model override keeps host provider", () => {
  const config = parseTeamConfig(JSON.stringify({
    version: 2,
    roles: {
      architect: "pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL",
      builder: "pi-llama/pi/Qwen3.6-27B-MTP-UD-Q5_K_XL",
      reviewer: "pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL",
    },
    limits: { builderAttempts: 3, reviewerAttempts: 3, roleTimeoutSeconds: 300, idleTimeoutSeconds: 60 },
    lifecycle: { managedProviders: [], enterTeamCommand: "echo ok", leaseTtlSeconds: 300, leaseRenewIntervalSeconds: 100, restoreStudioAfterRun: false },
    queue: {},
  }));
  // A bare model ID without slashes keeps the host provider
  const overrides = { architect: { model: "different-arch-model" } };
  const effective = resolveEffectiveConfig(config, overrides);
  assert.equal(effective.roles.architect.provider, "pi-llama");
  assert.equal(effective.roles.architect.model, "different-arch-model");
  assert.equal(effectiveModel(config, overrides, "architect"), "pi-llama/different-arch-model");
});

test("model IDs containing slashes need full provider/model override", () => {
  // pi-llama models have IDs like "pi/gemma-4-..." with internal slashes.
  // A bare override "pi/Ornith" would be ambiguous (provider=pi? model=Ornith?).
  // The picker always stores the full "provider/model" string to avoid this.
  const host = hostConfig();
  const overrides = { architect: { model: "test-provider/model-with/slashes" } };
  const effective = resolveEffectiveConfig(host, overrides);
  assert.equal(effective.roles.architect.provider, "test-provider");
  assert.equal(effective.roles.architect.model, "model-with/slashes");
});

test("effectiveTeamConfig chain: host → project override → resolved", async () => {
  const { repo, cleanup } = await tempRepo();
  try {
    const host = hostConfig();
    // No overrides: effective = host
    const overrides1 = await readProjectOverrides(repo);
    const eff1 = resolveEffectiveConfig(host, overrides1);
    assert.equal(eff1.roles.architect.model, "arch-default");
    assert.equal(eff1.roles.builder.model, "build-default");

    // Write a full provider/model override
    await writeProjectOverride(repo, "builder", "external/claude-sonnet");
    const overrides2 = await readProjectOverrides(repo);
    const eff2 = resolveEffectiveConfig(host, overrides2);
    assert.equal(eff2.roles.builder.provider, "external");
    assert.equal(eff2.roles.builder.model, "claude-sonnet");
    // Architect unchanged
    assert.equal(eff2.roles.architect.provider, "test-provider");
    assert.equal(eff2.roles.architect.model, "arch-default");

    // Reset via null
    await writeProjectOverride(repo, "builder", null);
    const overrides3 = await readProjectOverrides(repo);
    const eff3 = resolveEffectiveConfig(host, overrides3);
    assert.equal(eff3.roles.builder.model, "build-default");
  } finally {
    await cleanup();
  }
});

test("buildModelList maps and sorts provider/id pairs", () => {
  const models = [
    { provider: "z-provider", id: "model-a" },
    { provider: "a-provider", id: "model-z" },
    { provider: "a-provider", id: "model-a" },
  ];
  const list = buildModelList(models);
  assert.deepEqual(list, [
    "a-provider/model-a",
    "a-provider/model-z",
    "z-provider/model-a",
  ]);
});

test("buildModelList handles model IDs with slashes", () => {
  const models = [
    { provider: "pi-llama", id: "pi/Qwen3.6-27B" },
    { provider: "pi-llama", id: "pi/gemma-4-31B" },
  ];
  const list = buildModelList(models);
  assert.deepEqual(list, [
    "pi-llama/pi/Qwen3.6-27B",
    "pi-llama/pi/gemma-4-31B",
  ]);
});

test("buildModelList returns empty for empty input", () => {
  assert.deepEqual(buildModelList([]), []);
});
