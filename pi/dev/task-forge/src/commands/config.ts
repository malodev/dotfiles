import type { CommandResult } from "./contracts.ts";

export interface ForgeConfig {
  modelTiers: Record<string, string[]>;
  roleAssignment: Record<string, string>;
  modelOverrides: Record<string, string | undefined>;
  maxWorkers: number;
  maxRetries: number;
  defaultTurnBudget: number;
  maxTurnBudget: number;
  outputDir: string;
  autoExecute: boolean;
  contextBudgetPercent: number;
  costLimitUsd: number;
}

export interface ConfigData {
  config: ForgeConfig;
}

export function config(cfg: ForgeConfig | null): CommandResult<ConfigData> {
  if (!cfg) {
    return {
      ok: false,
      events: [],
      message: "No config available",
    };
  }

  return {
    ok: true,
    events: [],
    data: {
      config: cfg,
    },
  };
}
