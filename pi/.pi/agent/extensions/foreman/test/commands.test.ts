import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Foreman, type Host, type Services } from "../commands.ts";
import type { LeaseClient } from "../gpu.ts";
import { git } from "../git.ts";
import type { RoleRequest, RoleResult, RoleRunner } from "../sandbox.ts";
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
  await writeFile(join(repo, ".pi/foreman.json"), JSON.stringify({ roles, gpu: { managedProviders: ["local"] } }));
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
    setWidget: (lines) => widgets.push(lines),
    setTitle: (title) => titles.push(title),
    bell: () => { bells += 1; },
  };
  const lease: string[] = [];
  const client: LeaseClient = { acquire: async () => { lease.push("acquire"); }, renew: async () => {}, release: async () => { lease.push("release"); } };
  const roleCalls: RoleRequest[] = [];
  const kickoffs: string[] = [];
  const state = { runRole: undefined as RoleRunner | undefined };
  const services: Services = {
    extensionDir: "/ext",
    configPaths: (cwd) => [join(cwd, ".pi/foreman.json")],
    runRole: async (request) => { roleCalls.push(request); return state.runRole!(request); },
    runCommand: bashRunner,
    makeLeaseClient: () => client,
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
  return { repo, foreman, host, messages, statuses, widgets, titles, bell: () => bells, lease, roleCalls, kickoffs, state, last, writer, fileFor };
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
    assert.ok(t.widgets.some((lines) => /working on t01/.test(strip(lines))), "progress names the running task");
    assert.match(strip(t.widgets[t.widgets.length - 1]), /finished: all 2 task\(s\) done/, "the last thing left on screen is the result");
    assert.match(t.titles[t.titles.length - 1], /done 2\/2/);
    assert.equal(t.bell(), 1);
  });

  it("clears a stale result when a new run starts", async () => {
    const t = await setup();
    await t.foreman.handle("plan idea here", t.host);
    t.state.runRole = t.writer(t.fileFor, () => "nope");
    await t.foreman.handle("run", t.host);
    const strip = (lines?: string[]) => (lines ?? []).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    assert.match(strip(t.widgets[t.widgets.length - 1]), /blocked on t01/);
    const before = t.widgets.length;
    await t.foreman.handle("unblock t01", t.host);
    t.state.runRole = t.writer(t.fileFor);
    await t.foreman.handle("run", t.host);
    assert.equal(t.widgets[before], undefined, "the old result is cleared as soon as the next run begins");
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
