import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_PROVIDER_MODES } from "./config.ts";

export const ROLES = ["architect", "builder", "reviewer"] as const;
export type Role = (typeof ROLES)[number];
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface RoleSpec {
  provider: string;
  model: string;
  thinking?: string;
}
export type RoleChoice = RoleSpec | "same";
export type RoleChoices = Partial<Record<Role, RoleChoice>>;

/** What this host's pi knows about a model it can use. */
export interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
  reasoning: boolean;
  contextWindow?: number;
  thinkingLevelMap?: Record<string, string | null | undefined>;
}

export interface ModelsHost {
  cwd: string;
  notify(message: string, level?: "info" | "warning" | "error"): void;
  setStatus(text: string | undefined): void;
  select?(title: string, options: string[]): Promise<string | undefined>;
  input?(title: string, placeholder?: string): Promise<string | undefined>;
}

type Raw = Record<string, any>;
const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The levels pi offers for a model: the same rules pi applies (off can be hidden; xhigh and max are opt-in). */
export function thinkingLevelsFor(model: Pick<ModelInfo, "reasoning" | "thinkingLevelMap">): string[] {
  if (!model.reasoning) return ["off"];
  return LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

/** Every word must appear in `provider/id name`, case-insensitively. */
export function filterModels(models: ModelInfo[], query: string): ModelInfo[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((model) => {
    const haystack = `${model.provider}/${model.id} ${model.name ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function describeModel(model: ModelInfo): string {
  const k = model.contextWindow ? Math.round(model.contextWindow / 1024) : undefined;
  const context = k === undefined ? "" : ` · ${k >= 1000 ? `${(k / 1024).toFixed(1).replace(/\.0$/, "")}M` : `${k}K`} ctx`;
  return `${model.provider}/${model.id}${context} · ${model.reasoning ? "thinks" : "no thinking"}`;
}

/** `provider/model[:level]` or `same`. The model keeps any further slashes; a suffix is a level only if it is one. */
export function parseRoleSpec(text: string): RoleChoice {
  if (text === "same") return "same";
  const slash = text.indexOf("/");
  if (slash < 1 || slash === text.length - 1) throw new Error(`"${text}" must look like provider/model (or "same" for the reviewer)`);
  const provider = text.slice(0, slash);
  let model = text.slice(slash + 1);
  const suffix = new RegExp(`^(.*):(${LEVELS.join("|")})$`).exec(model);
  if (suffix) {
    model = suffix[1];
    return { provider, model, thinking: suffix[2] };
  }
  return { provider, model };
}

export function parseModelsArgs(args: string): { project: boolean; specs: RoleChoices } {
  const tokens = args.split(/\s+/).filter(Boolean);
  const specs: RoleChoices = {};
  let project = false;
  for (const token of tokens) {
    if (token === "--project") {
      project = true;
      continue;
    }
    const match = /^(\w+)=(.+)$/.exec(token);
    if (!match) throw new Error(`Use role=provider/model, for example architect=openai-codex/gpt-… (got "${token}")`);
    const [, role, value] = match;
    if (!(ROLES as readonly string[]).includes(role)) throw new Error(`unknown role "${role}" (use architect, builder or reviewer)`);
    const spec = parseRoleSpec(value);
    if (spec === "same" && role !== "reviewer") throw new Error(`only the reviewer can be "same" (as the builder)`);
    specs[role as Role] = spec;
  }
  return { project, specs };
}

/** Write the chosen roles into a foreman config object, keeping everything else. */
export function applyRoles(existing: Raw, choices: RoleChoices): Raw {
  const out: Raw = structuredClone(existing);
  out.roles = { ...(out.roles ?? {}) };
  for (const role of ROLES) {
    const choice = choices[role];
    if (choice === undefined) continue;
    out.roles[role] = choice === "same" ? { same_as: "builder" } : { provider: choice.provider, model: choice.model, ...(choice.thinking ? { thinking: choice.thinking } : {}) };
  }
  out.selection = "mixed";
  const locals = [...new Set(ROLES.map((role) => out.roles[role]?.provider).filter((provider): provider is string => typeof provider === "string" && provider in DEFAULT_PROVIDER_MODES))];
  if (locals.length) {
    out.gpu = { ...(out.gpu ?? {}) };
    const managed: string[] = [...(out.gpu.managedProviders ?? [])];
    for (const provider of locals) if (!managed.includes(provider)) managed.push(provider);
    out.gpu.managedProviders = managed;
  }
  return out;
}

/**
 * Problems with a set of role choices on this host: models that are not available here (only for the
 * roles in `only`, so an old unrelated role cannot block a change), and local roles that need
 * different GPU modes, which the single card cannot serve at once.
 */
export function checkRoles(choices: RoleChoices, models: ModelInfo[], only: readonly Role[] = ROLES): string[] {
  const errors: string[] = [];
  for (const role of only) {
    const choice = choices[role];
    if (!choice || choice === "same") continue;
    if (!models.some((model) => model.provider === choice.provider && model.id === choice.model)) {
      errors.push(`${capitalize(role)} model ${choice.provider}/${choice.model} is not available on this machine (not logged in, or not configured in pi here).`);
    }
  }
  const hostModes = [...new Set(ROLES.map((role) => choices[role]).flatMap((choice) => (choice && choice !== "same" && DEFAULT_PROVIDER_MODES[choice.provider] ? [DEFAULT_PROVIDER_MODES[choice.provider]] : [])))];
  if (hostModes.length > 1) {
    errors.push(`Roles need more than one host mode (${hostModes.join(" and ")}); the GPU serves one at a time. Pick local models from one provider.`);
  }
  return errors;
}

const MAX_LISTED = 40;

/**
 * Ask for the models role by role: a filter word, the matching models, then the thinking level.
 * Returns undefined if the owner cancels at any prompt.
 */
export async function chooseRoles(host: ModelsHost, models: ModelInfo[], current: RoleChoices, options: { only?: readonly Role[] } = {}): Promise<RoleChoices | undefined> {
  if (!host.input || !host.select) return undefined;
  const chosen: RoleChoices = {};
  for (const role of options.only ?? ROLES) {
    const label = capitalize(role);
    let picked: RoleChoice | undefined;
    let query = await host.input(`${label}: filter models (words like "sol" or "qwen flash"; empty lists all)`, "filter");
    while (picked === undefined) {
      if (query === undefined) return undefined;
      const matches = filterModels(models, query);
      if (matches.length === 0) {
        host.notify(`No model matches "${query}". Try fewer or different words.`, "warning");
        query = await host.input(`${label}: filter models`, "filter");
        continue;
      }
      const shown = matches.slice(0, MAX_LISTED);
      const byLabel = new Map(shown.map((model) => [describeModel(model), model] as const));
      const keep = current[role];
      const keepLabel = keep && keep !== "same" ? `keep current: ${keep.provider}/${keep.model}` : keep === "same" ? "keep current: same as builder" : undefined;
      const moreLabel = matches.length > shown.length ? `… ${matches.length - shown.length} more: narrow the filter` : undefined;
      const sameLabel = role === "reviewer" ? "same as builder" : undefined;
      const answer = await host.select(`${label}: choose a model`, [...(keepLabel ? [keepLabel] : []), ...(sameLabel ? [sameLabel] : []), ...byLabel.keys(), ...(moreLabel ? [moreLabel] : [])]);
      if (answer === undefined) return undefined;
      if (answer === moreLabel) {
        query = await host.input(`${label}: filter models (narrower)`, "filter");
        continue;
      }
      if (answer === keepLabel && keep) picked = keep;
      else if (answer === sameLabel) picked = "same";
      else {
        const model = byLabel.get(answer);
        if (!model) return undefined;
        const levels = thinkingLevelsFor(model);
        let thinking: string | undefined;
        if (levels.length > 1) {
          const level = await host.select(`${label}: thinking level for ${model.id}`, ["default (let pi decide)", ...levels]);
          if (level === undefined) return undefined;
          if (!level.startsWith("default")) thinking = level;
        }
        picked = { provider: model.provider, model: model.id, ...(thinking ? { thinking } : {}) };
      }
    }
    chosen[role] = picked;
  }
  return chosen;
}

function choicesFromFile(file: Raw): RoleChoices {
  const out: RoleChoices = {};
  for (const role of ROLES) {
    const value = file.roles?.[role];
    if (value?.same_as === "builder") out[role] = "same";
    else if (typeof value?.provider === "string" && typeof value?.model === "string") out[role] = { provider: value.provider, model: value.model, ...(typeof value.thinking === "string" ? { thinking: value.thinking } : {}) };
  }
  return out;
}

const describeChoice = (choice: RoleChoice | undefined): string =>
  choice === undefined ? "(not set)" : choice === "same" ? "same as builder" : `${choice.provider}/${choice.model}${choice.thinking ? ` · thinking ${choice.thinking}` : ""}`;

export interface ModelsDeps {
  /** Models this host's pi can use (it only lists models with working credentials). */
  models: ModelInfo[];
  writePath(project: boolean): string;
  /** The current config at that path ({} when there is none); throws if it is not valid JSON. */
  current(project: boolean): Promise<Raw>;
}

/** `/foreman models`: pick the role models on this host and save them to foreman.json. */
export async function modelsCommand(args: string, host: ModelsHost, deps: ModelsDeps): Promise<void> {
  let parsed: ReturnType<typeof parseModelsArgs>;
  try {
    parsed = parseModelsArgs(args);
  } catch (error) {
    host.notify(error instanceof Error ? error.message : String(error), "warning");
    return;
  }
  const path = deps.writePath(parsed.project);
  let file: Raw;
  try {
    file = await deps.current(parsed.project);
  } catch (error) {
    host.notify(`${path} is not valid JSON (${error instanceof Error ? error.message : String(error)}); left untouched. Fix or delete it first.`, "error");
    return;
  }
  const existing = choicesFromFile(file);

  let changes = parsed.specs;
  if (Object.keys(changes).length === 0) {
    if (!host.select || !host.input) {
      host.notify(`Current roles in ${path}:\n${ROLES.map((role) => `  ${role.padEnd(9)} ${describeChoice(existing[role])}`).join("\n")}\nTo change them without a menu: /foreman models architect=provider/model[:thinking] builder=provider/model reviewer=same|provider/model [--project]. The menu needs an interactive pi.`);
      return;
    }
    const picked = await chooseRoles(host, deps.models, existing);
    if (!picked) {
      host.notify("Cancelled; nothing changed.");
      return;
    }
    changes = picked;
  }

  const merged: RoleChoices = { ...existing, ...changes };
  const errors = checkRoles(merged, deps.models, ROLES.filter((role) => changes[role] !== undefined));
  if (errors.length) {
    host.notify(`Nothing was saved:\n${errors.map((error) => `  - ${error}`).join("\n")}`, "warning");
    return;
  }

  const next = applyRoles(file, changes);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporary, path);
  host.notify(`Saved ${path}\n${ROLES.map((role) => `  ${role.padEnd(9)} ${describeChoice(merged[role])}`).join("\n")}\nApplies to the next /foreman plan or run.`);
}
