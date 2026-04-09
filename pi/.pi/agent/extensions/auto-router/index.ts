/**
 * index.ts — Auto-Router extension for pi.dev
 *
 * Automatically selects the best model/thinking-level based on prompt content.
 * Compliant with the pi.dev Extensions API (extensions.md).
 *
 * Commands:
 *   /route on          Enable auto-routing (idempotent)
 *   /route off         Disable auto-routing (idempotent)
 *   /route pin <key>   Lock to a specific route (e.g. /route pin opus)
 *   /route orauto      Release pin, return to auto mode
 *   /route now         Show current route state
 *   /route help        Show this help
 *
 * State persists across restarts via pi.appendEntry().
 */

import type { AutocompleteItem } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ROUTES, AUTO_ROUTES } from "./routes.config";
import type { RouteKey } from "./routes.config";
import type { RouteConfig } from "./routes.schema";

// ─── State ────────────────────────────────────────────────────────────────────

interface RouterState {
  enabled: boolean;
  pinnedRoute: RouteKey | null;
  /** Last auto-selected route key (for hysteresis) */
  lastAutoRoute: RouteKey | null;
  /** Number of consecutive turns on the same route (hysteresis counter) */
  hysteresisCount: number;
}

const HYSTERESIS_TURNS = 2; // turns before allowing a route switch
const STATE_ENTRY_TYPE = "auto-router-state";

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Weighted keyword classifier.
 * Returns the best matching RouteKey, or null if no route scores above 0.
 */
function classifyPrompt(prompt: string): RouteKey | null {
  const lower = prompt.toLowerCase();

  let bestKey: RouteKey | null = null;
  let bestScore = 0;

  for (const key of AUTO_ROUTES) {
    const route = ROUTES[key];
    if (!route.keywords?.length) continue;
    if (route.minPromptLength !== undefined && prompt.length < route.minPromptLength) continue;

    let score = 0;
    for (const kw of route.keywords) {
      if (lower.includes(kw)) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestKey;
}

// ─── Extension entry point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // In-memory state (rebuilt from session on start)
  let state: RouterState = {
    enabled: false,
    pinnedRoute: null,
    lastAutoRoute: null,
    hysteresisCount: 0,
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function persistState() {
    pi.appendEntry(STATE_ENTRY_TYPE, { ...state });
  }

  function activeRouteKey(): RouteKey | null {
    if (state.pinnedRoute) return state.pinnedRoute;
    return state.lastAutoRoute;
  }

  function statusLabel(): string {
    if (!state.enabled) return "router:off";
    if (state.pinnedRoute) return `router:📌${ROUTES[state.pinnedRoute].label}`;
    if (state.lastAutoRoute) return `router:🤖${ROUTES[state.lastAutoRoute].label}`;
    return "router:auto";
  }

  async function applyRoute(key: RouteKey, ctx: Parameters<Parameters<typeof pi.on>[1]>[1]) {
    const route: RouteConfig = ROUTES[key];
    const model = ctx.modelRegistry.find(route.provider, route.modelId);

    if (!model) {
      ctx.ui.notify(
        `[auto-router] Model not found: ${route.provider}/${route.modelId}`,
        "warning"
      );
      return;
    }

    const success = await pi.setModel(model);
    if (!success) {
      ctx.ui.notify(
        `[auto-router] No API key for ${route.label}`,
        "error"
      );
      return;
    }

    pi.setThinkingLevel(route.thinking);
    ctx.ui.setStatus("auto-router", statusLabel());
  }

  // ── Session lifecycle ──────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    // Restore persisted state from session entries
    state = {
      enabled: true,
      pinnedRoute: null,
      lastAutoRoute: null,
      hysteresisCount: 0,
    };

    for (const entry of ctx.sessionManager.getEntries()) {
      if (
        entry.type === "custom" &&
        (entry as any).customType === STATE_ENTRY_TYPE &&
        (entry as any).data
      ) {
        const saved = (entry as any).data as Partial<RouterState>;
        state = {
          enabled: saved.enabled ?? true,
          pinnedRoute: saved.pinnedRoute ?? null,
          lastAutoRoute: saved.lastAutoRoute ?? null,
          hysteresisCount: saved.hysteresisCount ?? 0,
        };
      }
    }

    ctx.ui.setStatus("auto-router", statusLabel());
    ctx.ui.notify("[auto-router] loaded — /route help for commands", "info");
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    // State is already persisted on every change; nothing extra needed.
  });

  // ── Sync state when model changes externally (Ctrl+P, /model) ─────────────

  pi.on("model_select", async (event, ctx) => {
    if (event.source === "set") return; // we triggered this ourselves
    // External change: disable pin so we don't fight the user
    if (state.pinnedRoute) {
      state.pinnedRoute = null;
      state.lastAutoRoute = null;
      persistState();
      ctx.ui.setStatus("auto-router", statusLabel());
      ctx.ui.notify("[auto-router] pin released (model changed externally)", "info");
    }
  });

  // ── Auto-routing: intercept prompt before agent starts ────────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    if (!state.enabled || state.pinnedRoute) return;

    const candidate = classifyPrompt(event.prompt);
    if (!candidate) return;

    // Hysteresis: don't thrash between routes on every turn
    if (
      candidate === state.lastAutoRoute &&
      state.hysteresisCount < HYSTERESIS_TURNS
    ) {
      state.hysteresisCount++;
      persistState();
      return;
    }

    if (candidate !== state.lastAutoRoute) {
      state.lastAutoRoute = candidate;
      state.hysteresisCount = 0;
      persistState();
      await applyRoute(candidate, ctx);
    }
  });

  // ── /route command ─────────────────────────────────────────────────────────

  const ROUTE_KEYS = Object.keys(ROUTES) as RouteKey[];
  const SUBCOMMANDS = ["on", "off", "pin", "orauto", "now", "help"];

  pi.registerCommand("route", {
    description: "Control the auto-router (on | off | pin <route> | orauto | now | help)",

    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const parts = prefix.trimStart().split(/\s+/);

      if (parts.length <= 1) {
        // Complete subcommand
        const items = SUBCOMMANDS.map((s) => ({ value: s, label: s }));
        const filtered = items.filter((i) => i.value.startsWith(parts[0] ?? ""));
        return filtered.length > 0 ? filtered : null;
      }

      if (parts[0] === "pin" && parts.length === 2) {
        // Complete route key after "pin"
        const items = ROUTE_KEYS.map((k) => ({
          value: k,
          label: `${k} — ${ROUTES[k].label}`,
        }));
        const filtered = items.filter((i) => i.value.startsWith(parts[1] ?? ""));
        return filtered.length > 0 ? filtered : null;
      }

      return null;
    },

    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/);
      const sub = parts[0];

      // ── /route on ──────────────────────────────────────────────────────────
      if (sub === "on") {
        if (state.enabled) {
          ctx.ui.notify("[auto-router] already enabled", "info");
          return;
        }
        state.enabled = true;
        persistState();
        ctx.ui.setStatus("auto-router", statusLabel());
        ctx.ui.notify("[auto-router] enabled", "info");
        return;
      }

      // ── /route off ─────────────────────────────────────────────────────────
      if (sub === "off") {
        if (!state.enabled) {
          ctx.ui.notify("[auto-router] already disabled", "info");
          return;
        }
        state.enabled = false;
        state.pinnedRoute = null;
        state.lastAutoRoute = null;
        state.hysteresisCount = 0;
        persistState();
        ctx.ui.setStatus("auto-router", "router:off");
        ctx.ui.notify("[auto-router] disabled", "info");
        return;
      }

      // ── /route pin <key> ───────────────────────────────────────────────────
      if (sub === "pin") {
        const key = parts[1] as RouteKey | undefined;
        if (!key || !(key in ROUTES)) {
          const keys = ROUTE_KEYS.join(", ");
          ctx.ui.notify(`[auto-router] unknown route. Available: ${keys}`, "warning");
          return;
        }
        state.enabled = true;
        state.pinnedRoute = key;
        state.hysteresisCount = 0;
        persistState();
        await applyRoute(key, ctx);
        ctx.ui.notify(`[auto-router] pinned to ${ROUTES[key].label}`, "info");
        return;
      }

      // ── /route orauto ──────────────────────────────────────────────────────
      if (sub === "orauto") {
        state.pinnedRoute = null;
        state.lastAutoRoute = null;
        state.hysteresisCount = 0;
        state.enabled = true;
        persistState();
        ctx.ui.setStatus("auto-router", statusLabel());
        ctx.ui.notify("[auto-router] pin released, back to auto mode", "info");
        return;
      }

      // ── /route now ─────────────────────────────────────────────────────────
      if (sub === "now") {
        const key = activeRouteKey();
        const routeInfo = key
          ? `${key} → ${ROUTES[key].label} (thinking: ${ROUTES[key].thinking})`
          : "none selected yet";
        const modeStr = state.pinnedRoute ? "pinned" : state.enabled ? "auto" : "off";
        ctx.ui.notify(
          `[auto-router] mode=${modeStr}  route=${routeInfo}`,
          "info"
        );
        return;
      }

      // ── /route help (default) ──────────────────────────────────────────────
      const routeList = ROUTE_KEYS.map(
        (k) => `  ${k.padEnd(12)} ${ROUTES[k].label}${ROUTES[k].manualOnly ? " (manual only)" : ""}`
      ).join("\n");

      ctx.ui.notify(
        [
          "[auto-router] commands:",
          "  /route on          Enable auto-routing",
          "  /route off         Disable auto-routing",
          "  /route pin <key>   Lock to a specific route",
          "  /route orauto      Release pin, return to auto",
          "  /route now         Show current state",
          "",
          "Available routes:",
          routeList,
        ].join("\n"),
        "info"
      );
    },
  });
}
