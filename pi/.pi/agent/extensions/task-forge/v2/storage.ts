import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ForgeEvent } from "./events";
import type { RunSnapshot } from "./types";
import { replayEvents } from "./derive";

export interface V2StorageLayout {
  baseDir: string;
  eventsFile: string;
  snapshotFile: string;
}

export function createLayout(cwd: string, outputDir = ".task-forge"): V2StorageLayout {
  const baseDir = resolve(cwd, outputDir);
  return {
    baseDir,
    eventsFile: resolve(baseDir, "events.jsonl"),
    snapshotFile: resolve(baseDir, "state.json"),
  };
}

export async function ensureLayout(layout: V2StorageLayout) {
  await mkdir(layout.baseDir, { recursive: true });
}

export async function appendEvent(layout: V2StorageLayout, event: ForgeEvent) {
  await ensureLayout(layout);
  await appendFile(layout.eventsFile, `${JSON.stringify(event)}\n`, "utf-8");
}

export async function readEvents(layout: V2StorageLayout): Promise<ForgeEvent[]> {
  if (!existsSync(layout.eventsFile)) return [];
  const raw = await readFile(layout.eventsFile, "utf-8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ForgeEvent);
}

export async function deriveSnapshot(layout: V2StorageLayout): Promise<RunSnapshot | null> {
  const events = await readEvents(layout);
  return replayEvents(events);
}

export async function writeSnapshot(layout: V2StorageLayout, snapshot: RunSnapshot) {
  await ensureLayout(layout);
  await writeFile(layout.snapshotFile, JSON.stringify(snapshot, null, 2), "utf-8");
}

export async function loadSnapshot(layout: V2StorageLayout): Promise<RunSnapshot | null> {
  if (!existsSync(layout.snapshotFile)) return null;
  return JSON.parse(await readFile(layout.snapshotFile, "utf-8")) as RunSnapshot;
}
