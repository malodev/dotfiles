/**
 * Direct tests for git.ts's four capability axes.
 *
 * Every one of these is exercised indirectly by the wider suite — env via
 * plan-import's private-index tree build, Buffer output via blob comparison
 * and NUL parsing, stdin via the one `--pathspec-file-nul` site, no-throw via
 * plan-import's recovery probes. Testing them here means a regression reports
 * itself as "git.ts doesn't forward env" rather than as a confusing failure
 * three modules away.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { git, gitText, gitTextOrEmpty } from "./git.ts";

async function repoFixture(): Promise<string> {
  const repo = await mkdtemp(resolve(tmpdir(), "three-agent-git-unit-"));
  await gitText(repo, ["init", "-q"], "init");
  await gitText(repo, ["config", "user.name", "Test"], "config name");
  await gitText(repo, ["config", "user.email", "test@test"], "config email");
  await writeFile(resolve(repo, "README.md"), "# Test\n");
  await gitText(repo, ["add", "README.md"], "add");
  await gitText(repo, ["commit", "-qm", "initial"], "commit");
  return repo;
}

test("git returns the exit code without throwing, and gitText throws with its label and stderr", async () => {
  const repo = await repoFixture();

  const ok = await git(repo, ["rev-parse", "HEAD"]);
  assert.equal(ok.code, 0);
  assert.match(ok.stdout.toString("utf8").trim(), /^[0-9a-f]{40}$/);

  // A failing command resolves rather than rejecting — callers branch on code.
  const bad = await git(repo, ["rev-parse", "--verify", "refs/heads/does-not-exist"]);
  assert.notEqual(bad.code, 0);
  assert.equal(bad.stdout.toString("utf8").trim(), "");

  await assert.rejects(
    gitText(repo, ["rev-parse", "--verify", "refs/heads/does-not-exist"], "Cannot resolve branch"),
    /^Error: Cannot resolve branch: /,
  );
});

test("gitTextOrEmpty yields \"\" for a nonzero exit and trimmed stdout otherwise", async () => {
  const repo = await repoFixture();
  assert.equal(await gitTextOrEmpty(repo, ["rev-parse", "-q", "--verify", "refs/heads/nope"]), "");
  assert.match(await gitTextOrEmpty(repo, ["rev-parse", "HEAD"]), /^[0-9a-f]{40}$/);
});

test("stdout is a Buffer that preserves exact bytes for blob comparison and NUL-separated output", async () => {
  const repo = await repoFixture();
  // Bytes that would be mangled by a lossy decode round-trip.
  const bytes = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x0a, 0x42]);
  await writeFile(resolve(repo, "binary.bin"), bytes);
  await gitText(repo, ["add", "binary.bin"], "add binary");
  await gitText(repo, ["commit", "-qm", "add binary"], "commit binary");

  const blob = await git(repo, ["cat-file", "blob", "HEAD:binary.bin"]);
  assert.equal(blob.code, 0);
  assert.ok(blob.stdout.equals(await readFile(resolve(repo, "binary.bin"))), "blob bytes must survive verbatim");

  // -z output is NUL-separated; splitting requires the raw buffer.
  const names = await git(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD~1", "HEAD"]);
  assert.equal(names.code, 0);
  const paths = names.stdout.toString("utf8").split("\0").filter(Boolean);
  assert.deepEqual(paths, ["binary.bin"]);
});

test("options.input is written to git's stdin", async () => {
  const repo = await repoFixture();
  await writeFile(resolve(repo, "staged-via-stdin.txt"), "content\n");

  const added = await git(repo, ["add", "--pathspec-from-file=-", "--pathspec-file-nul"], {
    input: Buffer.from("staged-via-stdin.txt\0"),
  });
  assert.equal(added.code, 0, added.stderr.toString("utf8"));

  const staged = await gitText(repo, ["diff", "--cached", "--name-only"], "list staged");
  assert.equal(staged, "staged-via-stdin.txt");
});

test("options.env is merged over process.env, so GIT_INDEX_FILE builds a private index", async () => {
  const repo = await repoFixture();
  const privateIndex = resolve(repo, ".git", "private-index");
  await writeFile(resolve(repo, "only-in-private.txt"), "private\n");

  // Seed the private index from HEAD, then stage a file into it alone.
  await gitText(repo, ["read-tree", `--index-output=${privateIndex}`, "HEAD"], "seed private index");
  await gitText(repo, ["add", "only-in-private.txt"], "stage into private index", { env: { GIT_INDEX_FILE: privateIndex } });
  const privateTree = await gitText(repo, ["write-tree"], "write private tree", { env: { GIT_INDEX_FILE: privateIndex } });

  // The real index must be untouched — proving env was scoped to those calls.
  assert.equal(await gitText(repo, ["diff", "--cached", "--name-only"], "real index"), "");
  const privateNames = await gitText(repo, ["ls-tree", "--name-only", privateTree], "list private tree");
  assert.ok(privateNames.split("\n").includes("only-in-private.txt"), `private tree should contain the staged file, got: ${privateNames}`);

  // Merging (not replacing) process.env is what keeps git usable at all here —
  // a bare env would drop PATH and HOME.
  assert.equal((await git(repo, ["rev-parse", "HEAD"], { env: { GIT_INDEX_FILE: privateIndex } })).code, 0);
});
