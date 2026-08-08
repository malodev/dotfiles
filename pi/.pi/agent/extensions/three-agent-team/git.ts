/**
 * The one way this extension runs git.
 *
 * Replaces three independent adapters that had drifted apart in capability
 * (queue-repository's spawn/Buffer/stdin, plan-import's execFile/string/env,
 * and index.ts's `bash -lc` interpolation). Arguments are always passed as
 * argv — never through a shell — so pathspecs, refs, and commit messages
 * cannot be reinterpreted by shell quoting.
 *
 * Three entry points, matching the three shapes callers actually need:
 *
 *   git()             raw result, never throws — callers that branch on exit code
 *   gitText()         stdout trimmed, throws on nonzero — the common case
 *   gitTextOrEmpty()  stdout trimmed, "" on nonzero — existence/liveness probes
 *
 * Output is Buffer at the core because some callers genuinely need bytes:
 * blob comparison against a file on disk, and NUL-separated `-z` output that
 * must not be lossily decoded. Buffer generalizes to string; string does not
 * generalize back.
 */

import { spawn } from "node:child_process";

export interface GitOptions {
  /** Written to git's stdin, then closed. Used for `--stdin`-style path lists. */
  input?: Buffer;
  /** Merged over process.env. Used for GIT_INDEX_FILE when building a private index. */
  env?: NodeJS.ProcessEnv;
}

export interface GitResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

/** Runs git and resolves with its exit code and raw output. Never throws for a nonzero exit. */
export function git(repo: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("git", ["-C", repo, ...args], {
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      resolveResult({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    if (options.input) child.stdin!.end(options.input);
  });
}

/** Runs git and returns trimmed stdout, throwing `${label}: ${stderr}` on a nonzero exit. */
export async function gitText(repo: string, args: string[], label: string, options: GitOptions = {}): Promise<string> {
  const result = await git(repo, args, options);
  if (result.code !== 0) throw new Error(`${label}: ${result.stderr.toString("utf8").trim() || "git failed"}`);
  return result.stdout.toString("utf8").trim();
}

/** Runs git and returns trimmed stdout, or "" if git exited nonzero. For probes where absence is a valid answer. */
export async function gitTextOrEmpty(repo: string, args: string[], options: GitOptions = {}): Promise<string> {
  const result = await git(repo, args, options);
  return result.code === 0 ? result.stdout.toString("utf8").trim() : "";
}
