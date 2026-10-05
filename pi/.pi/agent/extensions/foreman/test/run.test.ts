import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Gpu, type LeaseClient } from "../gpu.ts";
import { commitAll, ensureWorkBranch, git } from "../git.ts";
import { runQueue } from "../run.ts";
import type { RoleRequest, RoleResult, RoleRunner } from "../sandbox.ts";
import { openStore, syncTasks, unblock, setPaused, type StateStore } from "../state.ts";
import { loadTasks } from "../tasks.ts";
import { bashRunner, tempRepo } from "./helpers.ts";

const PLAN = `
- id: t01
  goal: Write a.txt containing ok
  success_tests:
    - grep -q ok a.txt
- id: t02
  goal: Write b.txt containing ok
  depends_on: [t01]
  success_tests:
    - grep -q ok b.txt
`;

const LIMITS = { buildAttempts: 3, reviewAttempts: 2, roleTimeoutSeconds: 60, idleTimeoutSeconds: 60, modelLoadTimeoutSeconds: 120, testTimeoutSeconds: 30 };

function result(output: string, overrides: Partial<RoleResult> = {}): RoleResult {
  return { output, toolCount: 1, exitCode: 0, stderr: "", ...overrides };
}

interface Harness {
  repo: string;
  calls: RoleRequest[];
  leaseCalls: string[];
  prepared: string[];
  phases: string[];
  run: (options?: { runRole?: RoleRunner; reviewerModel?: string; signal?: AbortSignal }) => ReturnType<typeof runQueue>;
  gpu: Gpu;
  statePath: string;
  store: StateStore;
}

async function harness(plan = PLAN): Promise<Harness> {
  const repo = await tempRepo();
  await ensureWorkBranch(repo, "test");
  await mkdir(join(repo, "foreman/.run"), { recursive: true });
  const statePath = join(repo, "foreman/.run/state.json");
  const calls: RoleRequest[] = [];
  const leaseCalls: string[] = [];
  const prepared: string[] = [];
  const phases: string[] = [];
  const client: LeaseClient = {
    async acquire() { leaseCalls.push("acquire"); },
    async renew() { leaseCalls.push("renew"); },
    async release() { leaseCalls.push("release"); },
  };
  const gpu = new Gpu({ client, isManaged: () => true, ttlMs: 60_000, renewIntervalMs: 30_000, expiryMarginMs: 1000, onLeaseLost: () => {} });
  const tasks = loadTasks(plan).tasks;
  const store = await openStore(statePath);
  await store.update((state) => syncTasks(state, tasks));
  const h: Harness = {
    repo, calls, leaseCalls, prepared, phases, gpu, statePath, store,
    run: async (options = {}) => runQueue({
      repo,
      tasks,
      store,
      gpu,
      limits: LIMITS,
      logDir: join(repo, "foreman/.run/logs"),
      builder: { model: "local/m1" },
      reviewer: { model: options.reviewerModel ?? "local/m1" },
      prompts: { builder: "builder.md", reviewer: "reviewer.md" },
      runRole: async (request) => { calls.push(request); return options.runRole!(request); },
      phase: (text) => { phases.push(text); },
      runCommand: bashRunner,
      commit: (message) => commitAll(repo, message),
      prepareReview: async () => { await git(repo, ["add", "-N", "."]); prepared.push("review"); },
      signal: options.signal,
    }),
  };
  return h;
}

const APPROVE = "## Verdict\nAPPROVE\n";

/** A scripted role: the Builder writes `content` for the task named in the request; the Reviewer approves. */
function scripted(repo: string, builderWrites: (task: string, attempt: number) => string): RoleRunner {
  const attempts = new Map<string, number>();
  return async (request) => {
    if (request.role === "reviewer") return result(APPROVE);
    const id = /Task (t\d+)/.exec(request.task)![1];
    const attempt = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, attempt);
    const file = id === "t01" ? "a.txt" : "b.txt";
    await writeFile(join(repo, file), builderWrites(id, attempt));
    return result("built");
  };
}

describe("runQueue", () => {
  it("drives a two-task plan to done, including one red-then-green cycle", async () => {
    const h = await harness();
    const runRole = scripted(h.repo, (id, attempt) => (id === "t01" && attempt === 1 ? "bad" : "ok"));
    const summary = await h.run({ runRole });

    assert.deepEqual(summary, { kind: "idle", completed: ["t01", "t02"] });

    const state = JSON.parse(await readFile(h.statePath, "utf8"));
    assert.equal(state.tasks.t01.status, "done");
    assert.equal(state.tasks.t02.status, "done");
    assert.equal(state.tasks.t01.attempts, 2, "t01 needed a second attempt after the red run");
    assert.equal(state.tasks.t02.attempts, 1);

    const builderCalls = h.calls.filter((call) => call.role === "builder");
    assert.equal(builderCalls.length, 3);
    assert.match(builderCalls[1].task, /grep -q ok a\.txt/, "the red attempt's failing command is fed back");
    assert.match(builderCalls[1].task, /What went wrong/);
    assert.equal(h.calls.filter((call) => call.role === "reviewer").length, 2, "the reviewer only runs once tests are green");

    const log = (await git(h.repo, ["log", "--format=%s", "-3"])).trim().split("\n");
    assert.match(log[0], /foreman: t02/);
    assert.match(log[1], /foreman: t01/);
    assert.equal((await git(h.repo, ["show", "--name-only", "--format=", "HEAD~1"])).trim(), "a.txt");
    assert.equal((await git(h.repo, ["status", "--porcelain"])).trim(), "");
  });

  it("makes new files visible to the reviewer's diff before every review", async () => {
    const h = await harness();
    let seen = "";
    const runRole: RoleRunner = async (request) => {
      if (request.role === "builder") { await writeFile(join(h.repo, request.task.includes("t01") ? "a.txt" : "b.txt"), "ok"); return result("built"); }
      if (!seen) seen = await git(h.repo, ["diff", "--name-only"]);
      return result(APPROVE);
    };
    await h.run({ runRole });
    assert.equal(seen.trim(), "a.txt", "an untracked new file appears in git diff once marked intent-to-add");
    assert.equal(h.prepared.length, 2);
  });

  it("announces each phase so the operator can see what is running", async () => {
    const h = await harness("- id: t01\n  goal: g\n  success_tests: ['grep -q ok a.txt', 'true']\n");
    const summary = await h.run({ runRole: scripted(h.repo, () => "ok") });
    assert.equal(summary.kind, "idle");
    assert.deepEqual(h.phases, [
      "Builder · attempt 1/3 · local/m1",
      "Testing 1/2 · grep -q ok a.txt",
      "Testing 2/2 · true",
      "Reviewer · review 1/2 · local/m1",
      "Committing",
    ]);
  });

  it("uses one lease and zero swaps when the reviewer shares the builder's model", async () => {
    const h = await harness();
    await h.run({ runRole: scripted(h.repo, (id, attempt) => (id === "t01" && attempt === 1 ? "bad" : "ok")) });
    await h.gpu.close();
    assert.deepEqual(h.leaseCalls, ["acquire", "release"]);
    assert.equal(h.gpu.swaps, 0);
  });

  it("swaps only at builder/reviewer boundaries when models differ, never on a red cycle", async () => {
    const h = await harness();
    await h.run({ reviewerModel: "local/m2", runRole: scripted(h.repo, (id, attempt) => (id === "t01" && attempt === 1 ? "bad" : "ok")) });
    // B B R | B R  =>  m1→m2, m2→m1, m1→m2
    assert.equal(h.gpu.swaps, 3);
    await h.gpu.close();
  });

  it("gives the first request after a switch the longer model-load deadline", async () => {
    const h = await harness();
    await h.run({ reviewerModel: "local/m2", runRole: scripted(h.repo, () => "ok") });
    const byRole = (role: string) => h.calls.filter((call) => call.role === role).map((call) => call.idleTimeoutMs);
    assert.deepEqual(byRole("builder"), [120_000, 120_000], "first load, then a load after the reviewer");
    assert.deepEqual(byRole("reviewer"), [120_000, 120_000]);
    await h.gpu.close();
  });

  it("blocks after the attempt cap, stops the queue, and resumes after unblock with the owner's note", async () => {
    const h = await harness();
    const stuck = scripted(h.repo, () => "nope");
    const first = await h.run({ runRole: stuck });
    assert.equal(first.kind, "blocked");
    assert.equal(first.taskId, "t01");
    assert.match(first.reason ?? "", /3 build attempts/);
    assert.equal(h.calls.filter((call) => call.role === "builder").length, 3);
    assert.equal(JSON.parse(await readFile(h.statePath, "utf8")).tasks.t02.status, "pending", "nothing behind a blocked task runs");

    await h.store.update((state) => unblock(state, "t01", "the file must say ok"));
    const before = h.calls.length;
    const second = await h.run({ runRole: scripted(h.repo, () => "ok") });
    assert.deepEqual(second, { kind: "idle", completed: ["t01", "t02"] });
    assert.match(h.calls[before].task, /Owner note[\s\S]*the file must say ok/);
  });

  it("feeds reviewer change requests back to the builder", async () => {
    const h = await harness();
    let reviews = 0;
    const runRole: RoleRunner = async (request) => {
      if (request.role === "builder") {
        await writeFile(join(h.repo, request.task.includes("t01") ? "a.txt" : "b.txt"), "ok");
        return result("built");
      }
      reviews += 1;
      return result(reviews === 1 ? "## Verdict\nREQUEST_CHANGES\n- add a trailing newline" : APPROVE);
    };
    const summary = await h.run({ runRole });
    assert.equal(summary.kind, "idle");
    const builderCalls = h.calls.filter((call) => call.role === "builder");
    assert.match(builderCalls[1].task, /add a trailing newline/);
  });

  it("blocks when the reviewer never produces a verdict", async () => {
    const h = await harness();
    const runRole: RoleRunner = async (request) => {
      if (request.role === "builder") { await writeFile(join(h.repo, "a.txt"), "ok"); return result("built"); }
      return result("looks fine to me");
    };
    const summary = await h.run({ runRole });
    assert.equal(summary.kind, "blocked");
    assert.match(summary.reason ?? "", /verdict/i);
    assert.equal(h.calls.filter((call) => call.role === "reviewer").length, 2);
  });

  it("treats a role error as a failed attempt, not a crash", async () => {
    const h = await harness();
    let n = 0;
    const runRole: RoleRunner = async (request) => {
      if (request.role === "reviewer") return result(APPROVE);
      n += 1;
      if (n === 1) return result("", { error: "wrong or missing model: expected local/m1, got local/x", toolCount: 0 });
      await writeFile(join(h.repo, request.task.includes("t01") ? "a.txt" : "b.txt"), "ok");
      return result("built");
    };
    const summary = await h.run({ runRole });
    assert.equal(summary.kind, "idle");
    assert.match(h.calls[1].task, /wrong or missing model/);
  });

  it("stops at once when the builder cannot start, instead of burning attempts", async () => {
    const h = await harness();
    const runRole: RoleRunner = async () => result("", { exitCode: 1, toolCount: 0, error: "role exited with code 1", stderr: "mise ERROR Read-only file system" });
    const summary = await h.run({ runRole });
    assert.equal(summary.kind, "blocked");
    assert.match(summary.reason ?? "", /could not start.*Read-only file system/);
    assert.equal(h.calls.length, 1, "one launch attempt, not four");
  });

  it("blocks the task, not the process, on an unexpected error", async () => {
    const h = await harness();
    const summary = await h.run({ runRole: async () => { throw new Error("kaboom"); } });
    assert.equal(summary.kind, "blocked");
    assert.match(summary.reason ?? "", /kaboom/);
    assert.equal(JSON.parse(await readFile(h.statePath, "utf8")).tasks.t01.status, "blocked");
  });

  it("blocks with an aborted reason when the run is cancelled", async () => {
    const h = await harness();
    const controller = new AbortController();
    const runRole: RoleRunner = async () => { controller.abort(); return result("", { error: "role aborted", toolCount: 0 }); };
    const summary = await h.run({ runRole, signal: controller.signal });
    assert.equal(summary.kind, "blocked");
    assert.match(summary.reason ?? "", /aborted/);
  });

  it("does nothing while paused and resumes when unpaused", async () => {
    const h = await harness();
    await h.store.update((state) => setPaused(state, true));
    const runRole = scripted(h.repo, () => "ok");
    assert.deepEqual(await h.run({ runRole }), { kind: "paused", completed: [] });
    assert.equal(h.calls.length, 0);
  });

  it("no-op tasks (already satisfied) still complete without an empty commit", async () => {
    const h = await harness("- id: t01\n  goal: nothing to do\n  success_tests: ['true']\n");
    const runRole: RoleRunner = async (request) => result(request.role === "reviewer" ? APPROVE : "already done");
    const before = (await git(h.repo, ["rev-parse", "HEAD"])).trim();
    const summary = await h.run({ runRole });
    assert.deepEqual(summary, { kind: "idle", completed: ["t01"] });
    assert.equal((await git(h.repo, ["rev-parse", "HEAD"])).trim(), before);
  });
});

describe("reviewer failures", () => {
  const emptyReviewer = (extra: Partial<RoleResult> = {}) => result("", { toolCount: 3, stopReason: "length", ...extra });

  function builderThenReviewer(h: Harness, reviewer: RoleRunner): RoleRunner {
    return async (request) => {
      if (request.role === "reviewer") return reviewer(request);
      await writeFile(join(h.repo, request.task.includes("Task t01") ? "a.txt" : "b.txt"), "ok");
      return result("built");
    };
  }

  it("records why the reviewer produced nothing, in the log and in the block reason", async () => {
    const h = await harness();
    const summary = await h.run({ runRole: builderThenReviewer(h, async () => emptyReviewer({ durationMs: 4200, stderr: "router: model still loading" })) });
    assert.equal(summary.kind, "blocked");
    assert.match(summary.reason ?? "", /Reviewer returned no verdict in 2 attempts/);
    assert.match(summary.reason ?? "", /empty reply.*stop reason length.*3 tool calls/, "the cause is in the message itself");
    const log = await readFile(join(h.repo, "foreman/.run/logs/t01-attempt1-review-failure.txt"), "utf8");
    for (const part of ["model: local/m1", "stop reason: length", "tool calls: 3", "router: model still loading", "review 1", "review 2"]) assert.ok(log.includes(part), part);
  });

  it("says when the reviewer errored rather than answered", async () => {
    const h = await harness();
    const summary = await h.run({ runRole: builderThenReviewer(h, async () => result("", { toolCount: 0, exitCode: 1, error: "wrong or missing model: expected local/m1, got local/x" })) });
    assert.match(summary.reason ?? "", /Reviewer returned no verdict[\s\S]*wrong or missing model/);
  });

  it("tells the second review attempt what was wrong with the first", async () => {
    const h = await harness();
    const tasks: string[] = [];
    await h.run({
      runRole: builderThenReviewer(h, async (request) => {
        tasks.push(request.task);
        return tasks.length === 1 ? result("The change looks fine to me.") : result("## Verdict\nAPPROVE");
      }),
    });
    assert.ok(!/previous reply/i.test(tasks[0]));
    assert.match(tasks[1], /previous reply[\s\S]*did not contain[\s\S]*## Verdict/i);
    assert.match(tasks[1], /looks fine to me/, "it sees what it said last time");
  });

  it("after a reviewer failure, unblock retries only the review and keeps the builder's work", async () => {
    const h = await harness();
    const first = await h.run({ runRole: builderThenReviewer(h, async () => emptyReviewer()) });
    assert.equal(first.kind, "blocked");
    assert.equal(JSON.parse(await readFile(h.statePath, "utf8")).tasks.t01.stage, "review");

    await h.store.update((state) => unblock(state, "t01"));
    const builderCallsBefore = h.calls.filter((call) => call.role === "builder").length;
    const second = await h.run({ runRole: builderThenReviewer(h, async () => result(APPROVE)) });
    assert.deepEqual(second, { kind: "idle", completed: ["t01", "t02"] });
    const builderCalls = h.calls.filter((call) => call.role === "builder");
    assert.equal(builderCalls.length - builderCallsBefore, 1, "only t02 needed a builder; t01 went straight back to review");
    assert.equal(JSON.parse(await readFile(h.statePath, "utf8")).tasks.t01.stage, undefined, "the stage is cleared once used");
  });

  it("a builder failure still restarts from the builder after unblock", async () => {
    const h = await harness();
    const first = await h.run({ runRole: scripted(h.repo, () => "nope") });
    assert.equal(first.kind, "blocked");
    assert.equal(JSON.parse(await readFile(h.statePath, "utf8")).tasks.t01.stage, undefined);
  });
});
