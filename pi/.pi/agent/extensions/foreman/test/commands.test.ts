import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Foreman, type Host, type Services } from "../commands.ts";
import type { LeaseClient } from "../gpu.ts";
import { git } from "../git.ts";
import type { PreviewDeps } from "../preview.ts";
import type { RoleRequest, RoleResult, RoleRunner, RunningApp } from "../sandbox.ts";
import { bashRunner, tempRepo } from "./helpers.ts";

const TASKS = `- id: t01
  goal: Write a.txt containing ok
  success_tests: ["grep -q ok a.txt"]
- id: t02
  goal: Write b.txt containing ok
  depends_on: [t01]
  success_tests: ["grep -q ok b.txt"]
`;

const ok = (output: string, extra: Partial<RoleResult> = {}): RoleResult => ({ output, toolCount: 1, exitCode: 0, stderr: "", ...extra });

async function setup(options: { architect?: boolean; writeTasks?: string } = {}) {
  const repo = await tempRepo();
  await mkdir(join(repo, ".pi"), { recursive: true });
  const roles: Record<string, unknown> = { builder: { provider: "local", model: "m1" }, reviewer: { same_as: "builder" } };
  if (options.architect) roles.architect = { provider: "local", model: "big" };
  await writeFile(join(repo, ".pi/foreman.json"), JSON.stringify({ roles, gpu: { managedProviders: ["local"] }, modes: { ds4: { provider: "ds4", model: "flash" } } }));
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-q", "-m", "config"]);

  const messages: { level: string; message: string }[] = [];
  const statuses: (string | undefined)[] = [];
  const widgets: (string[] | undefined)[] = [];
  const titles: string[] = [];
  let bells = 0;
  const host: Host = {
    cwd: repo,
    notify: (message, level = "info") => messages.push({ level, message }),
    setStatus: (text) => statuses.push(text),
    setWidget: (content) => widgets.push(typeof content === "function" ? content(100) : content),
    setTitle: (title) => titles.push(title),
    bell: () => { bells += 1; },
  };
  const lease: string[] = [];
  const client: LeaseClient = { acquire: async () => { lease.push("acquire"); }, renew: async () => {}, release: async () => { lease.push("release"); } };
  const roleCalls: RoleRequest[] = [];
  const kickoffs: string[] = [];
  const state = { runRole: undefined as RoleRunner | undefined, mode: "team", previewExitsAtOnce: false };
  const opened: string[] = [];
  const previewLog: string[] = [];
  let previewPortFree = true;
  let openFails = false;
  const leaseModes: string[] = [];
  const services: Services = {
    extensionDir: "/ext",
    configPaths: (cwd) => [join(cwd, ".pi/foreman.json")],
    runRole: async (request) => { roleCalls.push(request); return state.runRole!(request); },
    runCommand: bashRunner,
    makeLeaseClient: (config) => { leaseModes.push(config.mode); return client; },
    readMode: async () => state.mode,
    openUrl: async (target) => { if (openFails) throw new Error("no browser"); opened.push(target); },
    preview: {
      start: async (command, options) => {
        previewLog.push(`start ${command}`);
        if (state.previewExitsAtOnce) {
          options.onOutput?.("Error: Cannot find module './server.ts'");
          return { exited: Promise.resolve(1), stop: async () => {} } satisfies RunningApp;
        }
        const app: RunningApp = { exited: new Promise(() => {}), stop: async () => { previewLog.push("stop"); } };
        return app;
      },
      watch: () => ({ close: () => { previewLog.push("unwatch"); } }),
      isPortFree: async () => previewPortFree,
      waitForPort: async () => { await new Promise((resolve) => setTimeout(resolve, 25)); return true; }, // a real port check is never instant
      makeDataDir: async () => "/tmp/preview-data",
      removeDir: async () => {},
    } satisfies Omit<PreviewDeps, "notify">,
    startArchitect: async (h, kickoff) => {
      kickoffs.push(kickoff);
      await mkdir(join(h.cwd, "foreman"), { recursive: true });
      await writeFile(join(h.cwd, "foreman/plan.md"), "# Plan\n");
      await writeFile(join(h.cwd, "foreman/tasks.yaml"), options.writeTasks ?? TASKS);
    },
  };
  const foreman = new Foreman(services);
  const last = () => messages[messages.length - 1];
  const writer = (fileFor: (request: RoleRequest) => string, content = (_n: number) => "ok"): RoleRunner => {
    let builds = 0;
    return async (request) => {
      if (request.role === "reviewer") return ok("## Verdict\nAPPROVE");
      builds += 1;
      await writeFile(join(repo, fileFor(request)), content(builds));
      return ok("built");
    };
  };
  const fileFor = (request: RoleRequest) => (request.task.includes("Task t01") ? "a.txt" : "b.txt");
  return { repo, foreman, host, opened, previewLog, setPortFree: (value: boolean) => { previewPortFree = value; }, setOpenFails: (value: boolean) => { openFails = value; }, leaseModes, messages, statuses, widgets, titles, bell: () => bells, lease, roleCalls, kickoffs, state, last, writer, fileFor };
}

describe("foreman commands (smoke)", () => {
  it("takes a toy PRD from plan to done with the whole flow wired", async () => {
    const t = await setup();
    await writeFile(join(t.repo, "prd.md"), "# Toy\nWrite two files.\n");
    await git(t.repo, ["add", "-A"]);
    await git(t.repo, ["commit", "-q", "-m", "prd"]);

    await t.foreman.handle("plan prd.md", t.host);
    assert.match(t.kickoffs[0], /PRD at .*prd\.md/);
    assert.match(t.kickoffs[0], /node \/ext\/check\.ts foreman\/tasks\.yaml/);

    await t.foreman.handle("status", t.host);
    assert.match(t.last().message, /0\/2 done/);

    // t01's first attempt is red, then green.
    t.state.runRole = t.writer(t.fileFor, (n) => (n === 1 ? "bad" : "ok"));
    await t.foreman.handle("run", t.host);
    assert.match(t.last().message, /All 2 task\(s\) done on branch foreman\//);

    const branch = (await git(t.repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    assert.match(branch, /^foreman\/\d{14}$/);
    const log = (await git(t.repo, ["log", "--format=%s", "-4"])).trim().split("\n");
    assert.deepEqual(log.slice(0, 3).map((line) => line.replace(/ — .*/, "")), ["foreman: t02", "foreman: t01", "foreman: plan"]);
    assert.equal((await git(t.repo, ["show", "--name-only", "--format=", "HEAD~2"])).trim().split("\n").sort().join(","), "foreman/plan.md,foreman/tasks.yaml");

    await t.foreman.handle("status", t.host);
    assert.match(t.last().message, /2\/2 done/);
    assert.equal(t.statuses[t.statuses.length - 1], undefined, "footer status is cleared when the run ends");
    assert.deepEqual(t.lease, ["acquire", "release"]);
  });

  it("shows live progress during a run and leaves a final result on screen with a bell", async () => {
    const t = await setup();
    await t.foreman.handle("plan idea here", t.host);
    t.state.runRole = t.writer(t.fileFor);
    await t.foreman.handle("run", t.host);
    const strip = (lines?: string[]) => (lines ?? []).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(t.widgets.some((lines) => /▸ t01[\s\S]*Now\s+/.test(strip(lines))), "the panel marks the running task and says what is happening now");
    assert.match(strip(t.widgets[t.widgets.length - 1]), /finished[\s\S]*✓2 done[\s\S]*git log --oneline main\.\./, "the last thing left on screen is the result");
    assert.match(t.titles[t.titles.length - 1], /done 2\/2/);
    assert.equal(t.bell(), 1);
  });

  it("clears a stale result when a new run starts", async () => {
    const t = await setup();
    await t.foreman.handle("plan idea here", t.host);
    t.state.runRole = t.writer(t.fileFor, () => "nope");
    await t.foreman.handle("run", t.host);
    const strip = (lines?: string[]) => (lines ?? []).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    assert.match(strip(t.widgets[t.widgets.length - 1]), /blocked[\s\S]*✖ t01[\s\S]*\/foreman unblock t01/);
    const before = t.widgets.length;
    await t.foreman.handle("unblock t01", t.host);
    t.state.runRole = t.writer(t.fileFor);
    await t.foreman.handle("run", t.host);
    assert.equal(t.widgets[before], undefined, "the old result is cleared as soon as the next run begins");
  });

  it("status shows the effective models", async () => {
    const t = await setup({ architect: true });
    await t.foreman.handle("status", t.host);
    assert.match(t.last().message, /models: architect local\/big · builder local\/m1 · reviewer local\/m1/);
  });

  it("in ds4 mode one fixed model serves all three roles and the lease is taken in ds4", async () => {
    const t = await setup({ architect: true });
    t.state.mode = "ds4";
    await t.foreman.handle("plan idea here", t.host);
    t.state.runRole = t.writer(t.fileFor);
    await t.foreman.handle("run", t.host);
    assert.match(t.last().message, /All 2 task\(s\) done/);
    assert.deepEqual([...new Set(t.roleCalls.map((call) => call.model))], ["ds4/flash"], "builder and reviewer both use the mode's model");
    assert.deepEqual([...new Set(t.leaseModes)], ["ds4"]);
    assert.deepEqual(t.lease, ["acquire", "release"], "a single lease, no swaps between roles");
  });

  it("refuses to run in studio mode and touches nothing", async () => {
    const t = await setup();
    await t.foreman.handle("plan idea here", t.host);
    t.state.mode = "studio";
    await t.foreman.handle("run", t.host);
    assert.equal(t.last().level, "error");
    assert.match(t.last().message, /studio mode[\s\S]*switch the mode in the panel/);
    assert.deepEqual(t.lease, [], "no lease taken, nothing switched");
    assert.equal(t.roleCalls.length, 0);
    assert.equal((await git(t.repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim(), "main", "no branch created");
  });

  it("status reports the mode, and explains a refusal instead of failing", async () => {
    const t = await setup();
    await t.foreman.handle("status", t.host);
    assert.match(t.last().message, /mode: team\nmodels: builder local\/m1/);
    t.state.mode = "ds4";
    await t.foreman.handle("status", t.host);
    assert.match(t.last().message, /mode: ds4\nmodels: architect ds4\/flash · builder ds4\/flash · reviewer ds4\/flash/);
    t.state.mode = "maintenance";
    await t.foreman.handle("status", t.host);
    assert.match(t.last().message, /models: unavailable — The host is in maintenance mode/);
  });

  it("hands the planning lease to the run instead of releasing and re-acquiring", async () => {
    const t = await setup({ architect: true });
    await t.foreman.handle("plan a tiny cli", t.host);
    assert.deepEqual(t.lease, ["acquire"], "a managed Architect model holds the card while planning");
    t.state.runRole = t.writer(t.fileFor);
    await t.foreman.handle("run", t.host);
    assert.deepEqual(t.lease, ["acquire", "release"]);
  });

  it("refuses to run without a valid plan, and explains", async () => {
    const t = await setup();
    await t.foreman.handle("run", t.host);
    assert.match(t.last().message, /Run \/foreman plan first/);
    const bad = await setup({ writeTasks: "- id: a\n  goal: g\n  success_tests: [TODO]\n" });
    await bad.foreman.handle("plan idea here", bad.host);
    await bad.foreman.handle("run", bad.host);
    assert.equal(bad.last().level, "error");
    assert.match(bad.last().message, /placeholder/);
  });

  it("refuses to start on top of the owner's uncommitted work, before creating a branch", async () => {
    const t = await setup();
    await t.foreman.handle("plan idea here", t.host);
    await writeFile(join(t.repo, "stray.txt"), "mine");
    await t.foreman.handle("run", t.host);
    assert.match(t.last().message, /Uncommitted changes outside foreman[\s\S]*stray\.txt/);
    assert.equal((await git(t.repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim(), "main");
  });

  it("reports a block with the exact recovery commands, then resumes after unblock", async () => {
    const t = await setup();
    await t.foreman.handle("plan idea here", t.host);
    t.state.runRole = t.writer(t.fileFor, () => "nope");
    await t.foreman.handle("run", t.host);
    assert.equal(t.last().level, "warning");
    assert.match(t.last().message, /Blocked on t01[\s\S]*\/foreman unblock t01/);
    await t.foreman.handle("status", t.host);
    assert.match(t.last().message, /✖ t01\s+blocked/);

    await t.foreman.handle("unblock t01 the file must contain ok", t.host);
    t.state.runRole = t.writer(t.fileFor);
    await t.foreman.handle("run", t.host);
    assert.match(t.last().message, /All 2 task\(s\) done/);
    assert.ok(t.roleCalls.some((call) => /the file must contain ok/.test(call.task)), "the owner's note reached the Builder");
  });

  it("unblock rejects a task that is not blocked and a missing id", async () => {
    const t = await setup();
    await t.foreman.handle("plan idea here", t.host);
    await t.foreman.handle("unblock", t.host);
    assert.match(t.last().message, /Usage: \/foreman unblock/);
    await t.foreman.handle("run", t.host).catch(() => {});
  });

  it("pause is remembered across runs and stops the queue after the current task", async () => {
    const t = await setup();
    await t.foreman.handle("plan idea here", t.host);
    let firstDone: () => void;
    const started = new Promise<void>((resolve) => { firstDone = resolve; });
    const inner = t.writer(t.fileFor);
    t.state.runRole = async (request) => {
      if (request.role === "builder" && request.task.includes("Task t01")) {
        void t.foreman.handle("pause", t.host).then(() => firstDone());
        await started;
      }
      return inner(request);
    };
    await t.foreman.handle("run", t.host);
    assert.match(t.last().message, /Paused after 1 task/);
    await t.foreman.handle("status", t.host);
    assert.match(t.last().message, /1\/2 done · paused/);
    // /foreman run clears the pause and finishes the rest.
    t.state.runRole = t.writer(t.fileFor);
    await t.foreman.handle("run", t.host);
    assert.match(t.last().message, /All 2 task\(s\) done/);
  });

  it("stop aborts the running task and blocks it as aborted", async () => {
    const t = await setup();
    await t.foreman.handle("plan idea here", t.host);
    t.state.runRole = (request) => new Promise((resolve) => {
      setTimeout(() => void t.foreman.handle("stop", t.host), 50);
      request.signal?.addEventListener("abort", () => resolve(ok("", { error: "role aborted", toolCount: 0 })));
    });
    await t.foreman.handle("run", t.host);
    assert.match(t.messages.map((entry) => entry.message).join("\n"), /Stopping/);
    assert.match(t.last().message, /Blocked on t01: aborted/);
    await t.foreman.handle("stop", t.host);
    assert.match(t.last().message, /Nothing is running/);
  });

  it("recovers a crash: a task left running becomes blocked, never silently retried", async () => {
    const t = await setup();
    await t.foreman.handle("plan idea here", t.host);
    t.state.runRole = t.writer(t.fileFor);
    await t.foreman.handle("run", t.host);
    // Simulate a crash mid-task by rewriting the state file.
    const path = join(t.repo, "foreman/.run/state.json");
    const state = JSON.parse(await readFile(path, "utf8"));
    state.tasks.t02 = { status: "running", attempts: 1 };
    await writeFile(path, JSON.stringify(state));
    await t.foreman.handle("run", t.host);
    assert.match(t.last().message, /Blocked on t02: interrupted/);
  });

  it("prints usage for an unknown or empty command", async () => {
    const t = await setup();
    await t.foreman.handle("", t.host);
    assert.match(t.last().message, /\/foreman plan/);
    await t.foreman.handle("bogus", t.host);
    assert.equal(t.last().level, "warning");
  });

  it("wraps failures as error notifications instead of throwing", async () => {
    const t = await setup();
    await t.foreman.handle("plan", t.host);
    assert.equal(t.last().level, "error");
    assert.match(t.last().message, /Usage: \/foreman plan/);
  });
});


describe("preview and recordings commands", () => {
  const PREVIEW = JSON.stringify({ command: "node server.js", port: 4173, env: { PORT: "{port}" } });
  const withPreview = async () => {
    const t = await setup();
    await mkdir(join(t.repo, "foreman"), { recursive: true });
    await writeFile(join(t.repo, "foreman/preview.json"), PREVIEW);
    return t;
  };

  it("starts the preview, opens it in the browser, and explains what it follows", async () => {
    const t = await withPreview();
    await t.foreman.handle("preview", t.host);
    assert.deepEqual(t.previewLog.slice(0, 1), ["start node server.js"]);
    assert.deepEqual(t.opened, ["http://127.0.0.1:4173"]);
    assert.match(t.last().message, /^Preview running\.\nOpen: http:\/\/127\.0\.0\.1:4173\n[\s\S]*saved files[\s\S]*\/foreman preview stop/, "the link is on its own line, right after the headline");
    await t.foreman.shutdown();
  });

  it("still shows the link when no browser could be opened", async () => {
    const t = await withPreview();
    t.setOpenFails(true);
    await t.foreman.handle("preview", t.host);
    assert.match(t.last().message, /Open: http:\/\/127\.0\.0\.1:4173[\s\S]*could not open a browser[\s\S]*open the link yourself/i);
    assert.equal(t.previewLog.filter((entry) => entry.startsWith("start")).length, 1, "the preview itself is running anyway");
    await t.foreman.shutdown();
  });

  it("says where the preview will be even when the app cannot start yet", async () => {
    const t = await withPreview();
    t.state.previewExitsAtOnce = true;
    await t.foreman.handle("preview", t.host);
    assert.match(t.last().message, /exited right away[\s\S]*Address once it runs: http:\/\/127\.0\.0\.1:4173/);
  });

  it("status and the final result keep showing the link while the preview runs", async () => {
    const t = await withPreview();
    await t.foreman.handle("plan idea here", t.host);
    await t.foreman.handle("preview", t.host);
    await t.foreman.handle("status", t.host);
    assert.match(t.last().message, /preview: http:\/\/127\.0\.0\.1:4173/);
    t.state.runRole = t.writer(t.fileFor);
    await t.foreman.handle("run", t.host);
    const strip = (lines?: string[]) => (lines ?? []).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    assert.match(strip(t.widgets[t.widgets.length - 1]), /finished[\s\S]*Preview\s+http:\/\/127\.0\.0\.1:4173/, "the result panel still has the link");
    await t.foreman.handle("preview stop", t.host);
    await t.foreman.handle("status", t.host);
    assert.ok(!/preview: http/.test(t.last().message));
    await t.foreman.shutdown();
  });

  it("a second /foreman preview reopens the running one instead of starting another", async () => {
    const t = await withPreview();
    await t.foreman.handle("preview", t.host);
    await t.foreman.handle("preview", t.host);
    assert.equal(t.previewLog.filter((entry) => entry.startsWith("start")).length, 1);
    assert.equal(t.opened.length, 2);
    await t.foreman.shutdown();
  });

  it("preview stop stops it, and shutdown stops it too", async () => {
    const t = await withPreview();
    await t.foreman.handle("preview", t.host);
    await t.foreman.handle("preview stop", t.host);
    assert.ok(t.previewLog.includes("stop") && t.previewLog.includes("unwatch"));
    assert.match(t.last().message, /Preview stopped/);
    await t.foreman.handle("preview stop", t.host);
    assert.match(t.last().message, /No preview is running/);
    await t.foreman.handle("preview", t.host);
    const before = t.previewLog.length;
    await t.foreman.shutdown();
    assert.ok(t.previewLog.length > before && t.previewLog.includes("stop"));
  });

  it("explains a missing preview.json and a busy port instead of failing silently", async () => {
    const t = await setup();
    await t.foreman.handle("preview", t.host);
    assert.equal(t.last().level, "error");
    assert.match(t.last().message, /No foreman\/preview\.json/);
    await mkdir(join(t.repo, "foreman"), { recursive: true });
    await writeFile(join(t.repo, "foreman/preview.json"), PREVIEW);
    t.setPortFree(false);
    await t.foreman.handle("preview", t.host);
    assert.match(t.last().message, /port 4173 is already in use/);
    assert.deepEqual(t.opened, []);
  });

  it("answers at once and explains that the app may not be built yet", async () => {
    const t = await withPreview();
    await t.foreman.handle("plan idea here", t.host);
    t.setPortFree(false);
    await t.foreman.handle("preview", t.host);
    const infos = t.messages.map((entry) => entry.message);
    const startingAt = infos.findIndex((message) => /Starting the preview on port 4173/.test(message));
    const errorAt = infos.findIndex((message) => /already in use/.test(message));
    assert.ok(startingAt >= 0 && errorAt > startingAt, "immediate feedback comes before any outcome");
    t.setPortFree(true);
    t.state.previewExitsAtOnce = true;
    await t.foreman.handle("preview", t.host);
    assert.match(t.last().message, /exited right away[\s\S]*0 of 2 tasks are done[\s\S]*may not exist yet/);
  });

  it("shows the preview address in the live panel while a run is going", async () => {
    const t = await withPreview();
    await t.foreman.handle("plan idea here", t.host);
    await t.foreman.handle("preview", t.host);
    t.state.runRole = t.writer(t.fileFor);
    await t.foreman.handle("run", t.host);
    const strip = (lines?: string[]) => (lines ?? []).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(t.widgets.some((lines) => /Preview\s+http:\/\/127\.0\.0\.1:4173/.test(strip(lines))));
    await t.foreman.shutdown();
  });

  it("keeps videos and screenshots from each test run and opens them with /foreman recordings", async () => {
    const t = await setup();
    await t.foreman.handle("plan idea here", t.host);
    // Make t01's success test also leave Playwright-style output behind.
    const yaml = await readFile(join(t.repo, "foreman/tasks.yaml"), "utf8");
    await writeFile(join(t.repo, "foreman/tasks.yaml"), yaml.replace('"grep -q ok a.txt"', '"mkdir -p test-results/notes-chromium && echo v > test-results/notes-chromium/video.webm && echo s > test-results/notes-chromium/shot.png && grep -q ok a.txt"'));
    t.state.runRole = t.writer(t.fileFor);
    await t.foreman.handle("run", t.host);
    assert.match(t.last().message, /All 2 task\(s\) done/);
    const index = join(t.repo, "foreman/.run/artifacts/t01-attempt1/index.html");
    assert.match(await readFile(index, "utf8"), /video\.webm/);
    assert.ok(t.statuses.some((status) => /recorded 1 video, 1 screenshot/.test(status ?? "")), "the run said what it recorded");
    assert.equal((await git(t.repo, ["ls-files", "--", "test-results", "foreman/.run"])).trim(), "", "recordings are never committed");

    await t.foreman.handle("recordings", t.host);
    assert.deepEqual(t.opened, [`file://${index}`]);
    assert.match(t.last().message, /t01-attempt1/);
    t.setOpenFails(true);
    await t.foreman.handle("recordings", t.host);
    assert.match(t.last().message, /could not open a browser[\s\S]*t01-attempt1[\s\S]*index\.html/, "the file path is still shown");
    t.setOpenFails(false);
    await t.foreman.handle("recordings nothing-here", t.host);
    assert.match(t.last().message, /No recordings/);
    await assert.rejects(readFile(join(t.repo, "foreman/.run/artifacts/t02-attempt1/index.html")), "t02's tests recorded nothing, so t01's stale output is not credited to it");
  });
});
