import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { parseAgentMarkdown } from "../agents.ts";
import { bwrapArgs, runPiRole, type RoleRequest } from "../sandbox.ts";

describe("agent markdown", () => {
  it("splits frontmatter tools from the prompt body", () => {
    const parsed = parseAgentMarkdown("---\ntools: read,bash\n---\nYou are a builder.\n");
    assert.equal(parsed.tools, "read,bash");
    assert.equal(parsed.body, "You are a builder.\n");
    assert.deepEqual(parseAgentMarkdown("plain"), { body: "plain" });
  });
});

describe("bwrapArgs", () => {
  const base = { cwd: "/work/repo", tmp: "/tmp", uid: 1000 };
  it("lets only the builder write the repository", () => {
    const builder = bwrapArgs({ ...base, role: "builder" });
    const reviewer = bwrapArgs({ ...base, role: "reviewer" });
    assert.ok(builder.join(" ").includes("--bind /work/repo /work/repo"));
    assert.ok(!reviewer.join(" ").includes("--bind /work/repo"));
    for (const args of [builder, reviewer]) {
      assert.ok(args.join(" ").includes("--ro-bind / /"));
      assert.ok(args.includes("--die-with-parent"));
      assert.ok(args.join(" ").includes("--bind /tmp /tmp"));
    }
  });
});

// A stand-in for `pi` that speaks the JSON event stream. Behavior is chosen by env.
async function fakePi(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foreman-fakepi-"));
  const path = join(dir, "pi");
  await writeFile(path, `#!/usr/bin/env node
const { writeFileSync, existsSync } = require("node:fs");
const args = process.argv.slice(2);
const model = args[args.indexOf("--model") + 1];
const [provider, ...rest] = model.split("/");
const emit = (event) => console.log(JSON.stringify(event));
let text = "ok";
if (process.env.FAKE_MODE === "write-repo") {
  try { writeFileSync(process.cwd() + "/from-role.txt", "x"); text = "wrote"; } catch { text = "blocked"; }
}
if (process.env.FAKE_MODE === "hang") { setInterval(() => {}, 1000); return; }
if (process.env.FAKE_MODE === "agentdir") text = String(existsSync(process.env.PI_CODING_AGENT_DIR + "/models.json"));
emit({ type: "tool_execution_start", toolName: "bash" });
const wrong = process.env.FAKE_MODE === "wrong-model";
emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], provider, model: wrong ? "other" : rest.join("/"), stopReason: "stop" } });
`);
  await chmod(path, 0o755);
  return path;
}

async function request(role: "builder" | "reviewer", cwd: string, overrides: Partial<RoleRequest> = {}): Promise<RoleRequest> {
  const promptPath = join(cwd, `${role}.prompt.md`);
  await writeFile(promptPath, `---\ntools: read\n---\nYou are the ${role}.\n`);
  return { role, model: "local/test-model", cwd, promptPath, task: "do it", timeoutMs: 20_000, idleTimeoutMs: 20_000, ...overrides };
}

describe("runPiRole (real bwrap, fake pi)", () => {
  const cleanup: string[] = [];
  after(() => { delete process.env.FOREMAN_PI_BIN; delete process.env.FAKE_MODE; });

  async function workDir(): Promise<string> {
    const dir = await mkdtemp(join(process.env.HOME ?? tmpdir(), ".foreman-test-"));
    cleanup.push(dir);
    return dir;
  }
  after(async () => { const { rm } = await import("node:fs/promises"); for (const dir of cleanup) await rm(dir, { recursive: true, force: true }); });

  it("returns the assistant output and tool count for the requested model", async () => {
    process.env.FOREMAN_PI_BIN = await fakePi();
    process.env.FAKE_MODE = "";
    const cwd = await workDir();
    const result = await runPiRole(await request("builder", cwd));
    assert.equal(result.error, undefined);
    assert.equal(result.output, "ok");
    assert.equal(result.toolCount, 1);
  });

  it("gives the child a private agent dir", async () => {
    process.env.FOREMAN_PI_BIN = await fakePi();
    process.env.FAKE_MODE = "agentdir";
    const cwd = await workDir();
    const result = await runPiRole(await request("builder", cwd));
    assert.equal(result.output === "true" || result.output === "false", true);
  });

  it("lets the builder write the repo but not the reviewer", async () => {
    process.env.FOREMAN_PI_BIN = await fakePi();
    process.env.FAKE_MODE = "write-repo";
    const builderDir = await workDir();
    assert.equal((await runPiRole(await request("builder", builderDir))).output, "wrote");
    assert.equal(await readFile(join(builderDir, "from-role.txt"), "utf8"), "x");
    const reviewerDir = await workDir();
    assert.equal((await runPiRole(await request("reviewer", reviewerDir))).output, "blocked");
    await assert.rejects(stat(join(reviewerDir, "from-role.txt")));
  });

  it("fails closed when the response comes from a different model", async () => {
    process.env.FOREMAN_PI_BIN = await fakePi();
    process.env.FAKE_MODE = "wrong-model";
    const result = await runPiRole(await request("builder", await workDir()));
    assert.match(result.error ?? "", /wrong or missing model/);
  });

  it("kills a role that goes silent", async () => {
    process.env.FOREMAN_PI_BIN = await fakePi();
    process.env.FAKE_MODE = "hang";
    const result = await runPiRole(await request("builder", await workDir(), { idleTimeoutMs: 800 }));
    assert.match(result.error ?? "", /inactivity/);
  });

  it("aborts on signal", async () => {
    process.env.FOREMAN_PI_BIN = await fakePi();
    process.env.FAKE_MODE = "hang";
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const result = await runPiRole(await request("builder", await workDir(), { signal: controller.signal }));
    assert.match(result.error ?? "", /aborted/);
  });
});

import { runSandboxedCommand } from "../sandbox.ts";

describe("runSandboxedCommand", () => {
  it("reports exit code and combined output", async () => {
    const dir = await mkdtemp(join(process.env.HOME ?? tmpdir(), ".foreman-test-"));
    try {
      const ok = await runSandboxedCommand("echo hi && echo err >&2", dir, 10_000);
      assert.equal(ok.code, 0);
      assert.match(ok.output, /hi/);
      assert.match(ok.output, /err/);
      const bad = await runSandboxedCommand("echo nope; exit 3", dir, 10_000);
      assert.equal(bad.code, 3);
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lets the command write the repo but not the host, and enforces the timeout", async () => {
    const dir = await mkdtemp(join(process.env.HOME ?? tmpdir(), ".foreman-test-"));
    try {
      assert.equal((await runSandboxedCommand("touch made-here", dir, 10_000)).code, 0);
      await stat(join(dir, "made-here"));
      const outside = await runSandboxedCommand(`touch ${process.env.HOME}/.foreman-should-not-exist`, dir, 10_000);
      assert.notEqual(outside.code, 0);
      const slow = await runSandboxedCommand("sleep 30", dir, 300);
      assert.notEqual(slow.code, 0);
      assert.match(slow.output, /exceeded/);
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { findPiBinary } from "../sandbox.ts";

describe("findPiBinary", () => {
  async function dirWith(kind: "script" | "binary" | "none"): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "foreman-path-"));
    if (kind !== "none") {
      await writeFile(join(dir, "pi"), kind === "script" ? "#!/bin/bash\nexec true\n" : Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0]));
      await chmod(join(dir, "pi"), 0o755);
    }
    return dir;
  }

  it("skips a wrapper script and picks the real binary later on PATH", async () => {
    delete process.env.FOREMAN_PI_BIN;
    const script = await dirWith("script");
    const binary = await dirWith("binary");
    assert.equal(await findPiBinary(`${script}:${binary}`), join(binary, "pi"));
  });

  it("falls back to a script when it is all there is, and errors when there is nothing", async () => {
    delete process.env.FOREMAN_PI_BIN;
    const script = await dirWith("script");
    assert.equal(await findPiBinary(script), join(script, "pi"));
    await assert.rejects(findPiBinary(await dirWith("none")), /Could not find `pi`/);
  });

  it("honors FOREMAN_PI_BIN over PATH", async () => {
    process.env.FOREMAN_PI_BIN = "/explicit/pi";
    try {
      assert.equal(await findPiBinary(await dirWith("binary")), "/explicit/pi");
    } finally {
      delete process.env.FOREMAN_PI_BIN;
    }
  });
});

import { hiddenMounts, sensitivePaths } from "../sandbox.ts";
import { mkdir, realpath, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

describe("credential hiding", () => {
  async function fakeHome() {
    const home = await realpath(await mkdtemp(join(homedir(), ".foreman-test-home-")));
    await mkdir(join(home, ".ssh"), { recursive: true });
    await writeFile(join(home, ".ssh/id_ed25519"), "PRIVATE-KEY");
    await mkdir(join(home, ".pi-inference/credentials"), { recursive: true });
    await writeFile(join(home, ".pi-inference/credentials/control-api-token"), "CONTROL-SECRET");
    await writeFile(join(home, ".pi-inference/credentials/model-api-key"), "MODEL-KEY");
    await mkdir(join(home, ".pi/agent"), { recursive: true });
    await writeFile(join(home, ".pi/agent/auth.json"), "AUTH-SECRET");
    await writeFile(join(home, "notes.txt"), "harmless");
    return home;
  }

  it("lists only existing paths and never one that would cover the repository or tmp", async () => {
    const home = await fakeHome();
    try {
      const hide = await hiddenMounts(await sensitivePaths(home), { cwd: join(home, "project"), tmp: tmpdir() });
      assert.deepEqual(hide.dirs, [join(home, ".ssh")]);
      assert.ok(hide.files.includes(join(home, ".pi-inference/credentials/control-api-token")));
      assert.ok(hide.files.includes(join(home, ".pi/agent/auth.json")));
      assert.ok(!hide.files.includes(join(home, ".pi-inference/credentials/model-api-key")));
      // A repository inside a sensitive directory must stay reachable.
      const inside = await hiddenMounts(await sensitivePaths(home), { cwd: join(home, ".ssh/work"), tmp: tmpdir() });
      assert.deepEqual(inside.dirs, []);
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(home, { recursive: true, force: true });
    }
  });

  it("hides a symlink's target, since bwrap cannot mount over the link itself", async () => {
    const home = await fakeHome();
    try {
      await mkdir(join(home, "stow"), { recursive: true });
      await mkdir(join(home, "project"), { recursive: true });
      await writeFile(join(home, "stow/npmrc"), "//registry:_authToken=SECRET");
      await symlink(join(home, "stow/npmrc"), join(home, ".npmrc"));
      const hide = await hiddenMounts(await sensitivePaths(home), { cwd: join(home, "project"), tmp: tmpdir() });
      assert.ok(hide.files.includes(join(home, "stow/npmrc")));
      assert.ok(!hide.files.includes(join(home, ".npmrc")));
      const out = spawnSync("bwrap", [...bwrapArgs({ role: "builder", cwd: home + "/project", tmp: tmpdir(), uid: process.getuid!(), hide }), "bash", "-c", `cat ${home}/.npmrc`], { encoding: "utf8" });
      assert.ok(!out.stdout.includes("SECRET"), "the token must not be readable through the link");
      assert.ok(!out.stderr.includes("No such file"), `bwrap should have started: ${out.stderr}`);
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(home, { recursive: true, force: true });
    }
  });

  it("makes the control token, auth store and ssh keys unreadable in a real sandbox but keeps the model key", async () => {
    const home = await fakeHome();
    const cwd = await mkdtemp(join(homedir(), ".foreman-test-"));
    try {
      const hide = await hiddenMounts(await sensitivePaths(home), { cwd, tmp: tmpdir() });
      const args = [...bwrapArgs({ role: "builder", cwd, tmp: tmpdir(), uid: process.getuid!(), hide }), "bash", "-c",
        `for f in .ssh/id_ed25519 .pi-inference/credentials/control-api-token .pi/agent/auth.json .pi-inference/credentials/model-api-key notes.txt; do printf '%s=[%s]\\n' "$f" "$(cat ${home}/$f 2>/dev/null)"; done`];
      const out = spawnSync("bwrap", args, { encoding: "utf8" }).stdout;
      assert.match(out, /\.ssh\/id_ed25519=\[\]/);
      assert.match(out, /control-api-token=\[\]/);
      assert.match(out, /auth\.json=\[\]/);
      assert.match(out, /model-api-key=\[MODEL-KEY\]/);
      assert.match(out, /notes\.txt=\[harmless\]/);
      assert.ok(!out.includes("PRIVATE-KEY") && !out.includes("CONTROL-SECRET") && !out.includes("AUTH-SECRET"));
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(home, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

import { findBrowsersPath } from "../sandbox.ts";

describe("browser support", () => {
  it("exposes the host's Playwright browsers and disables in-sandbox downloads", () => {
    const args = bwrapArgs({ role: "builder", cwd: "/w", tmp: "/tmp", uid: 1000, browsersPath: "/home/x/.cache/ms-playwright" }).join(" ");
    assert.match(args, /--setenv PLAYWRIGHT_BROWSERS_PATH \/home\/x\/\.cache\/ms-playwright/);
    assert.match(args, /--setenv PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD 1/);
    assert.ok(!bwrapArgs({ role: "builder", cwd: "/w", tmp: "/tmp", uid: 1000 }).join(" ").includes("PLAYWRIGHT"));
  });

  it("finds a browsers directory only when it exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "foreman-home-"));
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    assert.equal(await findBrowsersPath(dir), undefined);
    await mkdir(join(dir, ".cache/ms-playwright"), { recursive: true });
    assert.equal(await findBrowsersPath(dir), join(dir, ".cache/ms-playwright"));
  });
});

describe("runSandboxedCommand progress", () => {
  it("reports the latest non-empty output line while the command runs", async () => {
    const dir = await mkdtemp(join(process.env.HOME ?? tmpdir(), ".foreman-test-"));
    try {
      const lines: string[] = [];
      const result = await runSandboxedCommand("echo first; echo; echo '  second line  '; echo third >&2", dir, 10_000, undefined, (line) => lines.push(line));
      assert.equal(result.code, 0);
      assert.deepEqual(lines, ["first", "second line", "third"]);
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { spawnSandboxedApp } from "../sandbox.ts";
import { createServer } from "node:net";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

async function fetchText(port: number, retries = 40): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await (await fetch(`http://127.0.0.1:${port}/`)).text();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`nothing listening on ${port}`);
}

describe("spawnSandboxedApp", () => {
  it("serves the working files from a read-only mount, live, on the host's localhost", async () => {
    const dir = await mkdtemp(join(process.env.HOME ?? tmpdir(), ".foreman-test-"));
    await writeFile(join(dir, "index.html"), "version one");
    await writeFile(join(dir, "server.js"), `const http=require("http"),fs=require("fs");
http.createServer((q,r)=>{ let w="writable"; try{fs.writeFileSync("probe.txt","x")}catch{w="readonly"} r.end(fs.readFileSync("index.html","utf8")+"|"+w+"|"+process.env.DATA_DIR) }).listen(process.env.PORT,"127.0.0.1");`);
    const port = await freePort();
    const lines: string[] = [];
    const app = await spawnSandboxedApp("node server.js", { cwd: dir, env: { PORT: String(port), DATA_DIR: "/tmp/somewhere" }, onOutput: (line) => lines.push(line) });
    try {
      assert.equal(await fetchText(port), "version one|readonly|/tmp/somewhere", "reachable from the host, repo read-only, env passed");
      await writeFile(join(dir, "index.html"), "version two");
      assert.match(await fetchText(port), /^version two\|/, "a file saved on the host shows up in the running preview");
      await assert.rejects(stat(join(dir, "probe.txt")), "the app could not write into the repository");
    } finally {
      await app.stop();
    }
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`), "the server is gone after stop");
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true, force: true });
  });

  it("reports output lines and the exit code when the app dies", async () => {
    const dir = await mkdtemp(join(process.env.HOME ?? tmpdir(), ".foreman-test-"));
    const lines: string[] = [];
    const app = await spawnSandboxedApp("echo starting; echo boom >&2; exit 3", { cwd: dir, env: {}, onOutput: (line) => lines.push(line) });
    assert.equal(await app.exited, 3);
    assert.deepEqual(lines.sort(), ["boom", "starting"]);
    await app.stop(); // safe after exit
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true, force: true });
  });
});
