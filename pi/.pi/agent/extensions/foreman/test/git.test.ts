import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { commitAll, currentBranch, dirtyOutsideForeman, ensureWorkBranch, git, headSha } from "../git.ts";
import { tempRepo } from "./helpers.ts";

describe("git adapter", () => {
  it("runs argv-only commands and reports failures with their output", async () => {
    const repo = await tempRepo();
    assert.equal(await currentBranch(repo), "main");
    await assert.rejects(git(repo, ["checkout", "no-such-branch"]), /no-such-branch/);
    // Shell metacharacters in an argument are data, not syntax.
    await git(repo, ["commit", "--allow-empty", "-q", "-m", "a; touch pwned"]);
    assert.equal((await git(repo, ["log", "-1", "--format=%s"])).trim(), "a; touch pwned");
  });

  it("creates the work branch once and reuses it", async () => {
    const repo = await tempRepo();
    const first = await ensureWorkBranch(repo, "run1");
    assert.equal(first.branch, "foreman/run1");
    assert.equal(await currentBranch(repo), "foreman/run1");
    const again = await ensureWorkBranch(repo, "run2");
    assert.equal(again.branch, "foreman/run1", "an existing foreman/* branch is reused");
  });

  it("ignores the foreman runtime dir and refuses other uncommitted changes", async () => {
    const repo = await tempRepo();
    await ensureWorkBranch(repo, "r");
    await mkdir(join(repo, "foreman/.run"), { recursive: true });
    await writeFile(join(repo, "foreman/.run/state.json"), "{}");
    assert.deepEqual(await dirtyOutsideForeman(repo), [], "runtime files never count as dirty");
    await writeFile(join(repo, "foreman/tasks.yaml"), "- id: a\n");
    assert.deepEqual(await dirtyOutsideForeman(repo), [], "plan files are allowed");
    await writeFile(join(repo, "stray.txt"), "x");
    assert.deepEqual(await dirtyOutsideForeman(repo), ["stray.txt"]);
  });

  it("commitAll commits changes and never includes runtime files", async () => {
    const repo = await tempRepo();
    await ensureWorkBranch(repo, "r");
    await mkdir(join(repo, "foreman/.run"), { recursive: true });
    await writeFile(join(repo, "foreman/.run/state.json"), "{}");
    await writeFile(join(repo, "a.txt"), "a");
    const before = await headSha(repo);
    const result = await commitAll(repo, "foreman: t01");
    assert.equal(result.empty, false);
    assert.notEqual(result.sha, before);
    const files = (await git(repo, ["show", "--name-only", "--format=", "HEAD"])).trim().split("\n");
    assert.deepEqual(files, ["a.txt"]);
  });

  it("commitAll on a clean tree is a no-op that reports empty", async () => {
    const repo = await tempRepo();
    await ensureWorkBranch(repo, "r");
    const before = await headSha(repo);
    const result = await commitAll(repo, "foreman: nothing");
    assert.deepEqual(result, { sha: before, empty: true });
  });
});

import { commitPaths } from "../git.ts";

describe("commitPaths", () => {
  it("commits only the named files and skips missing or unchanged ones", async () => {
    const repo = await tempRepo();
    await ensureWorkBranch(repo, "r");
    await mkdir(join(repo, "foreman"), { recursive: true });
    await writeFile(join(repo, "foreman/tasks.yaml"), "- id: a\n");
    await writeFile(join(repo, "other.txt"), "x");
    const sha = await commitPaths(repo, ["foreman/plan.md", "foreman/tasks.yaml"], "foreman: plan");
    assert.ok(sha);
    assert.equal((await git(repo, ["show", "--name-only", "--format=", "HEAD"])).trim(), "foreman/tasks.yaml");
    assert.deepEqual(await dirtyOutsideForeman(repo), ["other.txt"], "unrelated work is left alone");
    assert.equal(await commitPaths(repo, ["foreman/tasks.yaml"], "again"), undefined);
    assert.equal(await commitPaths(repo, ["foreman/nope.md"], "none"), undefined);
  });
});
