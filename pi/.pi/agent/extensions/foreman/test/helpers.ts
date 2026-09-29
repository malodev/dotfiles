import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foreman-repo-"));
  const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  run("init", "-q", "-b", "main");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  run("config", "commit.gpgsign", "false");
  await writeFile(join(dir, "README.md"), "# test\n");
  run("add", "-A");
  run("commit", "-q", "-m", "init");
  return dir;
}

import { spawn } from "node:child_process";
import type { CommandResult } from "../sandbox.ts";

/** Host-side stand-in for the sandboxed command runner, so cycle tests do not need bwrap. */
export function bashRunner(command: string, cwd: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}
