import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

/** The three calls the manager understands. Everything else about the card is its business. */
export interface LeaseClient {
  acquire(): Promise<void>;
  renew(): Promise<void>;
  release(): Promise<void>;
}

export interface GpuOptions {
  client: LeaseClient;
  /** Which providers live on the managed card. Others (e.g. a frontier API) skip the lease. */
  isManaged: (provider: string) => boolean;
  ttlMs: number;
  renewIntervalMs: number;
  /** Give up only when the lease has really lapsed, not on the first failed renewal. */
  expiryMarginMs: number;
  /** Called at most once if the lease is lost mid-run. */
  onLeaseLost: (error: Error) => void;
}

export function providerOf(model: string): string {
  const slash = model.indexOf("/");
  return slash < 0 ? model : model.slice(0, slash);
}

/**
 * One lease for the whole run, plus the bookkeeping that decides when a model switch happens.
 * In `team` mode the llama.cpp router (`--models-max 1`) loads whichever model a request names, so
 * a "swap" is not something we perform: it is the cost of the next request naming a different
 * model. `withModel` makes that cost visible and lets the cycle avoid it.
 */
export class Gpu {
  private leased = false;
  private lost = false;
  private lastRenewed = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private renewing = false;
  private loaded: string | undefined;
  /** Number of times a request named a model other than the one already resident. */
  swaps = 0;

  private readonly options: GpuOptions;

  constructor(options: GpuOptions) {
    this.options = options;
  }

  get loadedModel(): string | undefined {
    return this.loaded;
  }

  /** True when a request for `model` would make the router load different weights. */
  wouldSwap(model: string): boolean {
    return this.options.isManaged(providerOf(model)) && this.loaded !== model;
  }

  async withModel<T>(model: string, work: () => Promise<T>): Promise<T> {
    if (this.lost) throw new Error("GPU lease was lost earlier in this run");
    if (this.options.isManaged(providerOf(model))) {
      await this.ensureLeased();
      if (this.loaded !== undefined && this.loaded !== model) this.swaps += 1;
      this.loaded = model;
    }
    return work();
  }

  private async ensureLeased(): Promise<void> {
    if (this.leased) return;
    await this.options.client.acquire();
    this.leased = true;
    this.lastRenewed = Date.now();
    this.heartbeat = setInterval(() => void this.tick(), this.options.renewIntervalMs);
    this.heartbeat.unref();
  }

  private async tick(): Promise<void> {
    if (this.renewing || !this.leased) return;
    this.renewing = true;
    try {
      await this.options.client.renew();
      this.lastRenewed = Date.now();
    } catch (error) {
      // A stalled manager (for example while it loads weights) is survivable until the lease lapses.
      if (Date.now() - this.lastRenewed >= this.options.ttlMs - this.options.expiryMarginMs) {
        this.fail(new Error(`GPU lease lapsed after failed renewals: ${error instanceof Error ? error.message : String(error)}`));
      }
    } finally {
      this.renewing = false;
    }
  }

  private fail(error: Error): void {
    if (this.lost) return;
    this.lost = true;
    this.leased = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.options.onLeaseLost(error);
  }

  /** Release the lease. Safe to call repeatedly and after a loss. */
  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const wasLeased = this.leased;
    this.leased = false;
    this.loaded = undefined;
    if (wasLeased) await this.options.client.release();
  }
}

export interface ShellLeaseConfig {
  command: string;
  mode: string;
  ttlSeconds: number;
  acquireTimeoutSeconds: number;
}

/** Talks to the `pi-inference` CLI. The owner id is fixed for the life of the client. */
export function shellLeaseClient(config: ShellLeaseConfig, run = execFileRun): LeaseClient {
  const owner = `${hostname()}:${process.pid}:foreman:${randomUUID()}`;
  const env = { ...process.env, PI_INFERENCE_OWNER: owner, PI_INFERENCE_TTL: String(config.ttlSeconds) };
  const call = (args: string[], timeoutSeconds: number) => run(config.command, args, env, timeoutSeconds * 1000);
  return {
    acquire: () => call(["acquire", "--mode", config.mode], config.acquireTimeoutSeconds),
    renew: () => call(["renew"], 60),
    release: () => call(["release"], 60),
  };
}

export type CommandRunner = (command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<void>;

function execFileRun(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} ${args[0]} failed: ${(stderr || stdout || error.message).trim()}`));
      else resolve();
    });
  });
}

/** The host's current mode (team, studio, ds4, qwen-flash, stop, maintenance), from `pi-inference --json status`. */
export async function readHostMode(command: string, exec: (command: string, args: string[]) => Promise<string> = execFileText): Promise<string> {
  let stdout: string;
  try {
    stdout = await exec(command, ["--json", "status"]);
  } catch (error) {
    throw new Error(`Could not read the host mode: ${error instanceof Error ? error.message : String(error)}`);
  }
  let mode: unknown;
  try {
    mode = JSON.parse(stdout)?.mode;
  } catch {
    throw new Error("Could not read the host mode: the manager returned invalid JSON");
  }
  if (typeof mode !== "string" || !mode) throw new Error("Could not read the host mode: the manager reported none");
  return mode;
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim()));
      else resolve(stdout);
    });
  });
}
