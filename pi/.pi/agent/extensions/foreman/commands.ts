import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { collectArtifacts, describeArtifacts, findRecordings } from "./artifacts.ts";
import { loadAgent } from "./agents.ts";
import { Preview, readPreviewConfig, type PreviewDeps } from "./preview.ts";
import { architectKickoff, resolvePlanInput } from "./plan.ts";
import { applyHostMode, loadConfig, modelId, type ForemanConfig, type RoleProfile } from "./config.ts";
import { runQueue } from "./run.ts";
import { finalBoard, formatStatus, progressBoard, type Board, type PanelInput } from "./report.ts";
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
  setWidget?(content: string[] | ((width: number) => string[]) | undefined): void;
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
  /** The host's current mode, from the manager. */
  readMode(command: string): Promise<string>;
  /** Open a URL or file in the owner's own browser. */
  openUrl(target: string): Promise<void>;
  /** How the live preview starts the app, watches files and checks ports. */
  preview: Omit<PreviewDeps, "notify">;
  /** Start the interactive Architect session. `profile` selects its model when configured. */
  startArchitect(host: Host, kickoff: string, profile: RoleProfile | undefined): Promise<void>;
}

const USAGE = [
  "/foreman plan <idea | path/to/prd.md>   draft plan.md and tasks.yaml with the Architect",
  "/foreman run                            build every task in order until done or blocked",
  "/foreman status                         show progress",
  "/foreman unblock <task-id> [note]       retry a blocked task, optionally with guidance",
  "/foreman preview [stop]                 open the app being built in your browser, following the Builder's saved files",
  "/foreman recordings [task-id]           open the videos and screenshots kept from the test runs",
  "/foreman pause                          stop after the current task",
  "/foreman stop                           abort the running task now",
].join("\n");

export const SUBCOMMANDS = ["plan", "run", "status", "unblock", "pause", "stop", "preview", "recordings"] as const;

interface ActiveRun {
  controller: AbortController;
  store: StateStore;
}

/** All command behavior. Holds the only in-process state: the running task loop and the planning lease. */
export class Foreman {
  private active: ActiveRun | undefined;
  private preview: Preview | undefined;
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
        case "preview": return await this.previewCommand(rest, host);
        case "recordings": return await this.recordings(rest, host);
        default: host.notify(USAGE, name ? "warning" : "info");
      }
    } catch (error) {
      host.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Session is going away: abort any task and hand the card back. */
  async shutdown(): Promise<void> {
    this.active?.controller.abort();
    await this.preview?.stop().catch(() => undefined);
    this.preview = undefined;
    await this.planGpu?.close().catch(() => undefined);
    this.planGpu = undefined;
  }

  private show(host: Host, board: Board): void {
    host.setWidget?.(board.render);
    host.setTitle?.(board.title);
    if (board.final) host.bell?.();
  }

  private paths(cwd: string) {
    const dir = join(cwd, "foreman");
    return { dir, plan: join(dir, "plan.md"), tasks: join(dir, "tasks.yaml"), state: join(dir, ".run/state.json"), logs: join(dir, ".run/logs") };
  }

  /**
   * Config for the host's current mode. Only consulted when a local (managed) provider is involved;
   * with cloud models alone the host mode is irrelevant.
   */
  private async effectiveConfig(host: Host): Promise<ForemanConfig> {
    const base = await loadConfig(this.services.configPaths(host.cwd));
    if (base.gpu.managedProviders.length === 0 && Object.keys(base.modes).length === 0) return base;
    return applyHostMode(base, await this.services.readMode(base.gpu.command));
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
    const config = await this.effectiveConfig(host);
    const check = `node ${join(this.services.extensionDir, "check.ts")} foreman/tasks.yaml`;
    const architect = config.roles.architect;
    const role = await loadAgent(join(this.services.extensionDir, "agents/architect.md")).then((agent) => agent.body).catch(() => "");
    const kickoff = architectKickoff(input, check, role, config.notes, join(this.services.extensionDir, "agents/architect-web.md"));
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
    const config = await this.effectiveConfig(host);

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
    const planTitle = (await readFile(paths.plan, "utf8").catch(() => "")).match(/^#\s+(.+)$/m)?.[1]?.trim();
    const runStartedAt = Date.now();
    let current = "";
    let phase = "";
    let detail = "";
    let phaseStartedAt = Date.now();
    const panel = (run: PanelInput["run"], extra: Partial<PanelInput> = {}): PanelInput => ({
      title: planTitle,
      run,
      tasks,
      state: store.get(),
      currentId: current || undefined,
      maxAttempts: config.limits.buildAttempts,
      phase,
      detail,
      previewUrl: this.preview?.running ? this.preview.url : undefined,
      branch,
      files: ["foreman/tasks.yaml", "logs foreman/.run/logs"],
      runStartedAt,
      phaseStartedAt,
      ...extra,
    });
    const refresh = () => this.show(host, progressBoard(panel("running")));
    // Tests can be silent for minutes; tick so the elapsed time keeps moving.
    const ticker = setInterval(() => { if (current) refresh(); }, 5000);
    ticker.unref();
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
        log: (message) => { detail = message; host.setStatus(`foreman: ${message}`); refresh(); },
        resetTestOutput: () => rm(join(host.cwd, "test-results"), { recursive: true, force: true }),
        collect: async (taskId, attempt) => {
          const collected = await collectArtifacts(host.cwd, join(paths.dir, ".run/artifacts", `${taskId}-attempt${attempt}`));
          return collected ? `${describeArtifacts(collected)} · /foreman recordings ${taskId}` : undefined;
        },
        phase: (text) => { phase = text; detail = ""; phaseStartedAt = Date.now(); host.setStatus(`foreman: ${text}`); refresh(); },
        onTask: (task) => {
          current = task.id;
          phase = "starting";
          detail = "";
          phaseStartedAt = Date.now();
          host.notify(`Starting ${task.id} (${tasks.findIndex((candidate) => candidate.id === task.id) + 1}/${total})`);
          refresh();
        },
      });
      this.show(host, finalBoard(panel(summary.kind === "idle" ? "finished" : summary.kind, {
        currentId: summary.kind === "blocked" ? summary.taskId : undefined,
        blocked: summary.kind === "blocked" ? { taskId: summary.taskId ?? "", reason: summary.reason ?? "" } : undefined,
        phase: undefined,
        detail: undefined,
      })));
      if (summary.kind === "idle") {
        host.notify(`All ${total} task(s) done on branch ${branch}. Review with: git log --oneline main..${branch}`);
      } else if (summary.kind === "paused") {
        host.notify(`Paused after ${summary.completed.length} task(s). /foreman run continues.`);
      } else {
        host.notify(`Blocked on ${summary.taskId}: ${summary.reason}\nFix the cause or guide the Builder, then: /foreman unblock ${summary.taskId} [note]  and  /foreman run`, "warning");
      }
    } finally {
      clearInterval(ticker);
      this.active = undefined;
      host.setStatus(undefined);
      await gpu.close().catch((error) => host.notify(`Releasing the GPU lease failed; it will expire on its own: ${error instanceof Error ? error.message : String(error)}`, "warning"));
    }
  }

  private async previewCommand(argument: string, host: Host): Promise<void> {
    if (argument === "stop") {
      if (!this.preview) {
        host.notify("No preview is running.");
        return;
      }
      await this.preview.stop();
      this.preview = undefined;
      host.notify("Preview stopped.");
      return;
    }
    if (this.preview?.running) {
      const opened = await this.tryOpen(this.preview.url);
      host.notify(`Preview already running.\nOpen: ${this.preview.url}${opened ? "" : "\nI could not open a browser; open the link yourself."}`);
      return;
    }
    const config = await readPreviewConfig(host.cwd);
    host.notify(`Starting the preview on port ${config.port}: ${config.command} (waits up to 20s for the app to answer)…`);
    const preview = new Preview(host.cwd, config, { ...this.services.preview, notify: (message, level) => host.notify(message, level) });
    try {
      await preview.start();
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}${await this.buildProgressHint(host)}\nAddress once it runs: http://127.0.0.1:${config.port}`);
    }
    this.preview = preview;
    const opened = await this.tryOpen(preview.url);
    host.notify(`Preview running.\nOpen: ${preview.url}${opened ? "" : "\nI could not open a browser; open the link yourself."}\nIt shows the Builder's saved files: refresh the page, and the app restarts by itself when a source file changes. It has its own port and data, so exploring it cannot disturb the tests. /foreman preview stop ends it.`);
  }

  /** Open the owner's browser; false (never a throw) when that is not possible, so the link is shown instead. */
  private async tryOpen(target: string): Promise<boolean> {
    try {
      await this.services.openUrl(target);
      return true;
    } catch {
      return false;
    }
  }

  /** When the plan is not finished, the app may simply not exist yet. */
  private async buildProgressHint(host: Host): Promise<string> {
    const paths = this.paths(host.cwd);
    const text = await readFile(paths.tasks, "utf8").catch(() => undefined);
    if (text === undefined) return "";
    const { tasks } = loadTasks(text);
    const state = this.active ? this.active.store.get() : await loadState(paths.state).catch(() => undefined);
    const done = tasks.filter((task) => state?.tasks[task.id]?.status === "done").length;
    return done < tasks.length
      ? `\n${done} of ${tasks.length} tasks are done, so the app may not exist yet. Try /foreman preview again after the task that creates it.`
      : "";
  }

  private async recordings(argument: string, host: Host): Promise<void> {
    const found = await findRecordings(host.cwd, argument || undefined);
    if (found.length === 0) {
      host.notify(`No recordings${argument ? ` for ${argument}` : ""} yet. Videos and screenshots are kept when a task's success tests write them to test-results (Playwright with video and screenshot on).`);
      return;
    }
    const opened = await this.tryOpen(`file://${found[0].index}`);
    host.notify(`${opened ? "Opened" : "I could not open a browser; open this file yourself:"} ${found[0].name}.${found.length > 1 ? ` Other recordings: ${found.slice(1, 6).map((entry) => entry.name).join(", ")}. Ask for one with /foreman recordings <task-id>.` : ""}\n${found[0].index}`);
  }

  private async status(host: Host): Promise<void> {
    const paths = this.paths(host.cwd);
    const text = await readFile(paths.tasks, "utf8").catch(() => "");
    const { tasks, errors } = text ? loadTasks(text) : { tasks: [], errors: [] };
    const state = this.active ? this.active.store.get() : await loadState(paths.state);
    const invalid = errors.length ? `\ntasks.yaml has ${errors.length} problem(s); run: node ${join(this.services.extensionDir, "check.ts")} foreman/tasks.yaml` : "";
    const models = await this.effectiveConfig(host).then(
      (config) => `\nmode: ${config.gpu.mode}${config.gpu.managedProviders.length ? "" : " (not consulted: no local provider)"}\nmodels: ${(["architect", "builder", "reviewer"] as const).flatMap((role) => {
        const profile = config.roles[role];
        return profile ? [`${role} ${modelId(profile)}`] : [];
      }).join(" · ")}`,
      (error) => `\nmodels: unavailable — ${error instanceof Error ? error.message : String(error)}`,
    );
    const preview = this.preview?.running ? `\npreview: ${this.preview.url}` : "";
    host.notify(formatStatus(tasks, state) + models + preview + invalid + (this.active ? "\n(running)" : ""));
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
    let reviewOnly = false;
    await this.withStore(host, (state) => {
      reviewOnly = state.tasks[id]?.stage === "review";
      return unblock(state, id, noteWords.join(" ") || undefined);
    });
    host.notify(`${id} is pending again${noteWords.length ? " with your note" : ""}${reviewOnly ? "; only the review will be retried, the Builder's work is kept" : ""}. /foreman run to continue.`);
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
