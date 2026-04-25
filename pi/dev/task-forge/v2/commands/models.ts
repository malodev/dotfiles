import type { RunSnapshot, Role } from "../types.ts";
import type { CommandResult } from "./contracts.ts";

export interface ModelsData {
  resolvedModels: Partial<Record<Role, string>>;
}

export function models(snapshot: RunSnapshot | null): CommandResult<ModelsData> {
  if (!snapshot) {
    return {
      ok: false,
      events: [],
      message: "No run snapshot available",
    };
  }

  return {
    ok: true,
    events: [],
    snapshot,
    data: {
      resolvedModels: snapshot.resolvedModels,
    },
  };
}
