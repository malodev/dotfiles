import { watch as fsWatch } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunningApp } from "./sandbox.ts";

export interface PreviewConfig {
  command: string;
  port: number;
  /** Extra environment; `{port}` and `{data}` are replaced (data is a private, writable folder). */
  env: Record<string, string>;
}

const EXAMPLE = '{ "command": "node server.js", "port": 4173, "env": { "PORT": "{port}", "NOTES_FILE": "{data}/notes.json" } }';

/** `foreman/preview.json`: how to start the app being built, on its own port and its own data. */
export function parsePreviewConfig(text: string): { config?: PreviewConfig; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { errors: ["preview.json is not valid JSON"] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { errors: ["preview.json must be an object"] };
  const item = raw as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(item)) if (!["command", "port", "env"].includes(key)) errors.push(`unknown key "${key}"`);
  if (typeof item.command !== "string" || !item.command.trim()) errors.push('"command" must be the shell command that starts the app');
  if (!Number.isInteger(item.port) || (item.port as number) < 1024 || (item.port as number) > 65535) errors.push('"port" must be an integer from 1024 to 65535');
  const env: Record<string, string> = {};
  if (item.env !== undefined) {
    if (!item.env || typeof item.env !== "object" || Array.isArray(item.env)) errors.push('"env" must be an object of strings');
    else for (const [name, value] of Object.entries(item.env)) {
      if (typeof value !== "string") errors.push(`env.${name} must be a string`);
      else env[name] = value;
    }
  }
  if (errors.length) return { errors };
  return { config: { command: (item.command as string).trim(), port: item.port as number, env }, errors };
}

export async function readPreviewConfig(repo: string): Promise<PreviewConfig> {
  const path = join(repo, "foreman/preview.json");
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) {
    throw new Error(`No foreman/preview.json. The Architect adds it when planning a web app; to create it yourself: ${EXAMPLE}`);
  }
  const { config, errors } = parsePreviewConfig(text);
  if (!config) throw new Error(`foreman/preview.json is not valid: ${errors.join("; ")}. Example: ${EXAMPLE}`);
  return config;
}

const IGNORED_SEGMENTS = new Set(["node_modules", ".git", ".venv", "__pycache__", "test-results", "playwright-report"]);

/** Paths whose changes must not restart the preview: dependencies, git, Foreman's own state, test output, editor temp files. */
export function shouldIgnore(relativePath: string): boolean {
  const parts = relativePath.split("/");
  if (parts.some((part) => IGNORED_SEGMENTS.has(part))) return true;
  if (relativePath.startsWith("foreman/.run")) return true;
  const name = parts[parts.length - 1];
  return name.endsWith("~") || /^\.?.*\.sw[a-p]$/.test(name) || /^\d+$/.test(name) || name.startsWith(".#");
}

/** The output lines that say what went wrong: error-looking lines first, else the tail. Stack frames are dropped. */
export function diagnosis(lines: string[]): string {
  const meaningful = lines.filter((line) => !/^\s*at\s/.test(line) && !/^Node\.js v\d/.test(line));
  const errors = meaningful.filter((line) => /error|cannot|not found|EADDRINUSE|EACCES|failed|exception|refused|denied/i.test(line));
  return (errors.length ? errors.slice(0, 4) : meaningful.slice(-4)).join("\n");
}

export interface PreviewDeps {
  start(command: string, options: { cwd: string; env: Record<string, string>; onOutput?: (line: string) => void }): Promise<RunningApp>;
  watch(directory: string, onChange: () => void): { close(): void };
  isPortFree(port: number): Promise<boolean>;
  /** True once something accepts connections on the port. */
  waitForPort(port: number, timeoutMs: number): Promise<boolean>;
  makeDataDir(): Promise<string>;
  removeDir(path: string): Promise<void>;
  notify(message: string, level?: "info" | "warning" | "error"): void;
  /** How long file changes must be quiet before the app restarts. */
  debounceMs?: number;
}

/**
 * The live preview of the working files. The app runs from the repository as the Builder edits it and
 * restarts (debounced) whenever a source file is saved, so a page refresh shows the latest work. It has
 * its own port and its own data folder, kept across restarts so your clicking is not lost, and never
 * shared with the tests.
 */
export class Preview {
  private readonly repo: string;
  private readonly config: PreviewConfig;
  private readonly deps: PreviewDeps;
  private app: RunningApp | undefined;
  private watcher: { close(): void } | undefined;
  private dataDir: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private recent: string[] = [];
  private stopping = false;
  private restarting = false;

  constructor(repo: string, config: PreviewConfig, deps: PreviewDeps) {
    this.repo = repo;
    this.config = config;
    this.deps = deps;
  }

  get url(): string {
    return `http://127.0.0.1:${this.config.port}`;
  }

  get running(): boolean {
    return this.app !== undefined;
  }

  async start(): Promise<void> {
    if (!(await this.deps.isPortFree(this.config.port))) {
      throw new Error(`Preview port ${this.config.port} is already in use. Stop whatever uses it, or change "port" in foreman/preview.json.`);
    }
    this.stopping = false;
    this.dataDir ??= await this.deps.makeDataDir();
    await this.launch();
    this.watcher ??= this.deps.watch(this.repo, () => this.scheduleRestart());
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
    await this.app?.stop();
    this.app = undefined;
    if (this.dataDir) await this.deps.removeDir(this.dataDir);
    this.dataDir = undefined;
  }

  private async launch(): Promise<void> {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(this.config.env)) {
      env[name] = value.replaceAll("{port}", String(this.config.port)).replaceAll("{data}", this.dataDir ?? "");
    }
    env.FOREMAN_PREVIEW = "1";
    this.recent = [];
    let starting = true;
    const app = await this.deps.start(this.config.command, {
      cwd: this.repo,
      env,
      onOutput: (line) => { this.recent.push(line); if (this.recent.length > 40) this.recent.shift(); },
    });
    this.app = app;
    void app.exited.then((code) => {
      if (starting || this.app !== app) return; // startup failures are reported by launch; replaced or stopped apps are not crashes
      this.app = undefined;
      if (this.stopping) return;
      const why = diagnosis(this.recent);
      this.deps.notify(`Preview stopped (exit code ${code ?? "signal"}). It restarts on the next saved change.${why ? `\n${why}` : ""}`, "warning");
    });

    // Wait for the port, but give up the moment the app dies instead of waiting out the timeout.
    const outcome = await Promise.race([
      this.deps.waitForPort(this.config.port, 20_000).then((listening) => ({ listening })),
      app.exited.then((code) => ({ code })),
    ]);
    starting = false;
    if ("code" in outcome) {
      if (this.app === app) this.app = undefined;
      const why = diagnosis(this.recent);
      throw new Error(`The preview app exited right away (exit code ${outcome.code ?? "signal"}). Command: ${this.config.command}${why ? `\n${why}` : ""}`);
    }
    if (!outcome.listening) {
      const why = diagnosis(this.recent);
      await app.stop();
      if (this.app === app) this.app = undefined;
      throw new Error(`The preview did not start listening on port ${this.config.port} within 20s.${why ? `\n${why}` : ""}`);
    }
  }

  private scheduleRestart(): void {
    if (this.stopping) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.restart(), this.deps.debounceMs ?? 1500);
  }

  private async restart(): Promise<void> {
    if (this.stopping || this.restarting) return;
    this.restarting = true;
    try {
      const old = this.app;
      this.app = undefined; // so its exit is not reported as a crash
      await old?.stop();
      await this.launch();
    } catch (error) {
      this.deps.notify(`Preview could not restart: ${error instanceof Error ? error.message : String(error)}`, "warning");
    } finally {
      this.restarting = false;
    }
  }
}

// ---- real dependencies ------------------------------------------------------

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

export async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host: "127.0.0.1" }, () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    if (open) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

export function watchRepository(directory: string, onChange: () => void): { close(): void } {
  const watcher = fsWatch(directory, { recursive: true }, (_event, filename) => {
    if (filename && !shouldIgnore(String(filename))) onChange();
  });
  watcher.on("error", () => {}); // a vanished directory must not crash pi
  return { close: () => watcher.close() };
}

export const realPreviewDeps = {
  isPortFree,
  waitForPort,
  watch: watchRepository,
  makeDataDir: () => mkdtemp(join(tmpdir(), "foreman-preview-")),
  removeDir: (path: string) => rm(path, { recursive: true, force: true }),
};
