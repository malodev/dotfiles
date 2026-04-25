// @ts-nocheck
import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const migratePath = "../../v2/migrate.ts";
const storagePath = "../../v2/storage.ts";

describe("v2/migrate one-way semantics", () => {
  it("migrates legacy state to V2 events once", async () => {
    const { shouldImportLegacyState, importLegacyState } = await import(migratePath);
    const { createLayout, readEvents, deriveSnapshot } = await import(storagePath);

    const dir = await mkdtemp(join(tmpdir(), "tf-migrate-"));
    const layout = createLayout(dir, ".");

    const legacyState = {
      orchestrationId: "orch-legacy",
      status: "planning",
      currentPhase: 0,
      phaseLabel: "Scope Classification",
      blockers: [],
      timestamps: {
        started: "2026-04-24T00:00:00.000Z",
      },
      tasks: [
        {
          id: "T1",
          title: "Legacy task",
          description: "d",
          complexity: "S",
          taskMode: "single-pass",
          contextManifest: {},
          outputManifest: [],
          dependencies: [],
          acceptanceCriteria: [],
          escalationTriggers: [],
          status: "pending",
          retries: 0,
          testCommand: "npm test",
        },
      ],
    };

    await writeFile(layout.snapshotFile, JSON.stringify(legacyState));

    assert.strictEqual(await shouldImportLegacyState(layout), true, "guard should allow legacy import");

    const result = await importLegacyState(layout);
    assert.strictEqual(result.imported, true, "importLegacyState should import");
    assert.ok(result.events.length > 0, "migration should produce events");
    assert.strictEqual(result.events[0].type, "run_created", "first event should be run_created");

    const readBack = await readEvents(layout);
    assert.strictEqual(readBack.length, result.events.length, "events should persist");

    const snapshot = await deriveSnapshot(layout);
    assert.ok(snapshot, "snapshot should be derivable after migration");
    assert.strictEqual(snapshot.orchestrationId, "orch-legacy");

    assert.strictEqual(await shouldImportLegacyState(layout), false, "guard should prevent re-import");

    const repeat = await importLegacyState(layout);
    assert.strictEqual(repeat.imported, false, "re-import should be skipped");
    assert.strictEqual(repeat.events.length, 0);
    assert.strictEqual(repeat.snapshot, null);
  });

  it("does not re-import when V2 events already exist", async () => {
    const { shouldImportLegacyState, importLegacyState } = await import(migratePath);
    const { createLayout, readEvents, appendEvent } = await import(storagePath);

    const dir = await mkdtemp(join(tmpdir(), "tf-migrate-guard-"));
    const layout = createLayout(dir, ".");

    const seedEvent = {
      type: "run_created",
      at: new Date().toISOString(),
      orchestrationId: "orch-v2",
      prdFile: "prd.md",
    };
    await appendEvent(layout, seedEvent);

    const eventsBefore = await readEvents(layout);
    assert.strictEqual(eventsBefore.length, 1, "should have pre-existing V2 event");

    assert.strictEqual(await shouldImportLegacyState(layout), false, "guard should detect existing V2 events");

    const result = await importLegacyState(layout);
    assert.strictEqual(result.imported, false, "import should be skipped when V2 events exist");
    assert.strictEqual(result.events.length, 0);
    assert.strictEqual(result.snapshot, null);
  });

  it("does not import when state.json is already a V2 snapshot", async () => {
    const { shouldImportLegacyState, importLegacyState } = await import(migratePath);
    const { createLayout } = await import(storagePath);

    const dir = await mkdtemp(join(tmpdir(), "tf-migrate-v2-snap-"));
    const layout = createLayout(dir, ".");

    const v2Snapshot = {
      schemaVersion: 4,
      orchestrationId: "orch-v2",
      status: "planning",
      currentPhase: 0,
      phaseLabel: "Scope Classification",
      prdFile: "prd.md",
      resolvedModels: {},
      cost: {},
      tasks: [],
      taskState: {},
      blockers: [],
      supervisors: {},
      timestamps: {
        started: "2026-04-24T00:00:00.000Z",
        lastUpdated: "2026-04-24T00:00:00.000Z",
      },
    };

    await writeFile(layout.snapshotFile, JSON.stringify(v2Snapshot));

    assert.strictEqual(await shouldImportLegacyState(layout), false, "guard should reject V2 snapshot as legacy");

    const result = await importLegacyState(layout);
    assert.strictEqual(result.imported, false, "import should be skipped for V2 snapshot");
  });
});
