import { readFile } from "node:fs/promises";

export interface RoleProfile {
  provider: string;
  model: string;
  thinking?: string;
}

export interface ForemanConfig {
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
  const merged: Raw = { roles: {}, limits: {}, gpu: {} };
  for (const path of paths) {
    const layer = await readJson(path);
    if (!layer) continue;
    for (const section of ["roles", "limits", "gpu"]) Object.assign(merged[section], layer[section] ?? {});
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
  return {
    roles: { ...(roles.architect ? { architect: profile(roles.architect, "architect") } : {}), builder, reviewer },
    limits,
    gpu,
  };
}

export function modelId(role: RoleProfile): string {
  return `${role.provider}/${role.model}`;
}
