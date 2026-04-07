import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Auto-Router Extension per pi
 *
 * Analizza il prompt e switcha automaticamente al modello migliore.
 * Supporta fallback multi-provider per Claude (anthropic → github-copilot → google-antigravity → openrouter).
 *
 * Comandi:
 *   /route          → mostra stato e route corrente
 *   /route toggle   → attiva/disattiva routing automatico
 *   /route <nome>   → forza una route specifica
 *   /route list     → elenca tutte le route disponibili
 */

// === CONFIGURAZIONE ROUTE ===

interface RouteConfig {
  label: string;
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  // Lista di [provider, modelId] in ordine di preferenza (fallback)
  candidates: [string, string][];
}

const ROUTES: Record<string, RouteConfig> = {
  // 🔴 TIER PREMIUM
  surgical: {
    label: "🔴 Opus 4.6 — chirurgia",
    thinking: "high",
    candidates: [
      ["anthropic", "claude-opus-4-6"],
      ["github-copilot", "claude-opus-4.6"],
      ["google-antigravity", "claude-opus-4-6-thinking"],
      ["openrouter", "anthropic/claude-opus-4.6"],
    ],
  },
  general: {
    label: "🔴 GPT-5.4 — generalista",
    thinking: "medium",
    candidates: [
      ["openai-codex", "gpt-5.4"],
      ["github-copilot", "gpt-5.4"],
      ["openrouter", "openai/gpt-5.4"],
    ],
  },

  // 🟡 TIER MID
  daily: {
    label: "🟡 Sonnet 4.6 — quotidiano",
    thinking: "medium",
    candidates: [
      ["anthropic", "claude-sonnet-4-6"],
      ["github-copilot", "claude-sonnet-4.6"],
      ["google-antigravity", "claude-sonnet-4-6"],
      ["openrouter", "anthropic/claude-sonnet-4.6"],
    ],
  },
  polyglot: {
    label: "🟡 Gemini 3.1 Pro — polyglot",
    thinking: "medium",
    candidates: [
      ["google-antigravity", "gemini-3.1-pro-high"],
      ["openrouter", "google/gemini-3.1-pro-preview"],
      ["github-copilot", "gemini-3.1-pro-preview"],
    ],
  },

  // 🟢 TIER VELOCITÀ
  terminal: {
    label: "🟢 GPT-5.3-Codex — terminale",
    thinking: "off",
    candidates: [
      ["openai-codex", "gpt-5.3-codex"],
      ["github-copilot", "gpt-5.3-codex"],
      ["openrouter", "openai/gpt-5.3-codex"],
    ],
  },
  speed: {
    label: "🟢 Grok 4.1 — velocità",
    thinking: "off",
    candidates: [
      ["openrouter", "x-ai/grok-4.1-fast"],
    ],
  },

  // 🔵 TIER ALTERNATIVO
  budget: {
    label: "🔵 DeepSeek V3.2 — budget",
    thinking: "medium",
    candidates: [
      ["openrouter", "deepseek/deepseek-v3.2"],
    ],
  },
  explore: {
    label: "🔵 Kimi K2.5 — esplorazione",
    thinking: "medium",
    candidates: [
      ["opencode-go", "kimi-k2.5"],
      ["openrouter", "moonshotai/kimi-k2.5"],
    ],
  },
  glm: {
    label: "🔵 GLM-5 — long-horizon",
    thinking: "medium",
    candidates: [
      ["opencode-go", "glm-5"],
    ],
  },
};

// === CLASSIFICATORE ===

function classifyTask(prompt: string): keyof typeof ROUTES {
  const p = prompt.toLowerCase();

  // 🔴 Chirurgia: refactor architetturale, debug complesso, security
  if (
    /refactor|architect|redesign|migration|legacy|ristruttur/.test(p) ||
    /race condition|deadlock|memory leak|security audit|vulnerability/.test(p) ||
    /multi.?file|cross.?module|breaking change|dipendenz/.test(p) ||
    /review.*(critic|securit|architettur)|analiz.*codice.*compless/.test(p)
  ) {
    return "surgical";
  }

  // 🟢 Terminale: shell, CI/CD, scripting, DevOps
  if (
    /\b(bash|shell|terminal|chmod|chown|grep|sed|awk|curl|wget)\b/.test(p) ||
    /\b(docker|compose|kubernetes|k8s|helm|ci\/cd|pipeline|github.?action)\b/.test(p) ||
    /\b(deploy|nginx|apache|systemctl|systemd|cron|ssh|scp)\b/.test(p) ||
    /\b(makefile|cmake|cargo\s+build|npm\s+run|yarn|pnpm)\b/.test(p) ||
    /\b(git\s+(rebase|bisect|cherry|stash|merge|conflict))\b/.test(p)
  ) {
    return "terminal";
  }

  // 🟢 Velocità: boilerplate, scaffold, task semplici
  if (
    /\b(boilerplate|scaffold|genera|template|stub|placeholder)\b/.test(p) ||
    /\b(semplice|simple|quick|fast|veloce|rapido|banale)\b/.test(p) ||
    /\b(crea.*componente|genera.*file|init|starter)\b/.test(p)
  ) {
    return "speed";
  }

  // 🟡 Polyglot: multi-linguaggio, conversioni, tool coordination
  if (
    /python.*typescript|rust.*go|java.*kotlin|swift.*objc/i.test(p) ||
    /\b(multiple.*languages?|multi.?lang|polyglot)\b/.test(p) ||
    /\b(converti|convert|translate|transpile|port).*\b(da|from|to)\b/.test(p) ||
    /\b(mcp|tool.?coordination|multi.?tool)\b/.test(p)
  ) {
    return "polyglot";
  }

  // 🔴 Generalista: computer use, agenti, reasoning pesante
  if (
    /\b(computer.?use|gui|desktop|automat|browser|playwright|selenium)\b/.test(p) ||
    /\b(agent|workflow|multi.?step|orchestr|pipeline.*complesso)\b/.test(p) ||
    /\b(ragiona|reason|analiz.*profond|spiega.*perch[eé])\b/.test(p)
  ) {
    return "general";
  }

  // 🔵 Budget: documentazione, test, formattazione
  if (
    /\b(docstring|jsdoc|comment|readme|documentation|documenta)\b/.test(p) ||
    /\b(unit\s*test|test\s*case|spec|jest|vitest|pytest|coverage)\b/.test(p) ||
    /\b(format|lint|prettier|eslint|rubocop|black)\b/.test(p) ||
    /\b(traduc|i18n|localiz)\b/.test(p)
  ) {
    return "budget";
  }

  // 🟡 Default: coding quotidiano → Sonnet 4.6
  return "daily";
}

// === EXTENSION ===

export default function (pi: ExtensionAPI) {
  let autoRouting = true;
  let lastRoute = "";

  // Trova il primo modello disponibile tra i candidati
  async function applyRoute(
    routeName: string,
    config: RouteConfig,
    ctx: { modelRegistry: any; ui: any }
  ): Promise<boolean> {
    for (const [provider, modelId] of config.candidates) {
      const model = ctx.modelRegistry.find(provider, modelId);
      if (model) {
        const success = await pi.setModel(model);
        if (success) {
          pi.setThinkingLevel(config.thinking);
          if (routeName !== lastRoute) {
            ctx.ui.setStatus("router", config.label);
            lastRoute = routeName;
          }
          return true;
        }
      }
    }
    ctx.ui.notify(`⚠️ Nessun provider disponibile per route: ${routeName}`, "warning");
    return false;
  }

  // === COMANDO /route ===
  pi.registerCommand("route", {
    description: "Gestisci auto-routing: toggle, list, o forza una route",
    handler: async (args, ctx) => {
      const arg = (args || "").trim();

      if (!arg) {
        // /route → mostra stato
        ctx.ui.notify(
          `🔀 Auto-routing: ${autoRouting ? "ON" : "OFF"}\n` +
            `📍 Route corrente: ${lastRoute || "(nessuna)"}\n` +
            `💡 /route list | /route toggle | /route <nome>`,
          "info"
        );
        return;
      }

      if (arg === "toggle") {
        autoRouting = !autoRouting;
        ctx.ui.notify(
          autoRouting
            ? "🔀 Auto-routing ON — il modello cambia in base al prompt"
            : "⏸️ Auto-routing OFF — usa Ctrl+P per cambiare modello",
          "info"
        );
        return;
      }

      if (arg === "list") {
        const lines = Object.entries(ROUTES)
          .map(([name, cfg]) => {
            const providers = cfg.candidates.map((c) => c[0]).join(" → ");
            return `  ${name.padEnd(12)} ${cfg.label}  [${providers}]`;
          })
          .join("\n");
        ctx.ui.notify(`📋 Route disponibili:\n${lines}`, "info");
        return;
      }

      // /route <nome> → forza route specifica
      const config = ROUTES[arg];
      if (config) {
        autoRouting = false; // disabilita auto quando si forza
        const ok = await applyRoute(arg, config, ctx);
        if (ok) {
          ctx.ui.notify(`⚡ Forzato: ${config.label} (auto-routing OFF)`, "info");
        }
      } else {
        ctx.ui.notify(
          `❌ Route "${arg}" sconosciuta.\n` +
            `Disponibili: ${Object.keys(ROUTES).join(", ")}\n` +
            `Usa /route list per dettagli.`,
          "warning"
        );
      }
    },
  });

  // === ROUTING AUTOMATICO ===
  pi.on("input", async (event, ctx) => {
    if (!autoRouting) return { action: "continue" as const };
    if (event.source !== "interactive") return { action: "continue" as const };

    // Non routare comandi
    if (event.text.startsWith("/")) return { action: "continue" as const };

    const routeName = classifyTask(event.text);
    const config = ROUTES[routeName];
    await applyRoute(routeName, config, ctx);

    return { action: "continue" as const };
  });

  // === STARTUP ===
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify(
      "🔀 Auto-router attivo — /route list per le route, /route toggle per on/off",
      "info"
    );
    ctx.ui.setStatus("router", "🔀 auto");
  });
}
