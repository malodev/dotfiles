/**
 * Per-project model overrides.
 *
 * team/models.json carries role→model overrides that travel with the repository.
 * The host config (~/.config/pi-three-agent-team/config.json) defines providers;
 * this file only changes which model a role uses within its configured provider.
 *
 * Resolution: host config → project override → task snapshot (frozen at authorization).
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RoleProfile, TeamConfig, TeamRole } from "./config.ts";
import { parseTeamConfig } from "./config.ts";

const PROJECT_MODELS_PATH = "team/models.json";
const ROLE_NAMES: TeamRole[] = ["architect", "builder", "reviewer"];

export interface ProjectModelOverride {
  model: string;
}

export type ProjectOverrides = Partial<Record<TeamRole, ProjectModelOverride | null>>;

interface ProjectModelsFile {
  version: 1;
  roles: Record<string, ProjectModelOverride | null>;
}

/**
 * Reads team/models.json from the repository. Returns an empty object if the
 * file doesn't exist (no overrides). Throws on malformed files.
 */
export async function readProjectOverrides(repo: string): Promise<ProjectOverrides> {
  let raw: string;
  try {
    raw = await readFile(resolve(repo, PROJECT_MODELS_PATH), "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const parsed = JSON.parse(raw) as ProjectModelsFile;
  if (parsed.version !== 1) throw new Error("team/models.json version must be 1");
  if (!parsed.roles || typeof parsed.roles !== "object" || Array.isArray(parsed.roles)) {
    throw new Error("team/models.json roles must be a mapping");
  }
  const overrides: ProjectOverrides = {};
  for (const [key, value] of Object.entries(parsed.roles)) {
    if (!ROLE_NAMES.includes(key as TeamRole)) {
      throw new Error(`Unknown role in team/models.json: '${key}'`);
    }
    if (value === null) {
      overrides[key as TeamRole] = null;
    } else if (value && typeof value === "object" && typeof (value as ProjectModelOverride).model === "string") {
      overrides[key as TeamRole] = { model: (value as ProjectModelOverride).model };
    } else {
      throw new Error(`team/models.json roles.${key} must be null or { model: string }`);
    }
  }
  return overrides;
}

/**
 * Writes or removes a single role override to team/models.json.
 * Passing `null` as the model removes the override (reset to host default).
 */
export async function writeProjectOverride(
  repo: string,
  role: TeamRole,
  model: string | null,
): Promise<void> {
  const overrides = await readProjectOverrides(repo);
  if (model === null) {
    overrides[role] = null;
  } else {
    overrides[role] = { model };
  }
  const roles: Record<string, ProjectModelOverride | null> = {};
  for (const r of ROLE_NAMES) {
    const value = overrides[r];
    if (value !== undefined) roles[r] = value;
  }
  const file: ProjectModelsFile = { version: 1, roles };
  const filePath = resolve(repo, PROJECT_MODELS_PATH);
  await mkdir(resolve(repo, "team"), { recursive: true });
  await writeFile(filePath, JSON.stringify(file, null, 2) + "\n", "utf8");
}

/**
 * Resolves the effective TeamConfig by overlaying project overrides on the host config.
 * Only role.model can be overridden; providers, limits, and lifecycle stay host-level.
 */
export function resolveEffectiveConfig(hostConfig: TeamConfig, overrides: ProjectOverrides): TeamConfig {
  const roles = { ...hostConfig.roles };
  for (const role of ROLE_NAMES) {
    const override = overrides[role];
    if (override === null) continue; // explicit reset → use host default
    if (override?.model) {
      roles[role] = { ...roles[role], model: override.model };
    }
  }
  return { ...hostConfig, roles };
}

/**
 * Returns the effective model for a role, considering project overrides.
 */
export function effectiveModel(hostConfig: TeamConfig, overrides: ProjectOverrides, role: TeamRole): string {
  const override = overrides[role];
  const profile = hostConfig.roles[role];
  const model = override && override !== null ? override.model : profile.model;
  return `${profile.provider}/${profile.model === model ? profile.model : model}`;
}

/**
 * Queries a provider's /v1/models endpoint and returns a sorted list of model IDs.
 */
export async function fetchAvailableModels(providerUrl: string, apiKey: string): Promise<string[]> {
  const url = providerUrl.replace(/\/+$/, "") + "/models";
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Provider returned ${response.status} listing models at ${url}`);
  }
  const body = await response.json() as { data?: Array<{ id: string }> };
  if (!body.data || !Array.isArray(body.data)) {
    throw new Error(`Unexpected response from ${url}: missing data array`);
  }
  return body.data
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .sort();
}
