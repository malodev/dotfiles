import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkFile } from "../check.ts";
import { architectKickoff, resolvePlanInput } from "../plan.ts";
import { formatStatus } from "../report.ts";
import { emptyState, markBlocked, markDone, markRunning, setAttempts, syncTasks } from "../state.ts";
import { loadTasks } from "../tasks.ts";
import { parseAgentMarkdown } from "../agents.ts";
import { readFile } from "node:fs/promises";

describe("resolvePlanInput", () => {
  it("treats an existing single-token path as a PRD and anything else as an idea", async () => {
    const dir = await mkdtemp(join(tmpdir(), "foreman-plan-"));
    await writeFile(join(dir, "prd.md"), "# PRD");
    assert.deepEqual(await resolvePlanInput("prd.md", dir), { kind: "prd", path: join(dir, "prd.md") });
    assert.deepEqual(await resolvePlanInput("a todo app with tags", dir), { kind: "idea", text: "a todo app with tags" });
    assert.deepEqual(await resolvePlanInput("nonexistent.md", dir), { kind: "idea", text: "nonexistent.md" });
    await assert.rejects(resolvePlanInput("   ", dir), /Usage/);
  });

  it("kickoff carries the source and the exact check command", () => {
    assert.match(architectKickoff({ kind: "idea", text: "a cli" }, "node check.ts x"), /a cli[\s\S]*node check\.ts x/);
    assert.match(architectKickoff({ kind: "prd", path: "/p/prd.md" }, "c"), /PRD at \/p\/prd\.md/);
  });
});

describe("check", () => {
  it("reports errors and success, and works as a CLI with exit codes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "foreman-check-"));
    const good = join(dir, "good.yaml");
    const bad = join(dir, "bad.yaml");
    await writeFile(good, "- id: a\n  goal: g\n  success_tests: [npm test]\n");
    await writeFile(bad, "- id: a\n  goal: g\n  success_tests: [TODO]\n");
    assert.deepEqual(await checkFile(good), { ok: true, report: "OK: 1 task(s): a" });
    const result = await checkFile(bad);
    assert.equal(result.ok, false);
    assert.match(result.report, /placeholder/);
    assert.equal((await checkFile(join(dir, "missing.yaml"))).ok, false);

    const script = fileURLToPath(new URL("../check.ts", import.meta.url));
    // Reached through a symlink, as the extension is via ~/.pi -> dotfiles: must still report.
    const linked = join(dir, "linked-check.ts");
    await symlink(script, linked);
    assert.match(execFileSync("node", [linked, good], { encoding: "utf8" }), /^OK/);
    assert.throws(() => execFileSync("node", [linked, bad], { stdio: "pipe" }), (error: any) => error.status === 1 && /placeholder/.test(String(error.stdout)));
    assert.match(execFileSync("node", [script, good], { encoding: "utf8" }), /^OK/);
    assert.throws(() => execFileSync("node", [script, bad], { stdio: "pipe" }), (error: any) => error.status === 1 && /placeholder/.test(String(error.stdout)));
  });
});

describe("formatStatus", () => {
  const tasks = loadTasks("- id: a\n  goal: g\n  success_tests: [x1]\n- id: b\n  goal: g\n  success_tests: [x2]\n").tasks;
  it("shows progress, commit, and the blocking reason", () => {
    let state = syncTasks(emptyState(), tasks);
    state = markDone(state, "a", "0123456789abcdef");
    state = markBlocked(state, "b", "used 4 build attempts");
    const text = formatStatus(tasks, { ...state, paused: true, branch: "foreman/r1" });
    assert.match(text, /1\/2 done · paused · branch foreman\/r1/);
    assert.match(text, /✔ a\s+done \(01234567\)/);
    assert.match(text, /✖ b\s+blocked\n\s+used 4 build attempts/);
  });
  it("points at /foreman plan when there is no plan", () => {
    assert.match(formatStatus([], emptyState()), /\/foreman plan/);
  });
});

describe("agent prompt files", () => {
  it("each role prompt parses and declares tools appropriate to its role", async () => {
    const load = async (name: string) => parseAgentMarkdown(await readFile(fileURLToPath(new URL(`../agents/${name}.md`, import.meta.url)), "utf8"));
    const builder = await load("builder");
    const reviewer = await load("reviewer");
    const architect = await load("architect");
    assert.match(builder.tools ?? "", /edit/);
    assert.ok(!/edit|write/.test(reviewer.tools ?? ""), "reviewer has no mutation tools");
    assert.match(architect.tools ?? "", /write/);
    assert.match(reviewer.body, /## Verdict/);
    assert.match(architect.body, /tasks\.yaml/);
  });
});

describe("architectKickoff role instructions", () => {
  it("puts the role instructions before the request when given", () => {
    const text = architectKickoff({ kind: "idea", text: "a cli" }, "check", "You are the Architect.");
    assert.ok(text.indexOf("You are the Architect.") < text.indexOf("a cli"));
    assert.ok(!architectKickoff({ kind: "idea", text: "a cli" }, "check").includes("# Your role"));
  });
});

import { finalBoard, formatElapsed, progressBoard } from "../report.ts";

describe("panel", () => {
  const strip = (lines: string[]) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  const width = (line: string) => [...line.replace(/\x1b\[[0-9;]*m/g, "")].length;
  const NOW = 1_000_000_000_000;

  function scenario(overrides: Partial<Parameters<typeof progressBoard>[0]> = {}, statuses: Record<string, "done" | "running" | "blocked" | "pending"> = {}) {
    const ids = ["t01-scaffold", "t02-store", "t03-api", "t04-static-shell", "t05-playwright-shell", "t06-render", "t07-add-note", "t08-edit-delete"];
    const tasks = ids.map((id) => ({ id, goal: `Goal of ${id}. It has a second sentence that should not show.`, dependsOn: [], files: [], successTests: id === "t05-playwright-shell" ? ["npm test", "npx playwright test"] : ["npm test"] }));
    let state = syncTasks(emptyState(), tasks);
    const plan = { t01: "done", t02: "done", t03: "done", t04: "done", t05: "running", ...statuses } as Record<string, string>;
    for (const task of tasks) {
      const key = task.id.slice(0, 3);
      const status = plan[key] ?? "pending";
      if (status === "done") state = markDone(state, task.id, "abc12345");
      else if (status === "running") state = markRunning(state, task.id);
      else if (status === "blocked") state = markBlocked(state, task.id, "used 4 build attempts");
    }
    state = setAttempts(state, "t05-playwright-shell", 2);
    return { title: "Notes app", run: "running" as const, tasks, state, currentId: "t05-playwright-shell", maxAttempts: 4, phase: "Testing 2/2 · npx playwright test", detail: "3 passed (12s)", runStartedAt: NOW - 3_725_000, phaseStartedAt: NOW - 80_000, now: NOW, branch: "foreman/20260930", files: ["foreman/tasks.yaml", "foreman/.run/logs"], ...overrides };
  }

  it("draws a box that never exceeds the terminal width, at any width", () => {
    for (const w of [40, 60, 80, 100, 140]) {
      const board = progressBoard(scenario());
      const lines = board.render(w);
      assert.ok(lines.length > 6);
      for (const line of lines) assert.ok(width(line) <= Math.min(w, 110), `width ${w}: ${width(line)} > limit in "${line}"`);
      assert.equal(new Set(lines.map(width)).size, 1, `all rows of the box have the same width at ${w}`);
    }
  });

  it("shows title, state, run time, counts, progress bar, current task, phase, detail and verify commands", () => {
    const text = strip(progressBoard(scenario({ previewUrl: "http://127.0.0.1:4173" })).render(100));
    for (const part of ["foreman", "Notes app", "running", "1h02m", "✓4 done", "4 open", "█", "░", "Now", "Testing 2/2 · npx playwright test · 1m20s", "› 3 passed (12s)", "Verify", "npm test · npx playwright test", "Preview", "http://127.0.0.1:4173", "File", "foreman/tasks.yaml", "/foreman pause", "/foreman stop"]) {
      assert.ok(text.includes(part), `missing "${part}" in:\n${text}`);
    }
  });

  it("marks tasks with icons, shows attempts on the current one, and trims goals to their first sentence", () => {
    const text = strip(progressBoard(scenario()).render(100));
    assert.match(text, /✓ t03-api\s+Goal of t03-api\./);
    assert.match(text, /▸ t05-playwright-shell\s+Goal of t05-playwright-shell\..*attempt 2\/4/);
    assert.match(text, /· t06-render/);
    assert.ok(!text.includes("second sentence"));
  });

  it("collapses a long list around the current task with a '+N' marker", () => {
    const text = strip(progressBoard(scenario({ maxRows: 5 })).render(100));
    assert.match(text, /… \+\d+ earlier · \+\d+ more|… \+\d+ more|… \+\d+ earlier/);
    assert.ok(text.includes("▸ t05-playwright-shell"), "the current task is always visible");
    const rows = text.split("\n").filter((line) => /^│ [✓▸·✖] /.test(line));
    assert.ok(rows.length <= 4);
    const all = strip(progressBoard(scenario({ maxRows: 20 })).render(100));
    assert.equal(all.split("\n").filter((line) => /^│ [✓▸·✖] /.test(line)).length, 8);
    assert.ok(!/… \+\d/.test(all));
  });

  it("a blocked run says why and what to type, and shows the failing task", () => {
    const board = finalBoard(scenario({ run: "blocked", blocked: { taskId: "t05-playwright-shell", reason: "used 4 build attempts without an approved result" } }, { t05: "blocked" }));
    const text = strip(board.render(100));
    assert.match(text, /blocked/);
    assert.match(text, /✖ t05-playwright-shell/);
    assert.match(text, /used 4 build attempts without an approved result/);
    assert.match(text, /\/foreman unblock t05-playwright-shell \[note\]/);
    assert.ok(board.final && /blocked t05-playwright-shell/.test(board.title));
  });

  it("wraps a long block reason over two lines instead of cutting it off early", () => {
    const reason = "Reviewer returned no verdict in 2 attempts (last: empty reply (stop reason length, 3 tool calls)); details: t05-attempt1-review-failure.txt";
    const lines = finalBoard(scenario({ run: "blocked", blocked: { taskId: "t05-playwright-shell", reason } }, { t05: "blocked" })).render(100);
    const text = strip(lines);
    assert.ok(text.includes("(last: empty reply (stop reason length"), "the cause is visible on the first line");
    assert.ok(text.includes("calls)); details: t05-attempt1-review-failure.txt"), "and the rest, including the file to read, on the next");
    for (const line of lines) assert.ok(width(line) <= 100);
  });

  it("a finished run points at the branch to review and keeps the preview link", () => {
    const allDone = Object.fromEntries(["t01", "t02", "t03", "t04", "t05", "t06", "t07", "t08"].map((key) => [key, "done" as const]));
    const board = finalBoard(scenario({ run: "finished", previewUrl: "http://127.0.0.1:4173", currentId: undefined }, allDone));
    const text = strip(board.render(100));
    assert.match(text, /finished/);
    assert.match(text, /✓8 done/);
    assert.match(text, /git log --oneline main\.\.foreman\/20260930/);
    assert.match(text, /http:\/\/127\.0\.0\.1:4173/);
    assert.ok(board.final && /done 8\/8/.test(board.title));
  });

  it("a paused run says how to continue", () => {
    const text = strip(finalBoard(scenario({ run: "paused", currentId: undefined })).render(100));
    assert.match(text, /paused/);
    assert.match(text, /\/foreman run/);
  });

  it("progress boards are not final and put the phase in the terminal title", () => {
    const board = progressBoard(scenario());
    assert.equal(board.final, false);
    assert.match(board.title, /foreman ▶ 4\/8 t05-playwright-shell · Testing 2\/2/);
  });
});

describe("formatElapsed", () => {
  it("is compact and readable", () => {
    assert.equal(formatElapsed(0), "0s");
    assert.equal(formatElapsed(45_400), "45s");
    assert.equal(formatElapsed(65_000), "1m05s");
    assert.equal(formatElapsed(3_725_000), "1h02m");
  });
});

describe("check validates preview.json next to tasks.yaml", () => {
  it("reports a bad preview.json and stays quiet when there is none", async () => {
    const dir = await mkdtemp(join(tmpdir(), "foreman-check-"));
    const tasks = join(dir, "tasks.yaml");
    await writeFile(tasks, "- id: a\n  goal: g\n  success_tests: [npm test]\n");
    assert.equal((await checkFile(tasks)).ok, true);
    await writeFile(join(dir, "preview.json"), '{"command":"npm start","port":80}');
    const bad = await checkFile(tasks);
    assert.equal(bad.ok, false);
    assert.match(bad.report, /preview\.json[\s\S]*port/);
    await writeFile(join(dir, "preview.json"), '{"command":"npm start","port":4173}');
    const good = await checkFile(tasks);
    assert.equal(good.ok, true);
    assert.match(good.report, /OK: 1 task\(s\)[\s\S]*preview\.json OK/);
  });
});

describe("the Architect prompt stays small", () => {
  const load = async (name: string) => readFile(fileURLToPath(new URL(`../agents/${name}.md`, import.meta.url)), "utf8");

  it("the always-on prompt has a size budget, so it cannot quietly grow back into a reasoning trap", async () => {
    const body = parseAgentMarkdown(await load("architect")).body;
    assert.ok(body.length <= 3200, `architect.md is ${body.length} chars (~${Math.round(body.length / 4)} tokens); keep it under 3200`);
    const rules = body.split("\n").filter((line) => /^- /.test(line)).length;
    assert.ok(rules <= 10, `architect.md has ${rules} bullet rules; keep it to 10 or fewer`);
  });

  it("tells the Architect to write first and let the check find mistakes, instead of rehearsing", async () => {
    const body = parseAgentMarkdown(await load("architect")).body;
    assert.match(body, /Do not (draft|rehearse)[\s\S]*check/i);
  });

  it("keeps web-app rules out of the always-on prompt and in a guide read on demand", async () => {
    const core = parseAgentMarkdown(await load("architect")).body;
    const web = parseAgentMarkdown(await load("architect-web")).body;
    for (const word of ["preview.json", "video", "webServer", "Playwright"]) {
      assert.ok(!core.includes(word), `"${word}" belongs in the web guide`);
      assert.ok(web.includes(word), `the web guide must cover "${word}"`);
    }
  });

  it("the kickoff points at the web guide only as something to read when there is a UI", () => {
    const text = architectKickoff({ kind: "idea", text: "a notes app" }, "check", "ROLE", [], "/ext/agents/architect-web.md");
    assert.match(text, /web UI[\s\S]*read \/ext\/agents\/architect-web\.md/i);
    assert.ok(!architectKickoff({ kind: "idea", text: "x" }, "check", "ROLE").includes("architect-web"));
  });
});

describe("check requires a preview for browser-tested apps", () => {
  it("fails with instructions when Playwright tests have no preview.json, and passes with one or without Playwright", async () => {
    const dir = await mkdtemp(join(tmpdir(), "foreman-check-"));
    const tasks = join(dir, "tasks.yaml");
    await writeFile(tasks, "- id: a\n  goal: g\n  success_tests: [npm test, npx playwright test]\n");
    const missing = await checkFile(tasks);
    assert.equal(missing.ok, false);
    assert.match(missing.report, /Playwright[\s\S]*preview\.json[\s\S]*architect-web\.md/);
    await writeFile(join(dir, "preview.json"), '{"command":"node server.js","port":4173}');
    assert.equal((await checkFile(tasks)).ok, true);
    const plain = await mkdtemp(join(tmpdir(), "foreman-check-"));
    await writeFile(join(plain, "tasks.yaml"), "- id: a\n  goal: g\n  success_tests: [npm test]\n");
    assert.equal((await checkFile(join(plain, "tasks.yaml"))).ok, true);
  });
});
