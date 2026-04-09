/**
 * index.ts — Auto-Router extension for pi.dev
 *
 * Automatically selects the best model/thinking-level based on prompt content.
 * Compliant with the pi.dev Extensions API (extensions.md).
 *
 * Modes:
 *   off     — routing disabled, model unchanged
 *   local   — keyword classifier picks the best route per prompt
 *   orauto  — openrouter/auto is set once; OpenRouter decides the model
 *             for every request (no per-prompt logic runs on our side)
 *
 * Commands:
 *   /route on              Enable local auto-routing (idempotent)
 *   /route off             Disable routing entirely (idempotent)
 *   /route orauto          Switch to orauto mode (openrouter/auto)
 *   /route pin <key>       Lock to a specific route (disables auto-switch)
 *   /route unpin           Release pin, return to previous mode (local/orauto)
 *   /route now             Show current mode and route state
 *   /route help            Show this help
 *
 * State persists across restarts via pi.appendEntry().
 *
 * Providers: google-antigravity, github-copilot, anthropic,
 *            openai-codex, openrouter, opencode-go
 */

import type { AutocompleteItem } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ROUTES, AUTO_ROUTES } from "./routes.config";
import type { RouteKey } from "./routes.config";
import type { RouteConfig } from "./routes.schema";

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * Three distinct operating modes:
 *   "off"    — routing is fully disabled
 *   "local"  — keyword classifier runs on every prompt
 *   "orauto" — openrouter/auto is set once; OpenRouter handles model selection
 */
type RouterMode = "off" | "local" | "orauto";

interface RouterState {
  mode: RouterMode;
  /**
   * When set, auto-switching is suspended and this route is always used.
   * Works in both "local" and "orauto" modes (pin overrides the mode).
   * Unpin returns to the mode that was active before pinning.
   */
  pinnedRoute: RouteKey | null;
  /** Last auto-selected route key, used for hysteresis in "local" mode. */
  lastAutoRoute: RouteKey | null;
  /**
   * Consecutive turns spent on lastAutoRoute.
   * Not persisted — meaningless across sessions.
   */
  hysteresisCount: number;
}

/** Turns to spend on a route before allowing a switch to a different one. */
const HYSTERESIS_TURNS = 2;
const STATE_ENTRY_TYPE = "auto-router-state";

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Weighted keyword classifier for "local" mode.
 * Keywords are [term, weight] pairs. Generic terms have low weight;
 * domain-specific terms have high weight, reducing false-positive ties.
 * Tie-breaking: first route in AUTO_ROUTES (insertion order) wins.
 *
 * Returns the best matching RouteKey, or null if no route scores above 0.
 */
function classifyPrompt(prompt: string): RouteKey | null {
  const lower = prompt.toLowerCase();

  let bestKey: RouteKey | null = null;
  let bestScore = 0;

  for (const key of AUTO_ROUTES) {
    const route = ROUTES[key];
    if (!route.keywords?.length) continue;

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

// ─── Extension entry point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Safe defaults — session_start will overwrite with persisted state.
  let state: RouterState = {
    mode: "off",
    pinnedRoute: null,
    lastAutoRoute: null,
    hysteresisCount: 0,
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function persistState() {
    // hysteresisCount is session-local — do not persist it
    const { hysteresisCount: _dropped, ...persistable } = state;
    pi.appendEntry(STATE_ENTRY_TYPE, persistable);
  }

  function activeRouteKey(): RouteKey | null {
    if (state.pinnedRoute) return state.pinnedRoute;
    return state.lastAutoRoute;
  }

  function statusLabel(): string {
    if (state.mode === "off") return "router:off";
    if (state.pinnedRoute) return `router:📌${ROUTES[state.pinnedRoute].label}`;
    if (state.mode === "orauto") return "router:🌐orauto";
    if (state.lastAutoRoute) return `router:🤖${ROUTES[state.lastAutoRoute].label}`;
    return "router:local";
  }

  /**
   * Try each candidate in order; apply the first available one.
   * Logs the winning provider to the status bar on success.
   */
  async function applyRoute(
    key: RouteKey,
    ctx: Parameters<Parameters<typeof pi.on>[1]>[1]
  ): Promise<boolean> {
    const route: RouteConfig = ROUTES[key];

    for (const [provider, modelId] of route.candidates) {
      const model = ctx.modelRegistry.find(provider, modelId);
      if (!model) continue;

      const success = await pi.setModel(model);
      if (!success) continue;

      pi.setThinkingLevel(route.thinking);
      ctx.ui.setStatus("auto-router", `${statusLabel()} [${provider}]`);
      return true;
    }

    const tried = route.candidates.map(([p, m]) => `${p}/${m}`).join(", ");
    ctx.ui.notify(
      `[auto-router] No available provider for route "${key}". Tried: ${tried}`,
      "warning"
    );
    return false;
  }

  /**
   * Activate orauto mode: set openrouter/auto once and step aside.
   * OpenRouter will pick the model for every subsequent request.
   * Thinking level defaults to "medium"; OpenRouter may ignore it
   * depending on the model it selects.
   */
  async function activateOrauto(
    ctx: Parameters<Parameters<typeof pi.on>[1]>[1]
  ): Promise<boolean> {
    const model = ctx.modelRegistry.find("openrouter", "auto");
    if (!model) {
      ctx.ui.notify(
        "[auto-router] openrouter/auto not found — check OPENROUTER_API_KEY",
        "error"
      );
      return false;
    }
    const ok = await pi.setModel(model);
    if (!ok) {
      ctx.ui.notify("[auto-router] No API key for OpenRouter", "error");
      return false;
    }
    pi.setThinkingLevel("medium");
    return true;
  }

  // ── Session lifecycle ──────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    type PersistedState = Omit<RouterState, "hysteresisCount">;
    let restored: Partial<PersistedState> = {};

    for (const entry of ctx.sessionManager.getEntries()) {
      if (
        entry.type === "custom" &&
        (entry as any).customType === STATE_ENTRY_TYPE &&
        (entry as any).data
      ) {
        // Last matching entry wins (most recent persist)
        restored = (entry as any).data as Partial<PersistedState>;
      }
    }

    state = {
      mode:            restored.mode          ?? "off",
      pinnedRoute:     restored.pinnedRoute   ?? null,
      lastAutoRoute:   restored.lastAutoRoute ?? null,
      hysteresisCount: 0, // always reset — cross-session count is meaningless
    };

    // Re-apply openrouter/auto if we were in orauto mode (and not pinned)
    if (state.mode === "orauto" && !state.pinnedRoute) {
      await activateOrauto(ctx);
    }

    ctx.ui.setStatus("auto-router", statusLabel());
    ctx.ui.notify("[auto-router] loaded — /route help for commands", "info");
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    // State persisted on every change; nothing extra needed.
  });

  // ── Sync state when model changes externally (Ctrl+P, /model) ─────────────

  pi.on("model_select", async (event, ctx) => {
    if (event.source === "set") return; // we triggered this change ourselves

    // External change: release pin and exit orauto if active,
    // so we don't silently fight the user's choice on the next prompt.
    if (state.pinnedRoute || state.mode === "orauto") {
      const prev = state.mode;
      state.pinnedRoute = null;
      state.lastAutoRoute = null;
      state.hysteresisCount = 0;
      if (state.mode === "orauto") state.mode = "local";
      persistState();
      ctx.ui.setStatus("auto-router", statusLabel());
      ctx.ui.notify(
        `[auto-router] ${prev === "orauto" ? "orauto" : "pin"} released (model changed externally)`,
        "info"
      );
    }
  });

  // ── Auto-routing: intercept prompt before agent starts ────────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    // orauto: openrouter/auto already set — OpenRouter handles it, nothing to do
    if (state.mode === "orauto" && !state.pinnedRoute) return;

    // off: routing disabled
    if (state.mode === "off") return;

    // pin: model already applied at pin time, nothing to do per prompt
    if (state.pinnedRoute) return;

    // local: run classifier + hysteresis
    const candidate = classifyPrompt(event.prompt);
    if (!candidate) return;

    // Case A — same route as last turn: increment counter, no switch needed
    if (candidate === state.lastAutoRoute) {
      state.hysteresisCount++;
      persistState();
      return;
    }

    // Case B — different route: enforce minimum dwell time before switching
    if (state.lastAutoRoute !== null && state.hysteresisCount < HYSTERESIS_TURNS) {
      return; // too early to switch
    }

    // Switch to new route
    state.lastAutoRoute = candidate;
    state.hysteresisCount = 0;
    persistState();
    await applyRoute(candidate, ctx);
  });

  // ── /route command ─────────────────────────────────────────────────────────

  const ROUTE_KEYS = Object.keys(ROUTES) as RouteKey[];
  const SUBCOMMANDS = ["on", "off", "orauto", "pin", "unpin", "now", "help"];

  pi.registerCommand("route", {
    description:
      "Control the auto-router (on | off | orauto | pin <route> | unpin | now | help)",

    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const parts = prefix.trimStart().split(/\s+/);

      if (parts.length <= 1) {
        const items = SUBCOMMANDS.map((s) => ({ value: s, label: s }));
        const filtered = items.filter((i) => i.value.startsWith(parts[0] ?? ""));
        return filtered.length > 0 ? filtered : null;
      }

      if (parts[0] === "pin" && parts.length === 2) {
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
        if (state.mode === "local" && !state.pinnedRoute) {
          ctx.ui.notify("[auto-router] local mode already active", "info");
          return;
        }
        state.mode = "local";
        state.pinnedRoute = null;
        state.lastAutoRoute = null;
        state.hysteresisCount = 0;
        persistState();
        ctx.ui.setStatus("auto-router", statusLabel());
        ctx.ui.notify("[auto-router] local mode enabled", "info");
        return;
      }

      // ── /route off ─────────────────────────────────────────────────────────
      if (sub === "off") {
        if (state.mode === "off") {
          ctx.ui.notify("[auto-router] already off", "info");
          return;
        }
        state.mode = "off";
        state.pinnedRoute = null;
        state.lastAutoRoute = null;
        state.hysteresisCount = 0;
        persistState();
        ctx.ui.setStatus("auto-router", "router:off");
        ctx.ui.notify("[auto-router] disabled", "info");
        return;
      }

      // ── /route orauto ──────────────────────────────────────────────────────
      // Sets openrouter/auto as the active model once.
      // From this point OpenRouter decides which model handles each request.
      // No per-prompt classifier logic runs while this mode is active.
      if (sub === "orauto") {
        if (state.mode === "orauto" && !state.pinnedRoute) {
          ctx.ui.notify("[auto-router] orauto mode already active", "info");
          return;
        }
        const ok = await activateOrauto(ctx);
        if (!ok) return;

        state.mode = "orauto";
        state.pinnedRoute = null;
        state.lastAutoRoute = null;
        state.hysteresisCount = 0;
        persistState();
        ctx.ui.setStatus("auto-router", statusLabel());
        ctx.ui.notify(
          "[auto-router] orauto — OpenRouter selects the model for each request",
          "info"
        );
        return;
      }

      // ── /route pin <key> ───────────────────────────────────────────────────
      // Locks to a specific route. Does not change the active mode —
      // unpin returns to whichever mode (local/orauto) was in effect.
      if (sub === "pin") {
        const key = parts[1] as RouteKey | undefined;
        if (!key || !(key in ROUTES)) {
          ctx.ui.notify(
            `[auto-router] unknown route. Available: ${ROUTE_KEYS.join(", ")}`,
            "warning"
          );
          return;
        }
        state.pinnedRoute = key;
        state.hysteresisCount = 0;
        persistState();
        const ok = await applyRoute(key, ctx);
        if (ok) {
          ctx.ui.notify(
            `[auto-router] pinned to ${ROUTES[key].label} (mode: ${state.mode})`,
            "info"
          );
        }
        return;
      }

      // ── /route unpin ───────────────────────────────────────────────────────
      // Releases pin and returns to the current mode (local or orauto).
      if (sub === "unpin") {
        if (!state.pinnedRoute) {
          ctx.ui.notify("[auto-router] no pin active", "info");
          return;
        }
        state.pinnedRoute = null;
        state.lastAutoRoute = null;
        state.hysteresisCount = 0;
        persistState();

        // If returning to orauto, re-apply openrouter/auto
        if (state.mode === "orauto") {
          await activateOrauto(ctx);
        }

        ctx.ui.setStatus("auto-router", statusLabel());
        ctx.ui.notify(
          `[auto-router] pin released — back to ${state.mode} mode`,
          "info"
        );
        return;
      }

      // ── /route now ─────────────────────────────────────────────────────────
      if (sub === "now") {
        const key = activeRouteKey();
        const routeInfo = key
          ? `${key} → ${ROUTES[key].label} (thinking: ${ROUTES[key].thinking})`
          : "none";
        const pinStr = state.pinnedRoute ? `  pin:${state.pinnedRoute}` : "";
        const hystStr =
          state.mode === "local" && !state.pinnedRoute
            ? `  hysteresis:${state.hysteresisCount}/${HYSTERESIS_TURNS}`
            : "";
        ctx.ui.notify(
          `[auto-router] mode:${state.mode}${pinStr}  route:${routeInfo}${hystStr}`,
          "info"
        );
        return;
      }

      // ── /route help (default) ──────────────────────────────────────────────
      const routeList = ROUTE_KEYS.map((k) => {
        const r = ROUTES[k];
        const manual = r.manualOnly ? " (manual only)" : "";
        const cands = r.candidates.map(([p]) => p).join(" → ");
        return `  ${k.padEnd(12)} ${r.label}  thinking:${r.thinking}  [${cands}]${manual}`;
      }).join("\n");

      ctx.ui.notify(
        [
          "[auto-router] commands:",
          "  /route on              Enable local keyword routing",
          "  /route off             Disable routing entirely",
          "  /route orauto          Delegate to OpenRouter (openrouter/auto)",
          "  /route pin <key>       Lock to a specific route",
          "  /route unpin           Release pin, return to current mode",
          "  /route now             Show current mode and route",
          "",
          "Modes:",
          "  local   — classifier picks a route per prompt",
          "  orauto  — openrouter/auto set once; OpenRouter decides",
          "  off     — no routing, model unchanged",
          "",
          "Available routes:",
          routeList,
        ].join("\n"),
        "info"
      );
    },
  });
}
