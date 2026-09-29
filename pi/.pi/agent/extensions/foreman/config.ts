import { readFile } from "node:fs/promises";

export interface RoleProfile {
  provider: string;
  model: string;
  thinking?: string;
}

export type RoleName = "architect" | "builder" | "reviewer";

/** Host modes in which one fixed model serves all three roles (the roles block is used in `team`). */
export const SINGLE_MODEL_MODES = ["ds4", "qwen-flash"] as const;

export interface ForemanConfig {
  /** The single model each of ds4 / qwen-flash serves, used for all three roles in that mode. */
  modes: Partial<Record<(typeof SINGLE_MODEL_MODES)[number], RoleProfile>>;
  /** Which file each role's model came from, so `status` can show where to change it. */
  roleSources: Partial<Record<RoleName, string>>;
  /** Facts about this machine the Architect must plan around (tool versions, offline browsers, ...). */
  notes: string[];
  roles: { architect?: RoleProfile; builder: RoleProfile; reviewer: RoleProfile };
  limits: {
    buildAttempts: number;
    reviewAttempts: number;
    roleTimeoutSeconds: number;
    idleTimeoutSeconds: number;
    /** Idle deadline for the first request after a model switch, which includes loading weights. */
    modelLoadTimeoutSeconds: number;
    testTimeoutSeconds: number;
  };
  gpu: {
    managedProviders: string[];
    command: string;
    mode: string;
    leaseTtlSeconds: number;
    renewIntervalSeconds: number;
    acquireTimeoutSeconds: number;
    expiryMarginSeconds: number;
  };
}

const DEFAULTS = {
  limits: {
    buildAttempts: 4,
    reviewAttempts: 2,
    roleTimeoutSeconds: 1800,
    idleTimeoutSeconds: 300,
    modelLoadTimeoutSeconds: 600,
    testTimeoutSeconds: 600,
  },
  gpu: {
    managedProviders: [] as string[],
    command: "pi-inference",
    mode: "team",
    leaseTtlSeconds: 300,
    renewIntervalSeconds: 100,
    acquireTimeoutSeconds: 210,
    expiryMarginSeconds: 20,
  },
};

type Raw = Record<string, any>;

async function readJson(path: string): Promise<Raw | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return JSON.parse(text) as Raw;
  } catch (error) {
    throw new Error(`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${name} must be a positive integer`);
  return value as number;
}

function profile(raw: Raw | undefined, name: string): RoleProfile {
  if (!raw || typeof raw.provider !== "string" || typeof raw.model !== "string" || !raw.provider || !raw.model) {
    throw new Error(`roles.${name} needs "provider" and "model" (or "same_as"). Configure it in ~/.pi/agent/foreman.json or .pi/foreman.json; see foreman.example.json in the extension.`);
  }
  return { provider: raw.provider, model: raw.model, ...(typeof raw.thinking === "string" ? { thinking: raw.thinking } : {}) };
}

/** Later layers win, one section at a time. Files that do not exist are skipped. */
export async function loadConfig(paths: string[]): Promise<ForemanConfig> {
  const merged: Raw = { roles: {}, limits: {}, gpu: {}, modes: {}, notes: [] };
  const roleSources: Partial<Record<RoleName, string>> = {};
  for (const path of paths) {
    const layer = await readJson(path);
    if (!layer) continue;
    for (const name of Object.keys(layer.roles ?? {})) roleSources[name as RoleName] = path;
    for (const section of ["roles", "limits", "gpu", "modes"]) Object.assign(merged[section], layer[section] ?? {});
    if (layer.notes !== undefined) merged.notes = [...merged.notes, ...(Array.isArray(layer.notes) ? layer.notes : [layer.notes])];
  }
  const limits = { ...DEFAULTS.limits, ...merged.limits };
  for (const [key, value] of Object.entries(limits)) positiveInteger(value, `limits.${key}`);
  const gpu = { ...DEFAULTS.gpu, ...merged.gpu };
  for (const key of ["leaseTtlSeconds", "renewIntervalSeconds", "acquireTimeoutSeconds", "expiryMarginSeconds"] as const) positiveInteger(gpu[key], `gpu.${key}`);
  if (!Array.isArray(gpu.managedProviders) || gpu.managedProviders.some((entry: unknown) => typeof entry !== "string")) {
    throw new Error("gpu.managedProviders must be a list of provider names");
  }
  if (gpu.renewIntervalSeconds + gpu.expiryMarginSeconds >= gpu.leaseTtlSeconds) {
    throw new Error("gpu.renewIntervalSeconds + gpu.expiryMarginSeconds must be less than gpu.leaseTtlSeconds");
  }

  const modes: ForemanConfig["modes"] = {};
  for (const mode of SINGLE_MODEL_MODES) {
    if (merged.modes[mode] !== undefined) modes[mode] = profile(merged.modes[mode], `modes.${mode}`);
  }
  const notes = merged.notes ?? [];
  if (!Array.isArray(notes) || notes.some((note: unknown) => typeof note !== "string")) throw new Error("notes must be a list of strings");
  const roles = merged.roles;
  const builder = profile(roles.builder, "builder");
  const reviewerRaw = roles.reviewer;
  let reviewer: RoleProfile;
  if (reviewerRaw?.same_as !== undefined) {
    if (reviewerRaw.same_as !== "builder") throw new Error('roles.reviewer.same_as can only be "builder"');
    reviewer = { ...builder, ...(typeof reviewerRaw.thinking === "string" ? { thinking: reviewerRaw.thinking } : {}) };
  } else {
    reviewer = profile(reviewerRaw, "reviewer");
  }
  if (reviewerRaw?.same_as !== undefined) roleSources.reviewer = `${roleSources.reviewer ?? "config"} (same as builder)`;
  return {
    notes,
    modes,
    roleSources,
    roles: { ...(roles.architect ? { architect: profile(roles.architect, "architect") } : {}), builder, reviewer },
    limits,
    gpu,
  };
}

/**
 * The config as it applies to the host's current mode. In `team` the roles block rules. In `ds4` and
 * `qwen-flash` the one model that mode serves is used for all three roles, and the lease is taken in
 * that mode. Any other mode (studio, stop, maintenance, unknown) is refused rather than switched away
 * from, so a run never evicts what the card is doing.
 */
export function applyHostMode(config: ForemanConfig, mode: string): ForemanConfig {
  if (mode === "team") return { ...config, gpu: { ...config.gpu, mode } };
  if ((SINGLE_MODEL_MODES as readonly string[]).includes(mode)) {
    const single = config.modes[mode as (typeof SINGLE_MODEL_MODES)[number]];
    if (!single) {
      throw new Error(`The host is in ${mode} mode but foreman.json has no "modes.${mode}" model. Add { "provider", "model" } there.`);
    }
    return {
      ...config,
      roles: { architect: single, builder: single, reviewer: single },
      roleSources: { architect: `modes.${mode}`, builder: `modes.${mode}`, reviewer: `modes.${mode}` },
      gpu: { ...config.gpu, mode, managedProviders: [...new Set([...config.gpu.managedProviders, single.provider])] },
    };
  }
  throw new Error(`The host is in ${mode} mode. Foreman needs team, ds4 or qwen-flash: switch the mode in the panel first.`);
}

export function modelId(role: RoleProfile): string {
  return `${role.provider}/${role.model}`;
}
