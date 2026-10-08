import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadTasks } from "../tasks.ts";
import {
  emptyState, loadState, markBlocked, markDone, markRunning, nextTask, recoverInterrupted,
  saveState, setAttempts, setStage, syncTasks, unblock, type State,
} from "../state.ts";

const tasks = loadTasks(`
- id: a
  goal: g
  success_tests: [npm test]
- id: b
  goal: g
  depends_on: [a]
  success_tests: [npm test]
`).tasks;

const fresh = (): State => syncTasks(emptyState(), tasks);

describe("state persistence", () => {
  it("returns an empty state when the file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "foreman-state-"));
    assert.deepEqual(await loadState(join(dir, "state.json")), emptyState());
  });

  it("round-trips through an atomic write and leaves no temp files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "foreman-state-"));
    const path = join(dir, "state.json");
    const state = markRunning(fresh(), "a");
    await saveState(path, state);
    assert.deepEqual(await loadState(path), state);
    assert.deepEqual(await readdir(dir), ["state.json"]);
  });

  it("refuses to guess when the file is corrupt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "foreman-state-"));
    const path = join(dir, "state.json");
    await writeFile(path, "{not json");
    await assert.rejects(loadState(path), /state\.json/);
    await writeFile(path, JSON.stringify({ version: 99 }));
    await assert.rejects(loadState(path), /version/);
    assert.match(await readFile(path, "utf8"), /99/);
  });
});

describe("transitions", () => {
  it("syncTasks adds new tasks as pending and keeps existing progress", () => {
    const state = markDone(fresh(), "a", "abc123");
    const more = syncTasks(state, [...tasks, { id: "c", goal: "g", dependsOn: [], files: [], successTests: ["x"] }]);
    assert.equal(more.tasks.a.status, "done");
    assert.equal(more.tasks.c.status, "pending");
  });

  it("recoverInterrupted blocks running tasks and nothing else", () => {
    const state = recoverInterrupted(markRunning(fresh(), "a"));
    assert.equal(state.tasks.a.status, "blocked");
    assert.match(state.tasks.a.blockedReason ?? "", /interrupted/);
    assert.equal(state.tasks.b.status, "pending");
  });

  it("unblock keeps the attempts and review stage of a task that only failed review", () => {
    let state = markBlocked(setAttempts(fresh(), "a", 2), "a", "reviewer silent");
    state = setStage(state, "a", "review");
    const after = unblock(state, "a", "note");
    assert.equal(after.tasks.a.stage, "review");
    assert.equal(after.tasks.a.attempts, 2, "the builder is not rerun, so its attempts are not reset");
    assert.equal(unblock(markBlocked(setAttempts(fresh(), "a", 2), "a", "why"), "a").tasks.a.attempts, 0);
    assert.equal(setStage(state, "a", undefined).tasks.a.stage, undefined);
  });

  it("unblock resets a blocked task, keeps the note, and rejects other states", () => {
    const blocked = markBlocked(fresh(), "a", "tests kept failing");
    const state = unblock(blocked, "a", "use the existing helper");
    assert.equal(state.tasks.a.status, "pending");
    assert.equal(state.tasks.a.attempts, 0);
    assert.equal(state.tasks.a.note, "use the existing helper");
    assert.throws(() => unblock(fresh(), "a"), /not blocked/);
    assert.throws(() => unblock(fresh(), "zzz"), /unknown task/);
  });
});

describe("nextTask", () => {
  it("returns the first non-done task in plan order", () => {
    assert.deepEqual(nextTask(tasks, fresh()), { kind: "run", task: tasks[0] });
    assert.deepEqual(nextTask(tasks, markDone(fresh(), "a", "sha")), { kind: "run", task: tasks[1] });
  });

  it("reports idle when everything is done", () => {
    assert.deepEqual(nextTask(tasks, markDone(markDone(fresh(), "a", "s"), "b", "s")), { kind: "idle" });
  });

  it("a blocked task stops everything behind it", () => {
    const result = nextTask(tasks, markBlocked(fresh(), "a", "why"));
    assert.equal(result.kind, "blocked");
  });

  it("stops when paused", () => {
    assert.equal(nextTask(tasks, { ...fresh(), paused: true }).kind, "paused");
  });

  it("refuses to start while another task is marked running", () => {
    assert.equal(nextTask(tasks, markRunning(fresh(), "a")).kind, "blocked");
  });
});
