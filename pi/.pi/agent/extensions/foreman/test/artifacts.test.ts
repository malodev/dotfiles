import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { collectArtifacts, describeArtifacts, findRecordings } from "../artifacts.ts";

async function project() {
  const repo = await mkdtemp(join(tmpdir(), "foreman-art-"));
  const results = join(repo, "test-results");
  await mkdir(join(results, "notes-add-a-note-chromium"), { recursive: true });
  await mkdir(join(results, "ui-<layout>-chromium"), { recursive: true });
  await writeFile(join(results, "notes-add-a-note-chromium/video.webm"), "VIDEO");
  await writeFile(join(results, "notes-add-a-note-chromium/test-finished-1.png"), "PNG");
  await writeFile(join(results, "ui-<layout>-chromium/trace.zip"), "ZIP");
  await writeFile(join(results, "ui-<layout>-chromium/screenshot.png"), "PNG2");
  await writeFile(join(results, ".last-run.json"), "{}");
  await writeFile(join(results, "notes-add-a-note-chromium/error-context.md"), "text, not media");
  return { repo, dest: join(repo, "foreman/.run/artifacts/t05-attempt1") };
}

describe("collectArtifacts", () => {
  it("copies videos, screenshots and traces, counts them, and skips everything else", async () => {
    const { repo, dest } = await project();
    const result = await collectArtifacts(repo, dest);
    assert.ok(result);
    assert.deepEqual({ videos: result.videos, screenshots: result.screenshots, traces: result.traces }, { videos: 1, screenshots: 2, traces: 1 });
    assert.equal((await readFile(join(dest, "notes-add-a-note-chromium/video.webm"), "utf8")), "VIDEO");
    await assert.rejects(stat(join(dest, ".last-run.json")));
    await assert.rejects(stat(join(dest, "notes-add-a-note-chromium/error-context.md")));
    assert.equal(describeArtifacts(result), "recorded 1 video, 2 screenshots, 1 trace");
  });

  it("writes an index page that shows each recording, with names escaped", async () => {
    const { repo, dest } = await project();
    await collectArtifacts(repo, dest);
    const html = await readFile(join(dest, "index.html"), "utf8");
    assert.match(html, /<video[^>]+controls[^>]+src="notes-add-a-note-chromium\/video\.webm"/);
    assert.match(html, /<img[^>]+src="notes-add-a-note-chromium\/test-finished-1\.png"/);
    assert.match(html, /href="ui-%3Clayout%3E-chromium\/trace\.zip"/, "unsafe characters in paths are encoded");
    assert.ok(html.includes("ui-&lt;layout&gt;-chromium") && !html.includes("<layout>"), "names are HTML-escaped");
    assert.match(html, /show-trace/);
  });

  it("does nothing when the tests recorded nothing", async () => {
    const repo = await mkdtemp(join(tmpdir(), "foreman-art-"));
    assert.equal(await collectArtifacts(repo, join(repo, "out")), undefined);
    await mkdir(join(repo, "test-results"));
    await writeFile(join(repo, "test-results/.last-run.json"), "{}");
    assert.equal(await collectArtifacts(repo, join(repo, "out")), undefined, "no media, no output folder");
    await assert.rejects(stat(join(repo, "out")));
  });

  it("stops copying at the size cap and says so", async () => {
    const { repo, dest } = await project();
    const result = await collectArtifacts(repo, dest, { maxBytes: 6 });
    assert.ok(result && result.skipped > 0);
    assert.match(describeArtifacts(result), /skipped \d+ over the size cap/);
    assert.ok((await readFile(join(dest, "index.html"), "utf8")).includes("skipped"));
  });
});

describe("findRecordings", () => {
  it("lists recording folders newest first and can filter by task", async () => {
    const repo = await mkdtemp(join(tmpdir(), "foreman-art-"));
    const root = join(repo, "foreman/.run/artifacts");
    for (const [name, time] of [["t01-attempt1", 1000], ["t05-attempt1", 3000], ["t05-attempt2", 2000]] as const) {
      await mkdir(join(root, name), { recursive: true });
      await writeFile(join(root, name, "index.html"), "x");
      const { utimes } = await import("node:fs/promises");
      await utimes(join(root, name, "index.html"), time, time);
    }
    await mkdir(join(root, "broken"), { recursive: true }); // no index.html: ignored
    assert.deepEqual((await findRecordings(repo)).map((entry) => entry.name), ["t05-attempt1", "t05-attempt2", "t01-attempt1"]);
    assert.deepEqual((await findRecordings(repo, "t01")).map((entry) => entry.name), ["t01-attempt1"]);
    assert.deepEqual(await findRecordings(await mkdtemp(join(tmpdir(), "foreman-art-"))), []);
    assert.ok((await readdir(root)).includes("broken"));
  });
});
