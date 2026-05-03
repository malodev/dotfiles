import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ForgeEvent } from "../../src/events.ts";
import { TaskForgeV2Engine } from "../../src/engine.ts";
import { createLayout, readEvents } from "../../src/storage.ts";

export interface TaskforgeFixture {
  cwd: string;
  outputDir: string;
  engine: TaskForgeV2Engine;
}

export async function createTempRunFixture(prefix = "taskforge-fixture-"): Promise<TaskforgeFixture> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  const outputDir = ".task-forge";
  const engine = new TaskForgeV2Engine(cwd, outputDir);
  return { cwd, outputDir, engine };
}

export async function appendEvents(fixture: TaskforgeFixture, events: ForgeEvent[]) {
  for (const event of events) {
    await fixture.engine.append(event);
  }
  return await fixture.engine.load();
}

export async function replayFixtureEvents(fixture: TaskforgeFixture) {
  const layout = createLayout(fixture.cwd, fixture.outputDir);
  const events = await readEvents(layout);
  return {
    events,
    snapshot: await fixture.engine.load(),
  };
}
