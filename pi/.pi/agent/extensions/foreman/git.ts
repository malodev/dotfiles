import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Argv-only git adapter. Arguments are never interpreted by a shell. */
export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args.join(" ")} failed: ${(stderr || stdout || error.message).trim()}`));
      else resolve(stdout);
    });
  });
}

export async function currentBranch(repo: string): Promise<string> {
  return (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}

export async function headSha(repo: string): Promise<string> {
  return (await git(repo, ["rev-parse", "HEAD"])).trim();
}

const RUNTIME_DIR = "foreman/.run";

/**
 * Never committed, whatever the Builder forgets to put in .gitignore: Foreman's own runtime files and
 * the dependency/test-output directories a fullstack project produces. Written to .git/info/exclude so
 * the owner's tracked files and .gitignore stay untouched.
 */
const EXCLUDES = [`/${RUNTIME_DIR}/`, "node_modules/", ".venv/", "__pycache__/", "test-results/", "playwright-report/"];

async function excludeRuntimeDir(repo: string): Promise<void> {
  const excludePath = join(repo, (await git(repo, ["rev-parse", "--git-path", "info/exclude"])).trim());
  const existing = await readFile(excludePath, "utf8").catch(() => "");
  const present = new Set(existing.split("\n"));
  const missing = EXCLUDES.filter((line) => !present.has(line));
  if (missing.length === 0) return;
  await mkdir(join(excludePath, ".."), { recursive: true });
  await appendFile(excludePath, `${existing && !existing.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
}

/**
 * Work happens on a `foreman/*` branch and never on the owner's branch. An existing
 * foreman/* branch is reused so `/foreman run` resumes instead of forking.
 */
export async function ensureWorkBranch(repo: string, runId: string): Promise<{ branch: string; created: boolean }> {
  await excludeRuntimeDir(repo);
  const branch = await currentBranch(repo);
  if (branch.startsWith("foreman/")) return { branch, created: false };
  const name = `foreman/${runId}`;
  await git(repo, ["checkout", "-q", "-b", name]);
  return { branch: name, created: true };
}

/** Uncommitted paths outside foreman/. Plan files and runtime files are expected. */
export async function dirtyOutsideForeman(repo: string): Promise<string[]> {
  const output = await git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const paths: string[] = [];
  const entries = output.split("\0").filter(Boolean);
  for (let i = 0; i < entries.length; i++) {
    const status = entries[i].slice(0, 2);
    const path = entries[i].slice(3);
    if (status[0] === "R" || status[0] === "C") i++; // rename/copy entries carry the origin path next
    if (path.startsWith("foreman/")) continue;
    paths.push(path);
  }
  return paths;
}

export async function commitAll(repo: string, message: string): Promise<{ sha: string; empty: boolean }> {
  await git(repo, ["add", "-A"]);
  const staged = await git(repo, ["diff", "--cached", "--name-only"]);
  if (!staged.trim()) return { sha: await headSha(repo), empty: true };
  await git(repo, ["commit", "-q", "-m", message]);
  return { sha: await headSha(repo), empty: false };
}

/** Commit only the named paths (those that exist and changed). Returns undefined when nothing to commit. */
export async function commitPaths(repo: string, paths: string[], message: string): Promise<string | undefined> {
  const existing: string[] = [];
  for (const path of paths) {
    const found = await stat(join(repo, path)).catch(() => undefined);
    if (found) existing.push(path);
  }
  if (existing.length === 0) return undefined;
  await git(repo, ["add", "--", ...existing]);
  const staged = await git(repo, ["diff", "--cached", "--name-only", "--", ...existing]);
  if (!staged.trim()) return undefined;
  await git(repo, ["commit", "-q", "-m", message, "--", ...existing]);
  return headSha(repo);
}
