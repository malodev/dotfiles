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
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import type { TeamConfig, TeamRole } from "./config.ts";

const PROJECT_MODELS_PATH = "team/models.json";
const ROLE_NAMES: TeamRole[] = ["architect", "builder", "reviewer"];

export interface ProjectModelOverride {
  /** Full provider/model string, e.g. "anthropic/claude-sonnet-4-5" */
  model: string;
}

export type ProjectOverrides = Partial<Record<TeamRole, ProjectModelOverride | null>>;

interface ProjectModelsFile {
  version: 1;
  roles: Record<string, ProjectModelOverride | null>;
}

function runCommand(command: string, timeoutMs = 10_000): Promise<string> {
  const parts = command.split(/\s+/);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(parts[0], parts.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise(out.trim());
      else reject(new Error(`Command failed (${code}): ${err || out}`));
    });
  });
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
 * In v2, an override can be a full "provider/model" string that changes both.
 */
export function resolveEffectiveConfig(hostConfig: TeamConfig, overrides: ProjectOverrides): TeamConfig {
  const roles = { ...hostConfig.roles };
  for (const role of ROLE_NAMES) {
    const override = overrides[role];
    if (override === null) continue; // explicit reset → use host default
    if (override?.model) {
      const slashIndex = override.model.indexOf("/");
      if (slashIndex > 0) {
        roles[role] = { ...roles[role], provider: override.model.slice(0, slashIndex), model: override.model.slice(slashIndex + 1) };
      } else {
        roles[role] = { ...roles[role], model: override.model };
      }
    }
  }
  return { ...hostConfig, roles };
}

/**
 * Returns the effective model for a role, considering project overrides.
 */
export function effectiveModel(hostConfig: TeamConfig, overrides: ProjectOverrides, role: TeamRole): string {
  const override = overrides[role];
  if (override === null) {
    const p = hostConfig.roles[role];
    return `${p.provider}/${p.model}`;
  }
  if (override?.model) {
    if (override.model.includes("/")) return override.model;
    return `${hostConfig.roles[role].provider}/${override.model}`;
  }
  const p = hostConfig.roles[role];
  return `${p.provider}/${p.model}`;
}

/** A lightweight model reference — the shape we get from ctx.modelRegistry. */
export interface ModelRef {
  provider: string;
  id: string;
}

/** Builds a sorted list of "provider/id" strings from model registry entries. */
export function buildModelList(models: readonly ModelRef[]): string[] {
  return models.map((m) => `${m.provider}/${m.id}`).sort();
}

/**
 * Resolves an API key that may be a literal value or a shell command prefixed with `!`.
 * Uses the same spawn pattern proven in runner.ts.
 */
async function resolveApiKey(apiKey: string): Promise<string> {
  if (apiKey.startsWith("!")) {
    const cmd = apiKey.slice(1).replace(/^~/, homedir());
    return await runCommand(cmd);
  }
  return apiKey;
}

/**
 * Queries a provider's /v1/models endpoint and returns a sorted list of model IDs.
 */
export async function fetchAvailableModels(providerUrl: string, apiKey: string): Promise<string[]> {
  const credential = await resolveApiKey(apiKey);
  const url = providerUrl.replace(/\/+$/, "") + "/models";
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
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
