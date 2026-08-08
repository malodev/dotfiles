/**
 * Tests for config.ts v2 — provider/model string roles.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseTeamConfig } from "./config.ts";

const V2_CONFIG = JSON.stringify({
  version: 2,
  infrastructure: {
    "pi-llama": {
      baseUrl: "https://llm.malo.tn.it/v1",
      credentialCommand: "~/.local/bin/pi-inference credential model-api",
    },
  },
  roles: {
    architect: "pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL",
    builder: "pi-llama/pi/Qwen3.6-27B-MTP-UD-Q5_K_XL",
    reviewer: "pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL",
  },
  limits: {
    builderAttempts: 3,
    reviewerAttempts: 3,
    roleTimeoutSeconds: 300,
    idleTimeoutSeconds: 60,
  },
  lifecycle: {
    managedProviders: ["pi-llama"],
    enterTeamCommand: "echo ok",
    leaseTtlSeconds: 300,
    leaseRenewIntervalSeconds: 100,
    restoreStudioAfterRun: false,
  },
  queue: {},
});

const V2_MULTI_PROVIDER = JSON.stringify({
  version: 2,
  infrastructure: {
    "pi-llama": {
      baseUrl: "https://llm.malo.tn.it/v1",
      credentialCommand: "~/.local/bin/pi-inference credential model-api",
    },
  },
  roles: {
    architect: "pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL",
    builder: "anthropic/claude-sonnet-4-5",
    reviewer: "pi-llama/pi/gemma-4-31B-it-qat-UD-Q4_K_XL",
  },
  limits: {
    builderAttempts: 3,
    reviewerAttempts: 3,
    roleTimeoutSeconds: 300,
    idleTimeoutSeconds: 60,
  },
  lifecycle: {
    managedProviders: ["pi-llama"],
    enterTeamCommand: "echo ok",
    leaseTtlSeconds: 300,
    leaseRenewIntervalSeconds: 100,
    restoreStudioAfterRun: false,
  },
  queue: {},
});

test("v2 config parses roles as provider/model strings", () => {
  const config = parseTeamConfig(V2_CONFIG);
  assert.equal(config.version, 2);
  assert.equal(config.roles.architect.provider, "pi-llama");
  assert.equal(config.roles.architect.model, "pi/gemma-4-31B-it-qat-UD-Q4_K_XL");
  assert.equal(config.roles.builder.provider, "pi-llama");
  assert.equal(config.roles.builder.model, "pi/Qwen3.6-27B-MTP-UD-Q5_K_XL");
  assert.equal(config.roles.reviewer.provider, "pi-llama");
});

test("v2 config parses infrastructure into providers", () => {
  const config = parseTeamConfig(V2_CONFIG);
  assert.ok(config.providers["pi-llama"]);
  assert.equal(config.providers["pi-llama"].baseUrl, "https://llm.malo.tn.it/v1");
  assert.equal(config.providers["pi-llama"].apiKey, "~/.local/bin/pi-inference credential model-api");
});

test("v2 config fills default RoleProfile fields", () => {
  const config = parseTeamConfig(V2_CONFIG);
  const arch = config.roles.architect;
  assert.equal(arch.reasoning, true);
  assert.equal(arch.input.length, 1);
  assert.equal(arch.input[0], "text");
  assert.equal(arch.contextWindow, 128_000);
  assert.equal(arch.maxTokens, 32_768);
  assert.equal(arch.thinking, "off");
});

test("v2 config with multi-provider roles parses correctly", () => {
  const config = parseTeamConfig(V2_MULTI_PROVIDER);
  assert.equal(config.roles.builder.provider, "anthropic");
  assert.equal(config.roles.builder.model, "claude-sonnet-4-5");
  assert.equal(config.roles.architect.provider, "pi-llama");
});

test("v2 config without infrastructure allows built-in providers", () => {
  // In v2, providers not in the config are assumed to be built-in (Anthropic, OpenAI, etc.)
  const config = parseTeamConfig(JSON.stringify({
    version: 2,
    roles: {
      architect: "anthropic/claude-sonnet-4-5",
      builder: "anthropic/claude-sonnet-4-5",
      reviewer: "anthropic/claude-sonnet-4-5",
    },
    limits: { builderAttempts: 3, reviewerAttempts: 3, roleTimeoutSeconds: 300, idleTimeoutSeconds: 60 },
    lifecycle: { managedProviders: [], enterTeamCommand: "echo ok", leaseTtlSeconds: 300, leaseRenewIntervalSeconds: 100, restoreStudioAfterRun: false },
    queue: {},
  }));
  assert.equal(config.version, 2);
  assert.equal(config.roles.architect.provider, "anthropic");
  assert.equal(config.roles.architect.model, "claude-sonnet-4-5");
});

test("v2 config fails when role is not provider/model format", () => {
  assert.throws(() => parseTeamConfig(JSON.stringify({
    version: 2,
    roles: {
      architect: "no-slash-here",
      builder: "anthropic/claude-sonnet-4-5",
      reviewer: "anthropic/claude-sonnet-4-5",
    },
    limits: { builderAttempts: 3, reviewerAttempts: 3, roleTimeoutSeconds: 300, idleTimeoutSeconds: 60 },
    lifecycle: { managedProviders: [], enterTeamCommand: "echo ok", leaseTtlSeconds: 300, leaseRenewIntervalSeconds: 100, restoreStudioAfterRun: false },
    queue: {},
  })), /provider\/model/);
});
