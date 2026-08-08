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
