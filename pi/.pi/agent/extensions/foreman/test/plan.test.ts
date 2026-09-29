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
import { emptyState, markBlocked, markDone, syncTasks } from "../state.ts";
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

import { finalBoard, progressBoard } from "../report.ts";

describe("boards", () => {
  const plain = (lines: string[]) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");

  it("progress board names the task, count and how to pause or stop", () => {
    const board = progressBoard({ done: 2, total: 7, taskId: "t03-add", activity: "t03-add: build attempt 2/4" });
    assert.match(plain(board.lines), /2\/7 done · working on t03-add[\s\S]*build attempt 2\/4[\s\S]*\/foreman pause/);
    assert.equal(board.final, false);
    assert.match(board.title, /2\/7 t03-add/);
  });

  it("final boards say what happened and what to do next", () => {
    const done = finalBoard({ kind: "idle" }, 7, 7, "foreman/x");
    assert.match(plain(done.lines), /finished: all 7 task\(s\) done[\s\S]*git log --oneline main\.\.foreman\/x/);
    assert.ok(done.final && /done 7\/7/.test(done.title));
    const blocked = finalBoard({ kind: "blocked", taskId: "t04", reason: "used 4 build attempts" }, 7, 3, "b");
    assert.match(plain(blocked.lines), /blocked on t04 {2}\(3\/7 done\)[\s\S]*used 4 build attempts[\s\S]*\/foreman unblock t04/);
    assert.match(plain(finalBoard({ kind: "paused" }, 7, 3, "b").lines), /paused: 3\/7 done/);
  });
});
