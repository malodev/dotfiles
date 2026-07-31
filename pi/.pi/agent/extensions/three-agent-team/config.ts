import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type TeamRole = "architect" | "builder" | "reviewer";
export type TeamThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ProviderProfile {
  name: string;
  baseUrl: string;
  api: "openai-completions";
  apiKey: string;
  authHeader?: boolean;
  compat?: Record<string, unknown>;
}

export interface RoleProfile {
  provider: string;
  model: string;
  name: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  thinking: TeamThinkingLevel;
}

export interface TeamLimits {
  builderAttempts: number;
  reviewerAttempts: number;
  roleTimeoutSeconds: number;
  idleTimeoutSeconds: number;
}

export interface TeamLifecycle {
  managedProviders: string[];
  enterTeamCommand: string;
  acquireTeamCommand?: string;
  renewTeamCommand?: string;
  releaseTeamCommand?: string;
  leaseTtlSeconds: number;
  leaseRenewIntervalSeconds: number;
  restoreStudioAfterRun: boolean;
  restoreStudioCommand?: string;
}

export interface TeamQueueTiming {
  leaseTtlSeconds: number;
  heartbeatIntervalSeconds: number;
  executionLockTimeoutSeconds: number;
  localExpiryMarginSeconds: number;
}

export interface TeamConfig {
  version: 1;
  providers: Record<string, ProviderProfile>;
  roles: Record<TeamRole, RoleProfile>;
  limits: TeamLimits;
  lifecycle: TeamLifecycle;
  queue: TeamQueueTiming;
  sourcePath: string;
  configHash: string;
}

export interface TaskRuntimeSnapshot {
  version: 1;
  sourceConfig: string;
  configHash: string;
  roles: Record<TeamRole, RoleProfile>;
  limits: TeamLimits;
}

const ROLE_NAMES: TeamRole[] = ["architect", "builder", "reviewer"];
const THINKING_LEVELS = new Set<TeamThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive integer`);
  return Number(value);
}

function parseRole(value: unknown, label: string): RoleProfile {
  const role = object(value, label);
  const input = role.input;
  if (!Array.isArray(input) || input.length === 0 || input.some((item) => item !== "text" && item !== "image")) {
    throw new Error(`${label}.input must contain text and/or image`);
  }
  const thinking = nonEmpty(role.thinking, `${label}.thinking`) as TeamThinkingLevel;
  if (!THINKING_LEVELS.has(thinking)) throw new Error(`${label}.thinking is invalid`);
  const contextWindow = positiveInteger(role.contextWindow, `${label}.contextWindow`);
  const maxTokens = positiveInteger(role.maxTokens, `${label}.maxTokens`);
  if (maxTokens >= contextWindow) throw new Error(`${label}.maxTokens must be smaller than contextWindow`);
  return {
    provider: nonEmpty(role.provider, `${label}.provider`),
    model: nonEmpty(role.model, `${label}.model`),
    name: nonEmpty(role.name, `${label}.name`),
    reasoning: role.reasoning === true,
    input: input as Array<"text" | "image">,
    contextWindow,
    maxTokens,
    thinking,
  };
}

function parseLimits(value: unknown): TeamLimits {
  const limits = object(value, "limits");
  return {
    builderAttempts: positiveInteger(limits.builderAttempts, "limits.builderAttempts"),
    reviewerAttempts: positiveInteger(limits.reviewerAttempts, "limits.reviewerAttempts"),
    roleTimeoutSeconds: positiveInteger(limits.roleTimeoutSeconds, "limits.roleTimeoutSeconds"),
    idleTimeoutSeconds: positiveInteger(limits.idleTimeoutSeconds, "limits.idleTimeoutSeconds"),
  };
}

function parseRoles(value: unknown): Record<TeamRole, RoleProfile> {
  const roles = object(value, "roles");
  return Object.fromEntries(ROLE_NAMES.map((role) => [role, parseRole(roles[role], `roles.${role}`)])) as Record<TeamRole, RoleProfile>;
}

function optionalPositiveInteger(value: unknown, fallback: number, label: string): number {
  return value === undefined ? fallback : positiveInteger(value, label);
}

function parseQueueTiming(value: unknown): TeamQueueTiming {
  const queue = value === undefined ? {} : object(value, "queue");
  const leaseTtlSeconds = optionalPositiveInteger(queue.leaseTtlSeconds, 120, "queue.leaseTtlSeconds");
  const heartbeatIntervalSeconds = optionalPositiveInteger(
    queue.heartbeatIntervalSeconds,
    30,
    "queue.heartbeatIntervalSeconds",
  );
  const executionLockTimeoutSeconds = optionalPositiveInteger(
    queue.executionLockTimeoutSeconds,
    30,
    "queue.executionLockTimeoutSeconds",
  );
  const localExpiryMarginSeconds = optionalPositiveInteger(
    queue.localExpiryMarginSeconds,
    15,
    "queue.localExpiryMarginSeconds",
  );
  if (leaseTtlSeconds < 30) throw new Error("queue.leaseTtlSeconds must be at least 30 seconds");
  if (heartbeatIntervalSeconds + localExpiryMarginSeconds >= leaseTtlSeconds) {
    throw new Error("queue heartbeat and local expiry margin must leave time before lease expiry");
  }
  return { leaseTtlSeconds, heartbeatIntervalSeconds, executionLockTimeoutSeconds, localExpiryMarginSeconds };
}

export function parseTeamConfig(text: string, sourcePath = "<memory>"): TeamConfig {
  const raw = object(JSON.parse(text), "configuration");
  if (raw.version !== 1) throw new Error("configuration.version must be 1");
  const providersRaw = object(raw.providers, "providers");
  const providers: Record<string, ProviderProfile> = {};
  for (const [id, value] of Object.entries(providersRaw)) {
    const provider = object(value, `providers.${id}`);
    if (provider.api !== "openai-completions") throw new Error(`providers.${id}.api must be openai-completions`);
    providers[id] = {
      name: nonEmpty(provider.name, `providers.${id}.name`),
      baseUrl: nonEmpty(provider.baseUrl, `providers.${id}.baseUrl`),
      api: "openai-completions",
      apiKey: nonEmpty(provider.apiKey, `providers.${id}.apiKey`),
      authHeader: provider.authHeader === true,
      compat: provider.compat ? object(provider.compat, `providers.${id}.compat`) : undefined,
    };
  }
  const roles = parseRoles(raw.roles);
  for (const role of ROLE_NAMES) {
    if (!providers[roles[role].provider]) throw new Error(`roles.${role} references unknown provider ${roles[role].provider}`);
  }
  const lifecycleRaw = object(raw.lifecycle, "lifecycle");
  const leaseCommands = ["acquireTeamCommand", "renewTeamCommand", "releaseTeamCommand"] as const;
  const configuredLeaseCommands = leaseCommands.filter((key) => typeof lifecycleRaw[key] === "string");
  if (configuredLeaseCommands.length !== 0 && configuredLeaseCommands.length !== leaseCommands.length) {
    throw new Error("lifecycle acquireTeamCommand, renewTeamCommand, and releaseTeamCommand must be configured together");
  }
  const leaseTtlSeconds = lifecycleRaw.leaseTtlSeconds === undefined
    ? 300
    : positiveInteger(lifecycleRaw.leaseTtlSeconds, "lifecycle.leaseTtlSeconds");
  const leaseRenewIntervalSeconds = lifecycleRaw.leaseRenewIntervalSeconds === undefined
    ? Math.max(10, Math.floor(leaseTtlSeconds / 3))
    : positiveInteger(lifecycleRaw.leaseRenewIntervalSeconds, "lifecycle.leaseRenewIntervalSeconds");
  if (leaseTtlSeconds < 120) {
    throw new Error("lifecycle.leaseTtlSeconds must be at least 120 seconds");
  }
  if (leaseRenewIntervalSeconds + 90 > leaseTtlSeconds) {
    throw new Error("lifecycle lease renewal must leave at least 90 seconds before expiry");
  }
  const canonical = JSON.stringify(raw);
  return {
    version: 1,
    providers,
    roles,
    limits: parseLimits(raw.limits),
    lifecycle: {
      managedProviders: Array.isArray(lifecycleRaw.managedProviders)
        ? lifecycleRaw.managedProviders.map((value, index) => nonEmpty(value, `lifecycle.managedProviders[${index}]`))
        : [],
      enterTeamCommand: nonEmpty(lifecycleRaw.enterTeamCommand, "lifecycle.enterTeamCommand"),
      acquireTeamCommand: configuredLeaseCommands.length ? nonEmpty(lifecycleRaw.acquireTeamCommand, "lifecycle.acquireTeamCommand") : undefined,
      renewTeamCommand: configuredLeaseCommands.length ? nonEmpty(lifecycleRaw.renewTeamCommand, "lifecycle.renewTeamCommand") : undefined,
      releaseTeamCommand: configuredLeaseCommands.length ? nonEmpty(lifecycleRaw.releaseTeamCommand, "lifecycle.releaseTeamCommand") : undefined,
      leaseTtlSeconds,
      leaseRenewIntervalSeconds,
      restoreStudioAfterRun: lifecycleRaw.restoreStudioAfterRun === true,
      restoreStudioCommand: typeof lifecycleRaw.restoreStudioCommand === "string" ? lifecycleRaw.restoreStudioCommand : undefined,
    },
    queue: parseQueueTiming(raw.queue),
    sourcePath,
    configHash: createHash("sha256").update(canonical).digest("hex"),
  };
}

export async function loadTeamConfig(path = process.env.PI_THREE_AGENT_CONFIG || join(homedir(), ".config", "pi-three-agent-team", "config.json")): Promise<TeamConfig> {
  return parseTeamConfig(await readFile(path, "utf8"), path);
}

export function roleModel(config: TeamConfig, role: TeamRole): string {
  const profile = config.roles[role];
  return `${profile.provider}/${profile.model}`;
}

export function expectedIdentity(config: TeamConfig, role: TeamRole): { provider: string; model: string } {
  const profile = config.roles[role];
  return { provider: profile.provider, model: profile.model };
}

export function taskRuntimeSnapshot(config: TeamConfig): TaskRuntimeSnapshot {
  return {
    version: 1,
    sourceConfig: config.sourcePath,
    configHash: config.configHash,
    roles: config.roles,
    limits: config.limits,
  };
}

export async function loadOrCreateTaskConfig(taskDir: string, current: TeamConfig): Promise<TeamConfig> {
  const path = resolve(taskDir, "runtime-config.json");
  let snapshot: TaskRuntimeSnapshot;
  try {
    snapshot = JSON.parse(await readFile(path, "utf8")) as TaskRuntimeSnapshot;
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    snapshot = taskRuntimeSnapshot(current);
    await writeFile(path, JSON.stringify(snapshot, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  }
  if (snapshot.version !== 1) throw new Error("task runtime-config.json version must be 1");
  const roles = parseRoles(snapshot.roles);
  const limits = parseLimits(snapshot.limits);
  for (const role of ROLE_NAMES) {
    if (!current.providers[roles[role].provider]) {
      throw new Error(`task runtime configuration references unavailable provider ${roles[role].provider}`);
    }
  }
  return { ...current, roles, limits };
}

export async function writeChildAgentConfig(config: TeamConfig, agentDir: string): Promise<string[]> {
  await mkdir(agentDir, { recursive: true });
  const grouped = new Map<string, Map<string, RoleProfile>>();
  for (const role of ROLE_NAMES) {
    const profile = config.roles[role];
    const models = grouped.get(profile.provider) ?? new Map<string, RoleProfile>();
    const existing = models.get(profile.model);
    if (existing && JSON.stringify(existing) !== JSON.stringify(profile)) {
      throw new Error(`roles sharing ${profile.provider}/${profile.model} must use identical model metadata`);
    }
    models.set(profile.model, profile);
    grouped.set(profile.provider, models);
  }
  const providers: Record<string, unknown> = {};
  for (const [providerId, models] of grouped) {
    const provider = config.providers[providerId];
    providers[providerId] = {
      ...provider,
      models: [...models.values()].map(({ provider: _provider, model: id, thinking: _thinking, ...model }) => ({
        id,
        ...model,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      })),
    };
  }
  const files = ["models.json", "settings.json", "auth.json"];
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers }, null, 2) + "\n", { mode: 0o600 });
  await writeFile(join(agentDir, "settings.json"), "{}\n", { mode: 0o600 });
  await writeFile(join(agentDir, "auth.json"), "{}\n", { mode: 0o600 });
  return files.map((file) => join(agentDir, file));
}
