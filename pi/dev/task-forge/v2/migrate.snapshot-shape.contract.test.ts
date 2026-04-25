import { describe, it } from "node:test";
import { migrateSnapshot } from "./migrate.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

describe("migrateSnapshot shape normalization", () => {
  it("backfills schema-v4 snapshots that predate required collection fields", () => {
    const migrated = migrateSnapshot({
      schemaVersion: 4,
      orchestrationId: "forge-old",
      status: "planning",
      currentPhase: 0,
      phaseLabel: "Scope Classification",
      prdFile: "TASKFORGE-V2-ONLY-MIGRATION-PLAN.md",
      resolvedModels: {},
      cost: {},
      tasks: [],
      blockers: [],
      timestamps: {
        started: "2026-04-24T00:00:00.000Z",
        lastUpdated: "2026-04-24T00:00:00.000Z",
      },
    } as any);

    assert(migrated.schemaVersion === 4, "expected schema version 4");
    assert(migrated.taskState && typeof migrated.taskState === "object", "expected taskState to be backfilled");
    assert(migrated.supervisors && typeof migrated.supervisors === "object", "expected supervisors to be backfilled");
    assert(Array.isArray(migrated.tasks), "expected tasks array");
    assert(Array.isArray(migrated.blockers), "expected blockers array");
  });
});
