import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Preview, realPreviewDeps } from "../preview.ts";
import { spawnSandboxedApp } from "../sandbox.ts";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

async function body(port: number): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      return await (await fetch(`http://127.0.0.1:${port}/`)).text();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("preview never answered");
}

async function until(check: () => Promise<boolean>, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("condition not reached in time");
}

describe("live preview (real watcher, real sandbox, real HTTP)", () => {
  it("shows the Builder's saved changes: static files on the next request, server code after a restart, and keeps the data dir", async () => {
    const repo = await mkdtemp(join(process.env.HOME ?? tmpdir(), ".foreman-test-"));
    const port = await freePort();
    const notes: string[] = [];
    try {
      await mkdir(join(repo, "public"), { recursive: true });
      await writeFile(join(repo, "public/page.txt"), "page v1");
      await writeFile(join(repo, "server.js"), `const http=require("http"),fs=require("fs"),path=require("path");
const file=path.join(process.env.DATA_DIR,"visits.txt");
http.createServer((q,r)=>{ const n=(fs.existsSync(file)?+fs.readFileSync(file,"utf8"):0)+1; fs.writeFileSync(file,String(n));
  r.end("server v1|"+fs.readFileSync("public/page.txt","utf8")+"|visit "+n) }).listen(process.env.PORT,"127.0.0.1");`);
      const preview = new Preview(repo, { command: "node server.js", port, env: { PORT: "{port}", DATA_DIR: "{data}" } }, {
        ...realPreviewDeps,
        start: (command, options) => spawnSandboxedApp(command, options),
        notify: (message) => notes.push(message),
        debounceMs: 150,
      });
      await preview.start();
      try {
        assert.equal(await body(port), "server v1|page v1|visit 1");

        await writeFile(join(repo, "public/page.txt"), "page v2");
        assert.equal(await body(port), "server v1|page v2|visit 2", "a saved static file shows on the next request, and the data dir persisted");

        await writeFile(join(repo, "server.js"), (await import("node:fs/promises").then((fs) => fs.readFile(join(repo, "server.js"), "utf8"))).replace("server v1", "server v2"));
        await until(async () => (await body(port)).startsWith("server v2|"));
        assert.match(await body(port), /^server v2\|page v2\|visit \d+$/, "saved server code takes effect after the automatic restart");
        assert.ok(Number((await body(port)).split("visit ")[1]) > 2, "visit count continued: the data dir survived the restart");

        // Noise in ignored places must not cause restarts.
        const before = await body(port);
        await mkdir(join(repo, "node_modules/x"), { recursive: true });
        await writeFile(join(repo, "node_modules/x/index.js"), "ignored");
        await new Promise((resolve) => setTimeout(resolve, 600));
        assert.equal(Number((await body(port)).split("visit ")[1]), Number(before.split("visit ")[1]) + 1, "no restart, the counter only advanced by our own request");
      } finally {
        await preview.stop();
      }
      await assert.rejects(fetch(`http://127.0.0.1:${port}/`), "stopped");
      assert.deepEqual(notes, [], "no warnings during a healthy session");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
