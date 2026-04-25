import type { RunSnapshot, CostEstimate } from "../types.ts";
import type { CommandResult } from "./contracts.ts";

export interface CostData {
  cost: CostEstimate;
  costFile?: string;
}

export function cost(snapshot: RunSnapshot | null): CommandResult<CostData> {
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
      cost: snapshot.cost,
      costFile: snapshot.costFile,
    },
  };
}
