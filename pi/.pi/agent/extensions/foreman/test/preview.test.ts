import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parsePreviewConfig, Preview, readPreviewConfig, shouldIgnore, type PreviewDeps } from "../preview.ts";
import type { RunningApp } from "../sandbox.ts";

describe("parsePreviewConfig", () => {
  it("accepts a command, a port and env with placeholders", () => {
    const result = parsePreviewConfig(JSON.stringify({ command: "node server.js", port: 4173, env: { NOTES_FILE: "{data}/notes.json", PORT: "{port}" } }));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.config, { command: "node server.js", port: 4173, env: { NOTES_FILE: "{data}/notes.json", PORT: "{port}" } });
  });

  it("defaults env to PORT and reports every problem", () => {
    assert.deepEqual(parsePreviewConfig('{"command":"npm start","port":4173}').config?.env, {});
    for (const [text, pattern] of [
      ["not json", /not valid JSON/],
      ["[]", /must be an object/],
      ['{"port":4173}', /command/],
      ['{"command":"x","port":80}', /port/],
      ['{"command":"x","port":"4173"}', /port/],
      ['{"command":"x","port":4173,"env":{"A":1}}', /env\.A/],
      ['{"command":"x","port":4173,"extra":1}', /unknown key "extra"/],
    ] as const) {
      const { errors, config } = parsePreviewConfig(text);
      assert.equal(config, undefined, text);
      assert.match(errors.join("\n"), pattern, text);
    }
  });

  it("readPreviewConfig explains how to create the file when it is missing", async () => {
    const repo = await mkdtemp(join(tmpdir(), "foreman-prev-"));
    await assert.rejects(readPreviewConfig(repo), /foreman\/preview\.json[\s\S]*"command"[\s\S]*"port"/);
    await mkdir(join(repo, "foreman"), { recursive: true });
    await writeFile(join(repo, "foreman/preview.json"), '{"command":"npm start","port":4173}');
    assert.equal((await readPreviewConfig(repo)).command, "npm start");
    await writeFile(join(repo, "foreman/preview.json"), '{"command":""}');
    await assert.rejects(readPreviewConfig(repo), /preview\.json is not valid/);
  });
});

describe("shouldIgnore", () => {
  it("ignores dependencies, git, run state, test output and editor temp files, but not source", () => {
    for (const path of ["node_modules/x/index.js", "web/node_modules/y.js", ".git/HEAD", "foreman/.run/state.json", "test-results/a.webm", "playwright-report/index.html", ".venv/bin/python", "src/__pycache__/x.pyc", "src/app.js~", "src/.app.js.swp", "4913"]) {
      assert.equal(shouldIgnore(path), true, path);
    }
    for (const path of ["server.js", "public/index.html", "src/app.js", "foreman/tasks.yaml", "package.json"]) {
      assert.equal(shouldIgnore(path), false, path);
    }
  });
});

function harness(overrides: Partial<PreviewDeps> = {}) {
  const started: { command: string; env: Record<string, string> }[] = [];
  const stopped: number[] = [];
  const notes: { message: string; level?: string }[] = [];
  let onChange: () => void = () => {};
  let watcherClosed = 0;
  const exits: ((code: number | null) => void)[] = [];
  const outputs: ((line: string) => void)[] = [];
  const removed: string[] = [];
  const deps: PreviewDeps = {
    start: async (command, options) => {
      started.push({ command, env: options.env });
      outputs.push(options.onOutput ?? (() => {}));
      let resolveExit: (code: number | null) => void = () => {};
      const exited = new Promise<number | null>((resolve) => { resolveExit = resolve; exits.push(resolve); });
      const index = started.length;
      const app: RunningApp = { exited, stop: async () => { stopped.push(index); resolveExit(null); } };
      return app;
    },
    watch: (_dir, callback) => { onChange = callback; return { close: () => { watcherClosed += 1; } }; },
    isPortFree: async () => true,
    waitForPort: async () => true,
    makeDataDir: async () => "/tmp/preview-data",
    removeDir: async (path) => { removed.push(path); },
    notify: (message, level) => notes.push({ message, level }),
    debounceMs: 20,
    ...overrides,
  };
  return { deps, started, stopped, notes, removed, fire: () => onChange(), closed: () => watcherClosed, crash: (index: number, code = 1) => exits[index]!(code), say: (index: number, line: string) => outputs[index]!(line) };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const config = { command: "node server.js", port: 4173, env: { NOTES_FILE: "{data}/notes.json", PORT: "{port}" } };

describe("Preview", () => {
  it("starts the app with its port and a private data dir, and reports the url", async () => {
    const h = harness();
    const preview = new Preview("/repo", config, h.deps);
    await preview.start();
    assert.equal(preview.url, "http://127.0.0.1:4173");
    assert.equal(preview.running, true);
    assert.deepEqual(h.started[0], { command: "node server.js", env: { NOTES_FILE: "/tmp/preview-data/notes.json", PORT: "4173", FOREMAN_PREVIEW: "1" } });
    await preview.stop();
    assert.deepEqual(h.removed, ["/tmp/preview-data"], "the private data dir is removed on stop");
    assert.equal(preview.running, false);
  });

  it("refuses to start when the port is taken, before starting anything", async () => {
    const h = harness({ isPortFree: async () => false });
    await assert.rejects(new Preview("/repo", config, h.deps).start(), /port 4173 is already in use/);
    assert.equal(h.started.length, 0);
  });

  it("fails clearly if the app never listens, and stops it", async () => {
    const h = harness({ waitForPort: async () => false });
    const preview = new Preview("/repo", config, h.deps);
    h.deps.start = ((original) => async (command, options) => { const app = await original(command, options); options.onOutput?.("Error: Cannot find module './db'"); return app; })(h.deps.start);
    await assert.rejects(preview.start(), /did not start listening[\s\S]*Cannot find module/);
    assert.deepEqual(h.stopped, [1]);
    assert.equal(preview.running, false);
  });

  it("fails at once, not after 20s, when the app dies while starting, and reports it only once", async () => {
    const h = harness({ waitForPort: () => new Promise(() => {}) }); // would hang forever
    h.deps.start = ((original) => async (command, options) => {
      const app = await original(command, options);
      options.onOutput?.("node:internal/modules/cjs/loader:1386");
      options.onOutput?.("Error: Cannot find module '/repo/server.ts'");
      options.onOutput?.("    at Module._resolveFilename (node:internal/modules/cjs/loader:1383:15)");
      options.onOutput?.("Node.js v26.10.0");
      setTimeout(() => h.crash(0, 1), 10);
      return app;
    })(h.deps.start);
    const preview = new Preview("/repo", config, h.deps);
    const started = Date.now();
    await assert.rejects(preview.start(), (error: Error) =>
      /exited right away \(exit code 1\)/.test(error.message) && /Cannot find module '\/repo\/server\.ts'/.test(error.message) && /node server\.js/.test(error.message));
    assert.ok(Date.now() - started < 2000, "did not wait for the port timeout");
    await sleep(30);
    assert.ok(!h.notes.some((note) => /preview stopped/i.test(note.message)), "no second, duplicate warning");
    assert.equal(preview.running, false);
  });

  it("shows the lines that say what went wrong, not just the tail of a stack trace", async () => {
    const h = harness();
    const preview = new Preview("/repo", config, h.deps);
    await preview.start();
    for (const line of ["Error: listen EADDRINUSE 127.0.0.1:4173", ...Array.from({ length: 9 }, (_, i) => `    at frame ${i}`), "Node.js v26.10.0"]) h.say(0, line);
    h.crash(0, 1);
    await sleep(30);
    const note = h.notes.find((entry) => /preview stopped/i.test(entry.message));
    assert.ok(note && /EADDRINUSE/.test(note.message), note?.message);
    await preview.stop();
  });

  it("restarts once after a burst of file changes, keeping the same data dir", async () => {
    const h = harness();
    const preview = new Preview("/repo", config, h.deps);
    await preview.start();
    h.fire(); h.fire(); h.fire();
    await sleep(120);
    assert.equal(h.started.length, 2, "one restart for the whole burst");
    assert.deepEqual(h.stopped, [1]);
    assert.equal(h.started[1].env.NOTES_FILE, "/tmp/preview-data/notes.json", "your data survives a restart");
    await preview.stop();
  });

  it("when the app crashes, says so with its last output and retries on the next change", async () => {
    const h = harness();
    const preview = new Preview("/repo", config, h.deps);
    await preview.start();
    h.say(0, "TypeError: x is not a function");
    h.crash(0, 1);
    await sleep(30);
    assert.equal(preview.running, false);
    const crash = h.notes.find((note) => /preview stopped/i.test(note.message));
    assert.ok(crash && /exit code 1/.test(crash.message) && /x is not a function/.test(crash.message) && crash.level === "warning");
    h.fire();
    await sleep(120);
    assert.equal(h.started.length, 2, "the next saved file triggers another try");
    assert.equal(preview.running, true);
    await preview.stop();
  });

  it("does not report a crash for the app it stopped itself", async () => {
    const h = harness();
    const preview = new Preview("/repo", config, h.deps);
    await preview.start();
    await preview.stop();
    await sleep(30);
    assert.ok(!h.notes.some((note) => /preview stopped/i.test(note.message)));
    assert.equal(h.closed(), 1);
  });
});
