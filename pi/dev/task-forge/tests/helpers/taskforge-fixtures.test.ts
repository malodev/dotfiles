import test from "node:test";
import assert from "node:assert/strict";

import { createTempRunFixture, appendEvents, replayFixtureEvents } from "./taskforge-fixtures.ts";

test("taskforge fixture creates isolated run folders and replays event snapshots", async () => {
  const fixture = await createTempRunFixture();

  const snapshot = await appendEvents(fixture, [
    {
      type: "run_created",
      at: "2026-01-01T00:00:00.000Z",
      orchestrationId: "orch-1",
      prdFile: "docs/prd.md",
    },
    {
      type: "phase_entered",
      at: "2026-01-01T00:00:01.000Z",
      phase: 1,
      label: "Requirements",
    },
  ] as any);

  assert.ok(snapshot);
  assert.equal(snapshot?.orchestrationId, "orch-1");

  const replayed = await replayFixtureEvents(fixture);
  assert.equal(replayed.events.length, 2);
  assert.equal(replayed.events[0]?.type, "run_created");
  assert.equal(replayed.snapshot?.orchestrationId, "orch-1");
});

test("taskforge fixtures are isolated between runs", async () => {
  const first = await createTempRunFixture("taskforge-fixture-a-");
  const second = await createTempRunFixture("taskforge-fixture-b-");

  await appendEvents(first, [
    {
      type: "run_created",
      at: "2026-01-02T00:00:00.000Z",
      orchestrationId: "orch-a",
      prdFile: "docs/a.md",
    },
  ] as any);

  await appendEvents(second, [
    {
      type: "run_created",
      at: "2026-01-02T00:00:00.000Z",
      orchestrationId: "orch-b",
      prdFile: "docs/b.md",
    },
  ] as any);

  const replayA = await replayFixtureEvents(first);
  const replayB = await replayFixtureEvents(second);

  assert.equal(replayA.events.length, 1);
  assert.equal(replayB.events.length, 1);
  assert.equal(replayA.snapshot?.orchestrationId, "orch-a");
  assert.equal(replayB.snapshot?.orchestrationId, "orch-b");
  assert.notEqual(first.cwd, second.cwd);
});
