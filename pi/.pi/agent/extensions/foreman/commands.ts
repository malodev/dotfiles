import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAgent } from "./agents.ts";
import { architectKickoff, resolvePlanInput } from "./plan.ts";
import { loadConfig, modelId, type ForemanConfig, type RoleProfile } from "./config.ts";
import { runQueue } from "./run.ts";
import { finalBoard, formatStatus, progressBoard, type Board } from "./report.ts";
import { Gpu, providerOf, type LeaseClient, type ShellLeaseConfig } from "./gpu.ts";
import { commitAll, commitPaths, currentBranch, dirtyOutsideForeman, ensureWorkBranch, git } from "./git.ts";
import type { CommandRunner, RoleRunner } from "./sandbox.ts";
import { loadState, openStore, recoverInterrupted, setPaused, syncTasks, unblock, type StateStore } from "./state.ts";
import { loadTasks } from "./tasks.ts";

export interface Host {
  cwd: string;
  notify(message: string, level?: "info" | "warning" | "error"): void;
  /** One-line footer status; undefined clears it. */
  setStatus(text: string | undefined): void;
  /** Persistent panel above the editor; undefined clears it. Optional so plain hosts still work. */
  setWidget?(lines: string[] | undefined): void;
  /** Terminal window/tab title, useful when the window is in the background. */
  setTitle?(title: string): void;
  /** Terminal bell, to draw attention when a run ends. */
  bell?(): void;
}

export interface Services {
  extensionDir: string;
  /** Config layers, later ones win: [global, project]. */
  configPaths(cwd: string): string[];
  runRole: RoleRunner;
  runCommand: CommandRunner;
  makeLeaseClient(config: ShellLeaseConfig): LeaseClient;
  /** Start the interactive Architect session. `profile` selects its model when configured. */
  startArchitect(host: Host, kickoff: string, profile: RoleProfile | undefined): Promise<void>;
}

const USAGE = [
  "/foreman plan <idea | path/to/prd.md>   draft plan.md and tasks.yaml with the Architect",
  "/foreman run                            build every task in order until done or blocked",
  "/foreman status                         show progress",
  "/foreman unblock <task-id> [note]       retry a blocked task, optionally with guidance",
  "/foreman pause                          stop after the current task",
  "/foreman stop                           abort the running task now",
].join("\n");

export const SUBCOMMANDS = ["plan", "run", "status", "unblock", "pause", "stop"] as const;

interface ActiveRun {
  controller: AbortController;
  store: StateStore;
}

/** All command behavior. Holds the only in-process state: the running task loop and the planning lease. */
export class Foreman {
  private active: ActiveRun | undefined;
  private planGpu: Gpu | undefined;
  private readonly services: Services;

  constructor(services: Services) {
    this.services = services;
  }

  async handle(argument: string, host: Host): Promise<void> {
    const trimmed = argument.trim();
    const space = trimmed.search(/\s/);
    const name = space < 0 ? trimmed : trimmed.slice(0, space);
    const rest = space < 0 ? "" : trimmed.slice(space).trim();
    try {
      switch (name) {
        case "plan": return await this.plan(rest, host);
        case "run": return await this.run(host);
        case "status": return await this.status(host);
        case "unblock": return await this.unblock(rest, host);
        case "pause": return await this.pause(host);
        case "stop": return this.stop(host);
        default: host.notify(USAGE, name ? "warning" : "info");
      }
    } catch (error) {
      host.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Session is going away: abort any task and hand the card back. */
  async shutdown(): Promise<void> {
    this.active?.controller.abort();
    await this.planGpu?.close().catch(() => undefined);
    this.planGpu = undefined;
  }

  private show(host: Host, board: Board): void {
    host.setWidget?.(board.lines);
    host.setTitle?.(board.title);
    if (board.final) host.bell?.();
  }

  private paths(cwd: string) {
    const dir = join(cwd, "foreman");
    return { dir, plan: join(dir, "plan.md"), tasks: join(dir, "tasks.yaml"), state: join(dir, ".run/state.json"), logs: join(dir, ".run/logs") };
  }

  private newGpu(config: ForemanConfig, host: Host): Gpu {
    const client = this.services.makeLeaseClient({
      command: config.gpu.command,
      mode: config.gpu.mode,
      ttlSeconds: config.gpu.leaseTtlSeconds,
      acquireTimeoutSeconds: config.gpu.acquireTimeoutSeconds,
    });
    return new Gpu({
      client,
      isManaged: (provider) => config.gpu.managedProviders.includes(provider),
      ttlMs: config.gpu.leaseTtlSeconds * 1000,
      renewIntervalMs: config.gpu.renewIntervalSeconds * 1000,
      expiryMarginMs: config.gpu.expiryMarginSeconds * 1000,
      onLeaseLost: (error) => {
        host.notify(`GPU lease lost: ${error.message}. Aborting the running task.`, "error");
        this.active?.controller.abort();
      },
    });
  }

  private async plan(argument: string, host: Host): Promise<void> {
    host.setWidget?.(undefined);
    if (this.active) throw new Error("A run is in progress. Use /foreman stop first.");
    const input = await resolvePlanInput(argument, host.cwd);
    const config = await loadConfig(this.services.configPaths(host.cwd));
    const check = `node ${join(this.services.extensionDir, "check.ts")} foreman/tasks.yaml`;
    const architect = config.roles.architect;
    const role = await loadAgent(join(this.services.extensionDir, "agents/architect.md")).then((agent) => agent.body).catch(() => "");
    const kickoff = architectKickoff(input, check, role);
    // A local Architect model needs the card too. Keep the lease through planning; `run` takes it over.
    if (architect && config.gpu.managedProviders.includes(architect.provider)) {
      this.planGpu ??= this.newGpu(config, host);
      const gpu = this.planGpu;
      await gpu.withModel(modelId(architect), () => this.services.startArchitect(host, kickoff, architect));
    } else {
      await this.services.startArchitect(host, kickoff, architect);
    }
  }

  private async run(host: Host): Promise<void> {
    if (this.active) throw new Error("A run is already in progress. Use /foreman status, /foreman pause or /foreman stop.");
    const paths = this.paths(host.cwd);
    const config = await loadConfig(this.services.configPaths(host.cwd));

    const text = await readFile(paths.tasks, "utf8").catch(() => undefined);
    if (text === undefined) throw new Error("No foreman/tasks.yaml. Run /foreman plan first.");
    const { tasks, errors } = loadTasks(text);
    if (errors.length) throw new Error(`foreman/tasks.yaml is not valid:\n${errors.map((error) => `  - ${error}`).join("\n")}`);

    const onOwnBranch = (await currentBranch(host.cwd)).startsWith("foreman/");
    if (!onOwnBranch) {
      const dirty = await dirtyOutsideForeman(host.cwd);
      if (dirty.length) throw new Error(`Uncommitted changes outside foreman/ (commit or stash them first):\n${dirty.map((path) => `  ${path}`).join("\n")}`);
    }
    const { branch } = await ensureWorkBranch(host.cwd, new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14));
    await commitPaths(host.cwd, ["foreman/plan.md", "foreman/tasks.yaml"], "foreman: plan");

    const store = await openStore(paths.state);
    await store.update((state) => setPaused(recoverInterrupted({ ...syncTasks(state, tasks), branch }), false));

    host.setWidget?.(undefined);
    const controller = new AbortController();
    this.active = { controller, store };
    const gpu = this.planGpu ?? this.newGpu(config, host);
    this.planGpu = undefined;
    const total = tasks.length;
    const doneCount = () => tasks.filter((task) => store.get().tasks[task.id]?.status === "done").length;
    let current = "";
    let activity = "";
    const refresh = () => this.show(host, progressBoard({ done: doneCount(), total, taskId: current, activity }));
    try {
      const summary = await runQueue({
        repo: host.cwd,
        tasks,
        store,
        gpu,
        limits: config.limits,
        logDir: paths.logs,
        builder: { model: modelId(config.roles.builder), thinking: config.roles.builder.thinking },
        reviewer: { model: modelId(config.roles.reviewer), thinking: config.roles.reviewer.thinking },
        prompts: {
          builder: join(this.services.extensionDir, "agents/builder.md"),
          reviewer: join(this.services.extensionDir, "agents/reviewer.md"),
        },
        runRole: this.services.runRole,
        runCommand: this.services.runCommand,
        commit: (message) => commitAll(host.cwd, message),
        prepareReview: async () => { await git(host.cwd, ["add", "-N", "."]); },
        signal: controller.signal,
        log: (message) => { activity = message; host.setStatus(`foreman: ${message}`); refresh(); },
        onTask: (task) => {
          current = task.id;
          activity = "starting";
          host.notify(`Starting ${task.id} (${tasks.findIndex((candidate) => candidate.id === task.id) + 1}/${total})`);
          refresh();
        },
      });
      this.show(host, finalBoard(summary, total, doneCount(), branch));
      if (summary.kind === "idle") {
        host.notify(`All ${total} task(s) done on branch ${branch}. Review with: git log --oneline main..${branch}`);
      } else if (summary.kind === "paused") {
        host.notify(`Paused after ${summary.completed.length} task(s). /foreman run continues.`);
      } else {
        host.notify(`Blocked on ${summary.taskId}: ${summary.reason}\nFix the cause or guide the Builder, then: /foreman unblock ${summary.taskId} [note]  and  /foreman run`, "warning");
      }
    } finally {
      this.active = undefined;
      host.setStatus(undefined);
      await gpu.close().catch((error) => host.notify(`Releasing the GPU lease failed; it will expire on its own: ${error instanceof Error ? error.message : String(error)}`, "warning"));
    }
  }

  private async status(host: Host): Promise<void> {
    const paths = this.paths(host.cwd);
    const text = await readFile(paths.tasks, "utf8").catch(() => "");
    const { tasks, errors } = text ? loadTasks(text) : { tasks: [], errors: [] };
    const state = this.active ? this.active.store.get() : await loadState(paths.state);
    const invalid = errors.length ? `\ntasks.yaml has ${errors.length} problem(s); run: node ${join(this.services.extensionDir, "check.ts")} foreman/tasks.yaml` : "";
    host.notify(formatStatus(tasks, state) + invalid + (this.active ? "\n(running)" : ""));
  }

  private async withStore<T>(host: Host, change: (state: import("./state.ts").State) => import("./state.ts").State): Promise<void> {
    if (this.active) {
      await this.active.store.update(change);
      return;
    }
    const store = await openStore(this.paths(host.cwd).state);
    await store.update(change);
  }

  private async unblock(argument: string, host: Host): Promise<void> {
    if (this.active) throw new Error("A run is in progress; pause or stop it first.");
    const [id, ...noteWords] = argument.split(/\s+/).filter(Boolean);
    if (!id) throw new Error("Usage: /foreman unblock <task-id> [note]");
    await this.withStore(host, (state) => unblock(state, id, noteWords.join(" ") || undefined));
    host.notify(`${id} is pending again${noteWords.length ? " with your note" : ""}. /foreman run to continue.`);
  }

  private async pause(host: Host): Promise<void> {
    await this.withStore(host, (state) => setPaused(state, true));
    host.notify(this.active ? "Will pause after the current task finishes." : "Paused. /foreman run resumes.");
  }

  private stop(host: Host): void {
    if (!this.active) {
      host.notify("Nothing is running.");
      return;
    }
    this.active.controller.abort();
    host.notify("Stopping: the running task will be blocked as aborted.");
  }
}

export { providerOf };
