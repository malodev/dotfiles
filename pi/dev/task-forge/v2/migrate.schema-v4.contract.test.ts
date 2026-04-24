import { describe, it } from "node:test";
import { migrateSnapshot, migrateV3ToV4 } from "./migrate.ts";
import type { RunSnapshot } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeV3SnapshotFixture(): RunSnapshot {
  return {
    schemaVersion: 3,
    orchestrationId: "orch-v3",
    status: "planning",
    currentPhase: 2,
    phaseLabel: "Planning & Decomposition",
    orchestrationMode: "standard",
    prdFile: "./prd.md",
    requirementsFile: "./01-requirements.md",
    planFile: "./02-plan.md",
    tasksFile: "./03-tasks.json",
    resolvedModels: {},
    cost: {},
    tasks: [],
    taskState: {},
    blockers: [],
    supervisors: {},
    timestamps: {
      started: "2026-04-19T00:00:00.000Z",
      lastUpdated: "2026-04-19T00:05:00.000Z",
    },
  };
}

describe("migrate.schema-v4", () => {
  it("migrateV3ToV4 adds planningRuntime as undefined for v3 snapshots", () => {
    const migrated = migrateV3ToV4(makeV3SnapshotFixture() as Omit<RunSnapshot, "schemaVersion"> & { schemaVersion: 3 });

    assert(migrated.schemaVersion === 4, "expected schemaVersion 4 after migration");
    assert("planningRuntime" in migrated, "expected planningRuntime field to be present after migration");
    assert(migrated.planningRuntime === undefined, "expected planningRuntime to default to undefined");
    assert(migrated.phaseLabel === "Planning & Decomposition", "expected existing fields to remain intact");
  });

  it("schema migration to v4 is idempotent", () => {
    const migratedOnce = migrateSnapshot(makeV3SnapshotFixture());
    const migratedTwice = migrateSnapshot(migratedOnce);

    assert(migratedOnce.schemaVersion === 4, "expected first migration to produce schemaVersion 4");
    assert(migratedTwice.schemaVersion === 4, "expected repeated migration to keep schemaVersion 4");
    assert(migratedTwice.planningRuntime === undefined, "expected planningRuntime to remain undefined on repeated migration");
    assert(JSON.stringify(migratedOnce) === JSON.stringify(migratedTwice), "expected repeated migration to be a no-op");
  });
});
