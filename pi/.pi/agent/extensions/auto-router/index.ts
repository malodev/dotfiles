/**
 * index.ts — Auto-Router extension for pi.dev
 *
 * Automatically selects the best model/thinking-level based on prompt content.
 * Route metadata and model profiles are loaded from auto-router.json.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type {
  AutoRouterConfig,
  Candidate,
  CandidateSpec,
  EscalationConfig,
  RouteConfig,
  RouteDefinition,
  RouterProfileConfig,
  ThinkingLevel,
  TierRuleConfig,
} from "./routes.schema";

type RouterMode = "off" | "local";

interface RouterState {
  mode: RouterMode;
  profileName: string;
  pinnedRoute: string | null;
  lastAutoRoute: string | null;
  hysteresisCount: number;
  failureRoute: string | null;
  failureCount: number;
  escalatedRoute: string | null;
  escalatedTier: string | null;
}

const HYSTERESIS_TURNS = 2;
const STATE_ENTRY_TYPE = "auto-router-state";
const CONFIG_FILE = "auto-router.json";
const MAX_CANDIDATES_PER_TIER = 2;
const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off", "minimal", "low", "medium", "high", "xhigh",
]);

function emptyConfig(): AutoRouterConfig {
  return {
    defaultProfile: "",
    tierLadder: [],
    escalation: { failureThreshold: 2, failureKeywords: [] },
    routes: {},
    profiles: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertConfig(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function normalizeMode(value: unknown): RouterMode {
  return value === "local" ? "local" : "off";
}

function parseCandidate(path: string, value: unknown): Candidate {
  if (typeof value === "string") {
    const slash = value.indexOf("/");
    assertConfig(slash > 0 && slash < value.length - 1, `${path} must be "provider/modelId"`);
    return [value.slice(0, slash), value.slice(slash + 1)];
  }

  assertConfig(
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string",
    `${path} must be "provider/modelId" or [provider, modelId]`
  );
  return [value[0], value[1]];
}

function validateCandidateList(path: string, value: unknown): CandidateSpec[] {
  assertConfig(Array.isArray(value), `${path} must be an array`);
  assertConfig(value.length > 0, `${path} must not be empty`);
  assertConfig(value.length <= MAX_CANDIDATES_PER_TIER, `${path} has ${value.length} candidates; keep at most ${MAX_CANDIDATES_PER_TIER}`);
  value.forEach((candidate, index) => parseCandidate(`${path}[${index}]`, candidate));
  return value as CandidateSpec[];
}

function validateRouteDefinition(path: string, value: unknown): RouteDefinition {
  assertConfig(isRecord(value), `${path} must be an object`);
  assertConfig(typeof value.thinking === "string", `${path}.thinking must be a string`);
  assertConfig(THINKING_LEVELS.has(value.thinking as ThinkingLevel), `${path}.thinking is invalid`);
  assertConfig(typeof value.label === "string" && value.label.length > 0, `${path}.label must be a non-empty string`);

  let keywords: [string, number][] | undefined;
  if (value.keywords !== undefined) {
    assertConfig(Array.isArray(value.keywords), `${path}.keywords must be an array`);
    keywords = value.keywords.map((keyword, index) => {
      assertConfig(
        Array.isArray(keyword) &&
        keyword.length === 2 &&
        typeof keyword[0] === "string" &&
        typeof keyword[1] === "number",
        `${path}.keywords[${index}] must be [keyword, weight]`
      );
      return [keyword[0], keyword[1]];
    });
  }

  const rawManualOnly = value.manualOnly;
  assertConfig(rawManualOnly === undefined || typeof rawManualOnly === "boolean", `${path}.manualOnly must be a boolean`);
  const manualOnly = rawManualOnly as boolean | undefined;

  const rawMinPromptLength = value.minPromptLength;
  assertConfig(rawMinPromptLength === undefined || typeof rawMinPromptLength === "number", `${path}.minPromptLength must be a number`);
  const minPromptLength = rawMinPromptLength as number | undefined;

  return {
    thinking: value.thinking as ThinkingLevel,
    label: value.label,
    ...(manualOnly !== undefined ? { manualOnly } : {}),
    ...(keywords !== undefined ? { keywords } : {}),
    ...(minPromptLength !== undefined ? { minPromptLength } : {}),
  };
}

function validateTierRules(raw: unknown, routes: Record<string, RouteDefinition>): TierRuleConfig[] {
  if (raw === undefined) return [];
  assertConfig(Array.isArray(raw), `${CONFIG_FILE}.tierRules must be an array`);
  return raw.map((rule, index) => {
    const path = `tierRules[${index}]`;
    assertConfig(isRecord(rule), `${path} must be an object`);
    assertConfig(Array.isArray(rule.keywords), `${path}.keywords must be an array`);
    const keywords = rule.keywords.map((kw, kwIndex) => {
      assertConfig(typeof kw === "string" && kw.length > 0, `${path}.keywords[${kwIndex}] must be a non-empty string`);
      return kw;
    });
    assertConfig(typeof rule.tier === "string" && rule.tier.length > 0, `${path}.tier must be a non-empty string`);

    let routeList: string[] | undefined;
    if (rule.routes !== undefined) {
      assertConfig(Array.isArray(rule.routes), `${path}.routes must be an array`);
      routeList = rule.routes.map((routeName, routeIndex) => {
        assertConfig(typeof routeName === "string" && routeName.length > 0, `${path}.routes[${routeIndex}] must be a non-empty string`);
        assertConfig(routeName === "*" || routeName in routes, `${path}.routes[${routeIndex}] references unknown route "${routeName}"`);
        return routeName;
      });
    }

    return { ...(routeList ? { routes: routeList } : {}), keywords, tier: rule.tier };
  });
}

function validateEscalation(raw: unknown, profileNames: string[]): EscalationConfig {
  assertConfig(isRecord(raw), `${CONFIG_FILE}.escalation must be an object`);
  assertConfig(typeof raw.failureThreshold === "number" && raw.failureThreshold >= 1, `escalation.failureThreshold must be a positive number`);
  assertConfig(Array.isArray(raw.failureKeywords), `escalation.failureKeywords must be an array`);
  const failureKeywords = raw.failureKeywords.map((keyword, index) => {
    assertConfig(typeof keyword === "string" && keyword.length > 0, `escalation.failureKeywords[${index}] must be a non-empty string`);
    return keyword;
  });

  let profileEscalationHints: Record<string, string> | undefined;
  if (raw.profileEscalationHints !== undefined) {
    assertConfig(isRecord(raw.profileEscalationHints), `escalation.profileEscalationHints must be an object`);
    profileEscalationHints = {};
    for (const [from, to] of Object.entries(raw.profileEscalationHints)) {
      assertConfig(profileNames.includes(from), `profileEscalationHints.${from} references unknown source profile`);
      assertConfig(typeof to === "string" && profileNames.includes(to), `profileEscalationHints.${from} references unknown target profile`);
      profileEscalationHints[from] = to;
    }
  }

  return {
    failureThreshold: raw.failureThreshold,
    failureKeywords,
    ...(profileEscalationHints ? { profileEscalationHints } : {}),
  };
}

function validateConfig(raw: unknown): AutoRouterConfig {
  assertConfig(isRecord(raw), `${CONFIG_FILE} must contain a JSON object`);
  assertConfig(isRecord(raw.routes), `${CONFIG_FILE}.routes must be an object`);
  assertConfig(isRecord(raw.profiles), `${CONFIG_FILE}.profiles must be an object`);
  assertConfig(Array.isArray(raw.tierLadder), `${CONFIG_FILE}.tierLadder must be an array`);

  const tierLadder = raw.tierLadder.map((tier, index) => {
    assertConfig(typeof tier === "string" && tier.length > 0, `tierLadder[${index}] must be a non-empty string`);
    return tier;
  });
  assertConfig(tierLadder.length > 0, `${CONFIG_FILE}.tierLadder must not be empty`);

  const routes: Record<string, RouteDefinition> = {};
  for (const [routeName, routeValue] of Object.entries(raw.routes)) {
    routes[routeName] = validateRouteDefinition(`routes.${routeName}`, routeValue);
  }
  assertConfig(Object.keys(routes).length > 0, `${CONFIG_FILE}.routes must define at least one route`);

  const profiles: Record<string, RouterProfileConfig> = {};
  for (const [profileName, profileValue] of Object.entries(raw.profiles)) {
    assertConfig(isRecord(profileValue), `profiles.${profileName} must be an object`);
    assertConfig(isRecord(profileValue.modelTiers), `profiles.${profileName}.modelTiers must be an object`);
    assertConfig(isRecord(profileValue.routeAssignment), `profiles.${profileName}.routeAssignment must be an object`);

    const modelTiers: Record<string, CandidateSpec[]> = {};
    for (const [tierName, specs] of Object.entries(profileValue.modelTiers)) {
      modelTiers[tierName] = validateCandidateList(`profiles.${profileName}.modelTiers.${tierName}`, specs);
    }
    assertConfig(Object.keys(modelTiers).length > 0, `profiles.${profileName}.modelTiers must define at least one tier`);

    const routeAssignment: Record<string, string> = {};
    for (const [routeName, tierName] of Object.entries(profileValue.routeAssignment)) {
      assertConfig(routeName === "*" || routeName in routes, `profiles.${profileName}.routeAssignment.${routeName} has no matching route`);
      assertConfig(typeof tierName === "string", `profiles.${profileName}.routeAssignment.${routeName} must be a tier name`);
      assertConfig(tierName in modelTiers, `profiles.${profileName}.routeAssignment.${routeName} references unknown tier "${tierName}"`);
      routeAssignment[routeName] = tierName;
    }

    for (const routeName of Object.keys(routes)) {
      assertConfig(
        routeName in routeAssignment || "*" in routeAssignment,
        `profiles.${profileName}.routeAssignment is missing route "${routeName}" and has no "*" fallback`
      );
    }

    if (!("*" in routeAssignment)) {
      const tierNames = Object.keys(modelTiers);
      for (const tierName of tierLadder) {
        assertConfig(tierName in modelTiers, `profiles.${profileName}.modelTiers is missing required tier "${tierName}"`);
      }
      for (const tierName of tierNames) {
        assertConfig(tierLadder.includes(tierName), `profiles.${profileName}.modelTiers has non-standard tier "${tierName}"`);
      }
    }
    profiles[profileName] = { modelTiers, routeAssignment };
  }

  const profileNames = Object.keys(profiles);
  assertConfig(profileNames.length > 0, `${CONFIG_FILE}.profiles must define at least one profile`);

  const defaultProfile = typeof raw.defaultProfile === "string" && raw.defaultProfile.length > 0
    ? raw.defaultProfile
    : profileNames[0];
  assertConfig(defaultProfile in profiles, `${CONFIG_FILE}.defaultProfile "${defaultProfile}" is not defined in profiles`);

  const tierRules = validateTierRules(raw.tierRules, routes);
  for (const [profileName, profile] of Object.entries(profiles)) {
    for (const tier of tierRules.map((rule) => rule.tier)) {
      if (tier in profile.modelTiers) continue;
      assertConfig("*" in profile.routeAssignment, `tierRules references tier "${tier}" missing from profile "${profileName}"`);
    }
  }

  return {
    defaultProfile,
    tierLadder,
    escalation: validateEscalation(raw.escalation, profileNames),
    routes,
    ...(tierRules.length ? { tierRules } : {}),
    profiles,
  };
}

async function findConfigPath(cwd: string): Promise<string | undefined> {
  const direct = resolve(cwd, ".pi", CONFIG_FILE);
  if (existsSync(direct)) return direct;

  const ignored = new Set([".git", "node_modules", ".task-forge", ".pi"]);

  async function searchSubdirs(dir: string, depth: number): Promise<string | undefined> {
    if (depth < 0) return undefined;

    let entries: any[] = [];
    try {
      entries = await readdir(dir, { withFileTypes: true } as any);
    } catch {
      return undefined;
    }

    const piCandidate = resolve(dir, ".pi", CONFIG_FILE);
    if (existsSync(piCandidate)) return piCandidate;
    if (depth === 0) return undefined;

    for (const entry of entries) {
      if (!entry.isDirectory?.()) continue;
      if (ignored.has(entry.name)) continue;
      const found = await searchSubdirs(resolve(dir, entry.name), depth - 1);
      if (found) return found;
    }

    return undefined;
  }

  const subtree = await searchSubdirs(cwd, 4);
  if (subtree) return subtree;

  const globalExtensionConfig = resolve(
    process.env.HOME || "/Users/mauro",
    ".pi", "agent", "extensions", "auto-router", CONFIG_FILE
  );
  if (existsSync(globalExtensionConfig)) return globalExtensionConfig;

  return undefined;
}

async function loadConfig(cwd: string): Promise<{ config: AutoRouterConfig; path: string }> {
  const path = await findConfigPath(cwd);
  if (!path) {
    throw new Error(`No ${CONFIG_FILE} found — create .pi/${CONFIG_FILE} in the project or ${CONFIG_FILE} in the extension directory`);
  }

  try {
    const raw = JSON.parse(await readFile(path, "utf-8"));
    return { config: validateConfig(raw), path };
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse ${path}: ${err.message}`);
    }
    throw new Error(`Invalid ${path}: ${err instanceof Error ? err.message : err}`);
  }
}

function promptHasAny(prompt: string, keywords: string[]): boolean {
  const lower = prompt.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function baseTierForRoute(profile: RouterProfileConfig, routeName: string): string | null {
  return profile.routeAssignment[routeName] ?? profile.routeAssignment["*"] ?? null;
}

function ruleTierForRoute(config: AutoRouterConfig, profile: RouterProfileConfig, routeName: string, prompt: string): string | null {
  for (const rule of config.tierRules ?? []) {
    const routeMatch = !rule.routes || rule.routes.includes("*") || rule.routes.includes(routeName);
    if (!routeMatch) continue;
    if (!(rule.tier in profile.modelTiers)) continue;
    if (promptHasAny(prompt, rule.keywords)) return rule.tier;
  }
  return null;
}

function nextTier(config: AutoRouterConfig, profile: RouterProfileConfig, currentTier: string): string {
  const ladder = config.tierLadder.filter((tier) => tier in profile.modelTiers);
  const currentIndex = ladder.indexOf(currentTier);
  if (currentIndex === -1) return currentTier;
  return ladder[Math.min(currentIndex + 1, ladder.length - 1)] ?? currentTier;
}

function tierCandidates(profile: RouterProfileConfig, tierName: string): Candidate[] {
  const specs = profile.modelTiers[tierName];
  if (!specs) return [];
  return specs.map((spec, index) => parseCandidate(`profiles.*.modelTiers.${tierName}[${index}]`, spec));
}

function buildRoutes(config: AutoRouterConfig, profileName: string, prompt = ""): Record<string, RouteConfig> {
  const profile = config.profiles[profileName] ?? config.profiles[config.defaultProfile];
  if (!profile) return {};

  const routes: Record<string, RouteConfig> = {};
  for (const [routeName, route] of Object.entries(config.routes)) {
    const tier = ruleTierForRoute(config, profile, routeName, prompt) ?? baseTierForRoute(profile, routeName) ?? "";
    routes[routeName] = {
      ...route,
      tier,
      candidates: tierCandidates(profile, tier),
    };
  }
  return routes;
}

function autoRoutes(routes: Record<string, RouteConfig>): string[] {
  return Object.keys(routes).filter((key) => !routes[key].manualOnly);
}

function classifyPrompt(prompt: string, routes: Record<string, RouteConfig>): string | null {
  const lower = prompt.toLowerCase();
  let bestKey: string | null = null;
  let bestScore = 0;

  for (const key of autoRoutes(routes)) {
    const route = routes[key];
    if (!route?.keywords?.length) continue;

    const minLen = route.minPromptLength ?? 10;
    if (prompt.length < minLen) continue;

    let score = 0;
    for (const [kw, weight] of route.keywords) {
      if (lower.includes(kw)) score += weight;
    }

    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestKey;
}

export default function (pi: ExtensionAPI) {
  let config: AutoRouterConfig = emptyConfig();
  let configPath: string | null = null;
  let configError: string | null = null;

  let state: RouterState = {
    mode: "off",
    profileName: "",
    pinnedRoute: null,
    lastAutoRoute: null,
    hysteresisCount: 0,
    failureRoute: null,
    failureCount: 0,
    escalatedRoute: null,
    escalatedTier: null,
  };

  function profileNames(): string[] {
    return Object.keys(config.profiles);
  }

  function activeProfile(): RouterProfileConfig | undefined {
    return config.profiles[state.profileName] ?? config.profiles[config.defaultProfile];
  }

  function activeRoutes(prompt = ""): Record<string, RouteConfig> {
    return buildRoutes(config, state.profileName, prompt);
  }

  function persistState() {
    const {
      hysteresisCount: _droppedHysteresis,
      failureRoute: _droppedFailureRoute,
      failureCount: _droppedFailureCount,
      escalatedRoute: _droppedEscalatedRoute,
      escalatedTier: _droppedEscalatedTier,
      ...persistable
    } = state;
    pi.appendEntry(STATE_ENTRY_TYPE, persistable);
  }

  function resetSessionRoutingMemory() {
    state.hysteresisCount = 0;
    state.failureRoute = null;
    state.failureCount = 0;
    state.escalatedRoute = null;
    state.escalatedTier = null;
  }

  function validateRoutesForProfile(): { releasedPin: boolean; releasedLastAuto: boolean } {
    const routes = activeRoutes();
    let releasedPin = false;
    let releasedLastAuto = false;

    if (state.pinnedRoute && !(state.pinnedRoute in routes)) {
      state.pinnedRoute = null;
      releasedPin = true;
    }
    if (state.lastAutoRoute && !(state.lastAutoRoute in routes)) {
      state.lastAutoRoute = null;
      releasedLastAuto = true;
    }

    return { releasedPin, releasedLastAuto };
  }

  async function reloadConfig(ctx: any): Promise<boolean> {
    try {
      const loaded = await loadConfig(ctx.cwd ?? process.cwd());
      config = loaded.config;
      configPath = loaded.path;
      configError = null;

      if (!state.profileName || !(state.profileName in config.profiles)) {
        state.profileName = config.defaultProfile;
      }
      validateRoutesForProfile();
      return true;
    } catch (err) {
      config = emptyConfig();
      configPath = null;
      configError = err instanceof Error ? err.message : String(err);
      ctx.ui.setStatus("auto-router", "router:config-error");
      ctx.ui.notify(`[auto-router] ${configError}`, "error");
      return false;
    }
  }

  function activeRouteKey(): string | null {
    if (state.pinnedRoute) return state.pinnedRoute;
    return state.lastAutoRoute;
  }

  function statusLabel(prompt = ""): string {
    if (configError) return "router:config-error";
    const prefix = state.profileName === config.defaultProfile ? "" : `[${state.profileName}] `;
    if (state.mode === "off") return `${prefix}router:off`;
    const routes = activeRoutes(prompt);
    if (state.pinnedRoute && state.pinnedRoute in routes)
      return `${prefix}router:📌${routes[state.pinnedRoute].label}`;
    if (state.lastAutoRoute && state.lastAutoRoute in routes)
      return `${prefix}router:🤖${routes[state.lastAutoRoute].label}`;
    return `${prefix}router:local`;
  }

  function applyFailureEscalation(routeName: string, tier: string, prompt: string, ctx: any): string {
    const profile = activeProfile();
    if (!profile) return tier;

    if (state.escalatedRoute && state.escalatedRoute !== routeName) {
      state.escalatedRoute = null;
      state.escalatedTier = null;
      state.failureRoute = null;
      state.failureCount = 0;
    }

    const hasFailureLanguage = promptHasAny(prompt, config.escalation.failureKeywords);
    if (!hasFailureLanguage) {
      return state.escalatedRoute === routeName && state.escalatedTier ? state.escalatedTier : tier;
    }

    if (state.failureRoute === routeName) {
      state.failureCount++;
    } else {
      state.failureRoute = routeName;
      state.failureCount = 1;
    }

    if (state.failureCount < config.escalation.failureThreshold) {
      return state.escalatedRoute === routeName && state.escalatedTier ? state.escalatedTier : tier;
    }

    const currentTier = state.escalatedRoute === routeName && state.escalatedTier ? state.escalatedTier : tier;
    const escalatedTier = nextTier(config, profile, currentTier);
    state.escalatedRoute = routeName;
    state.escalatedTier = escalatedTier;

    if (escalatedTier === currentTier) {
      const hint = config.escalation.profileEscalationHints?.[state.profileName];
      if (hint) {
        ctx.ui.notify(
          `[auto-router] max tier "${currentTier}" reached for ${routeName}; consider /route profile ${hint}`,
          "warning"
        );
      }
      return currentTier;
    }

    ctx.ui.notify(
      `[auto-router] repeated failure language — escalating ${routeName}: ${currentTier} → ${escalatedTier}`,
      "info"
    );
    return escalatedTier;
  }

  async function applyRoute(
    key: string,
    ctx: Parameters<Parameters<typeof pi.on>[1]>[1],
    prompt = ""
  ): Promise<boolean> {
    const profile = activeProfile();
    if (!profile) return false;

    const route = activeRoutes(prompt)[key];
    if (!route) {
      ctx.ui.notify(
        `[auto-router] Route "${key}" not found in profile "${state.profileName}"`,
        "warning"
      );
      return false;
    }

    const tier = applyFailureEscalation(key, route.tier, prompt, ctx);
    const candidates = tierCandidates(profile, tier);

    for (const [provider, modelId] of candidates) {
      const model = ctx.modelRegistry.find(provider, modelId);
      if (!model) continue;

      const success = await pi.setModel(model);
      if (!success) continue;

      pi.setThinkingLevel(route.thinking);
      ctx.ui.setStatus("auto-router", `${statusLabel(prompt)} [${tier}:${provider}]`);
      return true;
    }

    const tried = candidates.map(([p, m]) => `${p}/${m}`).join(", ");
    ctx.ui.notify(
      `[auto-router] No available provider for route "${key}" tier "${tier}" in profile "${state.profileName}". Tried: ${tried}`,
      "warning"
    );
    return false;
  }

  pi.on("session_start", async (_event, ctx) => {
    type PersistedState = Omit<RouterState, "hysteresisCount" | "failureRoute" | "failureCount" | "escalatedRoute" | "escalatedTier"> & { mode?: unknown };
    let restored: Partial<PersistedState> = {};

    for (const entry of ctx.sessionManager.getEntries()) {
      if (
        entry.type === "custom" &&
        (entry as any).customType === STATE_ENTRY_TYPE &&
        (entry as any).data
      ) {
        restored = (entry as any).data as Partial<PersistedState>;
      }
    }

    state = {
      mode:            normalizeMode(restored.mode),
      profileName:     restored.profileName   ?? "",
      pinnedRoute:     restored.pinnedRoute   ?? null,
      lastAutoRoute:   restored.lastAutoRoute ?? null,
      hysteresisCount: 0,
      failureRoute: null,
      failureCount: 0,
      escalatedRoute: null,
      escalatedTier: null,
    };

    const ok = await reloadConfig(ctx);
    if (!ok) return;
    persistState();

    ctx.ui.setStatus("auto-router", statusLabel());
    ctx.ui.notify(`[auto-router] loaded — profile: ${state.profileName} — config: ${configPath}`, "info");
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    // State persisted on every change; nothing extra needed.
  });

  pi.on("model_select", async (event, ctx) => {
    if (event.source === "set") return;

    if (state.pinnedRoute || state.lastAutoRoute) {
      state.pinnedRoute = null;
      state.lastAutoRoute = null;
      resetSessionRoutingMemory();
      persistState();
      ctx.ui.setStatus("auto-router", statusLabel());
      ctx.ui.notify("[auto-router] model changed externally — routing released", "info");
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (configError) {
      ctx.ui.setStatus("auto-router", "router:config-error");
      return;
    }

    if (state.mode === "off") {
      ctx.ui.setStatus("auto-router", statusLabel(event.prompt));
      return;
    }

    if (state.pinnedRoute) {
      await applyRoute(state.pinnedRoute, ctx, event.prompt);
      return;
    }

    const routes = activeRoutes(event.prompt);
    const candidate = classifyPrompt(event.prompt, routes);

    if (!candidate) {
      ctx.ui.setStatus("auto-router", statusLabel(event.prompt));
      return;
    }

    if (candidate === state.lastAutoRoute) {
      state.hysteresisCount++;
      persistState();
      await applyRoute(candidate, ctx, event.prompt);
      return;
    }

    if (state.lastAutoRoute !== null && state.hysteresisCount < HYSTERESIS_TURNS) {
      const prefix = state.profileName === config.defaultProfile ? "" : `[${state.profileName}] `;
      const blocked = `router:⏳${routes[state.lastAutoRoute]?.label ?? state.lastAutoRoute}→${candidate}`;
      ctx.ui.setStatus("auto-router", `${prefix}${blocked}`);
      return;
    }

    state.lastAutoRoute = candidate;
    state.hysteresisCount = 0;
    persistState();
    ctx.ui.notify(`[auto-router] → ${routes[candidate].label}`, "info");
    await applyRoute(candidate, ctx, event.prompt);
  });

  const SUBCOMMANDS = [
    "on", "off", "pin", "unpin", "now", "profile", "reload", "help",
  ];

  pi.registerCommand("route", {
    description:
      "Control the auto-router (on | off | pin <route> | unpin | now | profile [name] | reload | help)",

    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const trimmed = prefix.trimStart();

      if (trimmed.startsWith("pin")) {
        const partial = trimmed.slice(3).trimStart();
        const items = Object.entries(activeRoutes()).map(([key, route]) => ({
          value: `pin ${key}`,
          label: `${key} — ${route.label}`,
        }));
        const filtered = partial ? items.filter((i) => i.value.slice(4).startsWith(partial)) : items;
        return filtered.length > 0 ? filtered : null;
      }

      if (trimmed.startsWith("profile")) {
        const partial = trimmed.slice(7).trimStart();
        const items = profileNames().map((name) => {
          const profile = config.profiles[name];
          return {
            value: `profile ${name}`,
            label: `${name} (${Object.keys(profile.modelTiers).length} tiers)${name === state.profileName ? " ← current" : ""}`,
          };
        });
        const filtered = partial ? items.filter((i) => i.value.slice(8).startsWith(partial)) : items;
        return filtered.length > 0 ? filtered : null;
      }

      const subItems: AutocompleteItem[] = SUBCOMMANDS
        .filter((s) => s !== "pin" && s !== "profile")
        .map((s) => ({ value: s, label: s }));

      const pinItems: AutocompleteItem[] = Object.entries(activeRoutes()).map(([key, route]) => ({
        value: `pin ${key}`,
        label: `📌 ${key} — ${route.label}`,
      }));

      const profileItems: AutocompleteItem[] = profileNames().map((name) => ({
        value: `profile ${name}`,
        label: `📦 ${name}${name === state.profileName ? " ← current" : ""}`,
      }));

      const all = [...subItems, ...pinItems, ...profileItems];
      const filtered = all.filter((i) => i.value.startsWith(trimmed));
      return filtered.length > 0 ? filtered : null;
    },

    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/);
      const sub = parts[0];

      if (sub === "reload") {
        const ok = await reloadConfig(ctx);
        if (!ok) return;
        validateRoutesForProfile();
        resetSessionRoutingMemory();
        persistState();
        ctx.ui.setStatus("auto-router", statusLabel());
        ctx.ui.notify(`[auto-router] config reloaded from ${configPath}`, "info");
        return;
      }

      if (sub === "on") {
        if (state.mode === "local" && !state.pinnedRoute) {
          ctx.ui.notify("[auto-router] local mode already active", "info");
          return;
        }
        state.mode = "local";
        state.pinnedRoute = null;
        state.lastAutoRoute = null;
        resetSessionRoutingMemory();
        persistState();
        ctx.ui.setStatus("auto-router", statusLabel());
        ctx.ui.notify(`[auto-router] local mode enabled (profile: ${state.profileName})`, "info");
        return;
      }

      if (sub === "off") {
        if (state.mode === "off") {
          ctx.ui.notify("[auto-router] already off", "info");
          return;
        }
        state.mode = "off";
        state.pinnedRoute = null;
        state.lastAutoRoute = null;
        resetSessionRoutingMemory();
        persistState();
        ctx.ui.setStatus("auto-router", statusLabel());
        ctx.ui.notify("[auto-router] disabled", "info");
        return;
      }

      if (sub === "pin") {
        const key = parts[1];
        const routes = activeRoutes();
        if (!key || !(key in routes)) {
          ctx.ui.notify(`[auto-router] unknown route. Available: ${Object.keys(routes).join(", ")}`, "warning");
          return;
        }
        state.pinnedRoute = key;
        resetSessionRoutingMemory();
        persistState();
        const ok = await applyRoute(key, ctx);
        if (ok) ctx.ui.notify(`[auto-router] pinned to ${routes[key].label} (mode: ${state.mode})`, "info");
        return;
      }

      if (sub === "unpin") {
        if (!state.pinnedRoute) {
          ctx.ui.notify("[auto-router] no pin active", "info");
          return;
        }
        state.pinnedRoute = null;
        state.lastAutoRoute = null;
        resetSessionRoutingMemory();
        persistState();
        ctx.ui.setStatus("auto-router", statusLabel());
        ctx.ui.notify(`[auto-router] pin released — back to ${state.mode} mode`, "info");
        return;
      }

      if (sub === "profile") {
        const ok = await reloadConfig(ctx);
        if (!ok) return;
        const name = parts[1];

        if (!name) {
          const lines = profileNames().map((profileName) => {
            const profile = config.profiles[profileName];
            const marker = profileName === state.profileName ? " ← current" : "";
            return `  ${profileName.padEnd(16)} ${Object.keys(profile.modelTiers).length} tiers${marker}`;
          }).join("\n");
          ctx.ui.notify(
            [
              "[auto-router] available profiles:",
              lines,
              "",
              `config: ${configPath}`,
              "",
              "Current routes:",
              ...Object.entries(activeRoutes()).map(([key, route]) => `  ${key.padEnd(12)} ${route.label}`),
            ].join("\n"),
            "info"
          );
          return;
        }

        if (!(name in config.profiles)) {
          ctx.ui.notify(`[auto-router] unknown profile "${name}". Available: ${profileNames().join(", ")}`, "warning");
          return;
        }

        if (name === state.profileName) {
          ctx.ui.notify(`[auto-router] already on profile "${name}"`, "info");
          return;
        }

        state.profileName = name;
        resetSessionRoutingMemory();
        const { releasedPin, releasedLastAuto } = validateRoutesForProfile();
        persistState();

        if (releasedPin) ctx.ui.notify("[auto-router] pin released (route not in new profile)", "info");
        if (releasedLastAuto) ctx.ui.notify("[auto-router] previous auto-route reset (not in new profile)", "info");

        // Try to immediately switch model: pinned route first, then last auto route,
        // then fall back to the "coding" route (most common), then any available route.
        const applyKey = state.pinnedRoute
          ?? state.lastAutoRoute
          ?? ("coding" in activeRoutes() ? "coding" : null)
          ?? Object.keys(activeRoutes()).find((k) => !activeRoutes()[k].manualOnly);
        if (applyKey) {
          const applied = await applyRoute(applyKey, ctx);
          if (applied) {
            state.lastAutoRoute = applyKey;
            persistState();
            const routes = activeRoutes();
            ctx.ui.notify(`[auto-router] switched to profile "${name}" → ${routes[applyKey].label}`, "info");
            return;
          }
        }

        ctx.ui.setStatus("auto-router", statusLabel());
        ctx.ui.notify(`[auto-router] switched to profile "${name}" (no available models in this profile)`, "warning");
        return;
      }

      if (sub === "now") {
        const key = activeRouteKey();
        const routes = activeRoutes();
        const routeInfo = key && key in routes
          ? `${key} → ${routes[key].label} (tier: ${routes[key].tier}, thinking: ${routes[key].thinking})`
          : "none";
        const pinStr = state.pinnedRoute ? `  pin:${state.pinnedRoute}` : "";
        const hystStr = state.mode === "local" && !state.pinnedRoute
          ? `  hysteresis:${state.hysteresisCount}/${HYSTERESIS_TURNS}`
          : "";
        const failStr = state.failureRoute ? `  failures:${state.failureRoute}:${state.failureCount}` : "";
        const escStr = state.escalatedRoute && state.escalatedTier ? `  escalated:${state.escalatedRoute}:${state.escalatedTier}` : "";
        const configStr = configError ? `  config:error:${configError}` : `  config:${configPath}`;
        ctx.ui.notify(
          `[auto-router] profile:${state.profileName} mode:${state.mode}${pinStr}  route:${routeInfo}${hystStr}${failStr}${escStr}${configStr}`,
          "info"
        );
        return;
      }

      const routes = activeRoutes();
      const routeList = Object.keys(routes).map((key) => {
        const route = routes[key];
        const manual = route.manualOnly ? " (manual only)" : "";
        const cands = route.candidates.map(([provider, modelId]) => `${provider}/${modelId}`).join(" → ");
        return `  ${key.padEnd(14)} ${route.label}  tier:${route.tier}  thinking:${route.thinking}  [${cands}]${manual}`;
      }).join("\n");

      const profileList = profileNames().map((name) => {
        const marker = name === state.profileName ? " ← current" : "";
        return `  ${name}${marker}`;
      }).join("\n");

      ctx.ui.notify(
        [
          "[auto-router] commands:",
          "  /route on              Enable local keyword routing",
          "  /route off             Disable routing entirely",
          "  /route pin <key>       Lock to a specific route",
          "  /route unpin           Release pin, return to current mode",
          "  /route now             Show current mode, route, tier, and config path",
          "  /route profile         Reload config and list profiles",
          "  /route profile <name>  Switch profile",
          "  /route reload          Reload auto-router.json",
          "",
          "Modes:",
          "  local   — classifier picks a route per prompt",
          "  off     — no routing, model unchanged",
          "",
          `Config: ${configPath ?? configError ?? "not loaded"}`,
          `Profiles (current: ${state.profileName || "none"}):`,
          profileList || "  none",
          "",
          `Routes in "${state.profileName}":`,
          routeList || "  none",
        ].join("\n"),
        "info"
      );
    },
  });
}
