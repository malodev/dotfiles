import { spawn } from "node:child_process";
import { access, constants, copyFile, mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, relative, resolve as resolvePath } from "node:path";
import { parseAgentMarkdown } from "./agents.ts";

export interface RoleRequest {
  role: "builder" | "reviewer";
  /** `provider/model`, exactly as pi's --model accepts it. */
  model: string;
  thinking?: string;
  cwd: string;
  promptPath: string;
  task: string;
  timeoutMs: number;
  idleTimeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface RoleResult {
  output: string;
  toolCount: number;
  stopReason?: string;
  responseModel?: string;
  exitCode: number;
  stderr: string;
  error?: string;
}

/** The seam the cycle depends on. Tests inject a fake; production uses runPiRole. */
export type RoleRunner = (request: RoleRequest) => Promise<RoleResult>;

/**
 * Bubblewrap argv (everything before the program to run). The host is read-only,
 * DBus is hidden, /tmp is writable, and only the Builder may write the repository.
 * The Reviewer's read-only access is therefore enforced by the kernel, not the prompt.
 */
export function bwrapArgs(options: { role: "builder" | "reviewer"; cwd: string; tmp: string; uid: number; hide?: HiddenMounts; browsersPath?: string }): string[] {
  const { role, cwd, tmp, uid, hide, browsersPath } = options;
  return [
    "--die-with-parent",
    "--unshare-pid", "--unshare-ipc", "--unshare-uts",
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    ...(role === "builder" ? ["--bind", cwd, cwd] : []),
    "--bind", tmp, tmp,
    // Secrets the role has no use for: directories become empty, files read as empty.
    ...(hide?.dirs ?? []).flatMap((path) => ["--tmpfs", path]),
    ...(hide?.files ?? []).flatMap((path) => ["--ro-bind", "/dev/null", path]),
    "--tmpfs", `/run/user/${uid}`,
    "--tmpfs", "/run/dbus",
    "--setenv", "DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/blocked/bus",
    "--setenv", "npm_config_cache", join(tmp, "foreman-npm-cache"),
    "--setenv", "npm_config_update_notifier", "false",
    "--setenv", "UV_CACHE_DIR", join(tmp, "foreman-uv-cache"),
    "--setenv", "XDG_CACHE_HOME", join(tmp, "foreman-xdg-cache"),
    // Browsers for UI/e2e tests are read from the host cache; downloading inside the sandbox would
    // hit the throwaway XDG cache above and repeat on every run.
    ...(browsersPath ? ["--setenv", "PLAYWRIGHT_BROWSERS_PATH", browsersPath, "--setenv", "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "1"] : []),
  ];
}

export interface HiddenMounts {
  dirs: string[];
  files: string[];
}

/**
 * Credentials a Builder or Reviewer never needs. The model API key stays reachable, because pi
 * fetches it inside the sandbox; the control token (switch modes, release leases), cloud and VCS
 * credentials, and the real pi auth store do not. The role gets a private copy of its own auth.
 */
export async function sensitivePaths(home: string): Promise<HiddenMounts> {
  const files = [
    join(home, ".pi-inference/credentials/control-api-token"),
    join(home, ".pi/agent/auth.json"),
    join(home, ".netrc"),
    join(home, ".git-credentials"),
    join(home, ".npmrc"),
  ];
  // The client config may relocate the control token.
  const configured = await readFile(join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "pi-inference/client.json"), "utf8").then(
    (text) => (JSON.parse(text)?.control?.token_file as unknown),
    () => undefined,
  );
  if (typeof configured === "string" && configured) {
    files.push(resolvePath(configured.replace(/^~(?=\/|$)/, home).replace(/\$\{?(\w+)\}?/g, (_m, name: string) => process.env[name] ?? "")));
  }
  return {
    dirs: [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".config/gh", ".config/gcloud"].map((name) => join(home, name)),
    files,
  };
}

/** Keep only paths that exist (as their real targets), and never one that would cover the repository or the writable tmp. */
export async function hiddenMounts(candidates: HiddenMounts, keep: { cwd: string; tmp: string }): Promise<HiddenMounts> {
  const overlaps = (path: string, other: string): boolean => {
    const from = relative(path, other);
    const to = relative(other, path);
    return !from.startsWith("..") || !to.startsWith("..") || from === "" || to === "";
  };
  const usable = async (paths: string[], wantDirectory: boolean): Promise<string[]> => {
    const found = new Set<string>();
    for (const candidate of paths) {
      // bwrap cannot mount over a symlink, and reading through one reaches its target: hide the target.
      const path = await realpath(candidate).catch(() => undefined);
      if (!path || overlaps(path, keep.cwd) || overlaps(path, keep.tmp)) continue;
      const info = await stat(path).catch(() => undefined);
      if (info && info.isDirectory() === wantDirectory) found.add(path);
    }
    return [...found];
  };
  return { dirs: await usable(candidates.dirs, true), files: await usable(candidates.files, false) };
}

/** Where Playwright browsers already live on this machine, if anywhere. */
export async function findBrowsersPath(home = homedir()): Promise<string | undefined> {
  const candidate = process.env.PLAYWRIGHT_BROWSERS_PATH || join(home, ".cache/ms-playwright");
  const info = await stat(candidate).catch(() => undefined);
  return info?.isDirectory() ? candidate : undefined;
}

const DEFAULT_TOOLS = { builder: "read,grep,find,ls,bash,edit,write", reviewer: "read,grep,find,ls,bash" } as const;

function assistantText(message: any): string {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("\n");
}

async function isExecutable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(() => true, () => false);
}

async function isScript(path: string): Promise<boolean> {
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return false;
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(2), 0, 2, 0);
    return bytesRead === 2 && buffer.toString("latin1") === "#!";
  } finally {
    await handle.close();
  }
}

/**
 * Find the `pi` to run inside the sandbox. A wrapper script on PATH (for example one that calls
 * `mise use -g` on every launch) writes to the home directory, which the sandbox mounts read-only,
 * so it dies before the model is ever reached. Prefer the first real binary; fall back to the first
 * `pi` of any kind.
 */
export async function findPiBinary(pathVariable = process.env.PATH ?? ""): Promise<string> {
  if (process.env.FOREMAN_PI_BIN) return process.env.FOREMAN_PI_BIN;
  let firstAny: string | undefined;
  for (const directory of pathVariable.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, "pi");
    if (!(await isExecutable(candidate))) continue;
    firstAny ??= candidate;
    if (!(await isScript(candidate))) return candidate;
  }
  if (firstAny) return firstAny;
  throw new Error("Could not find `pi` on PATH. Set FOREMAN_PI_BIN to its full path.");
}

/** A private pi agent dir holding only what the child needs to reach its model. */
async function makeAgentDir(root: string): Promise<string> {
  const source = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi/agent");
  const dir = join(root, "agent");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const name of ["models.json", "auth.json"]) {
    await copyFile(join(source, name), join(dir, name)).catch((error: any) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  return dir;
}

export async function runPiRole(request: RoleRequest): Promise<RoleResult> {
  const definition = parseAgentMarkdown(await readFile(request.promptPath, "utf8"));
  const root = await mkdtemp(join(tmpdir(), "foreman-role-"));
  try {
    const promptPath = join(root, `${request.role}.md`);
    await writeFile(promptPath, definition.body, { mode: 0o600 });
    const agentDir = await makeAgentDir(root);
    const piBin = await findPiBinary();
    const piArgs = [
      "--mode", "json", "-p", "--no-session",
      "--no-extensions", "--no-skills", "--no-prompt-templates",
      "--approve",
      "--model", request.model,
      ...(request.thinking ? ["--thinking", request.thinking] : []),
      "--tools", definition.tools ?? DEFAULT_TOOLS[request.role],
      "--append-system-prompt", promptPath,
      `Task: ${request.task}`,
    ];
    const bwrap = process.env.FOREMAN_BWRAP_BIN || "bwrap";
    const hide = await hiddenMounts(await sensitivePaths(homedir()), { cwd: request.cwd, tmp: tmpdir() });
    const sandbox = bwrapArgs({ role: request.role, cwd: request.cwd, tmp: tmpdir(), uid: process.getuid?.() ?? 1000, hide, browsersPath: await findBrowsersPath() });
    return await execute(request, bwrap, [...sandbox, piBin, ...piArgs], { ...process.env, PI_SUBAGENT_DEPTH: "1", PI_CODING_AGENT_DIR: agentDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function execute(request: RoleRequest, program: string, args: string[], env: NodeJS.ProcessEnv): Promise<RoleResult> {
  return new Promise((resolve) => {
    const child = spawn(program, args, { cwd: request.cwd, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let output = "";
    let toolCount = 0;
    let stopReason: string | undefined;
    let responseProvider: string | undefined;
    let responseModel: string | undefined;
    let error: string | undefined;
    let lastActivity = Date.now();

    const kill = () => {
      try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
      setTimeout(() => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }, 5000).unref();
    };
    const overall = setTimeout(() => { error = "role exceeded its overall timeout"; kill(); }, request.timeoutMs);
    const idle = setInterval(() => {
      if (Date.now() - lastActivity >= request.idleTimeoutMs) { error = "role produced no output before the inactivity deadline"; kill(); }
    }, Math.min(15_000, Math.max(200, Math.floor(request.idleTimeoutMs / 4))));
    const onAbort = () => { error = "role aborted"; kill(); };
    if (request.signal?.aborted) onAbort();
    else request.signal?.addEventListener("abort", onAbort, { once: true });

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let event: any;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === "tool_execution_start") {
        toolCount += 1;
        request.onProgress?.(`${request.role}: ${event.toolName ?? "tool"}`);
      }
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const text = assistantText(event.message);
        if (text) output = text;
        responseProvider = event.message.provider ?? responseProvider;
        responseModel = event.message.model ?? responseModel;
        stopReason = event.message.stopReason ?? stopReason;
        if (event.message.errorMessage) error ||= event.message.errorMessage;
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      lastActivity = Date.now();
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handleLine);
    });
    child.stderr.on("data", (chunk: Buffer) => { lastActivity = Date.now(); stderr += chunk.toString(); });
    child.on("error", (spawnError) => { error ||= `failed to spawn ${program}: ${spawnError.message}`; });
    child.on("close", (code) => {
      clearTimeout(overall);
      clearInterval(idle);
      request.signal?.removeEventListener("abort", onAbort);
      if (buffer.trim()) handleLine(buffer);
      const exitCode = code ?? 1;
      if (exitCode !== 0) error ||= `role exited with code ${exitCode}`;
      const [provider, ...rest] = request.model.split("/");
      const wanted = rest.join("/");
      if (responseProvider !== provider || responseModel !== wanted) {
        error ||= `wrong or missing model: expected ${request.model}, got ${responseProvider ?? "none"}/${responseModel ?? "none"}`;
      }
      if (!output.trim() && toolCount === 0) error ||= "role produced no output and ran no tools";
      resolve({ output, toolCount, stopReason, responseModel, exitCode, stderr, error });
    });
  });
}

export interface CommandResult {
  code: number;
  output: string;
}

/** Runs one success-test command in the Builder sandbox (repo writable, host read-only). */
export async function runSandboxedCommand(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  const bwrap = process.env.FOREMAN_BWRAP_BIN || "bwrap";
  const hide = await hiddenMounts(await sensitivePaths(homedir()), { cwd, tmp: tmpdir() });
  const args = [...bwrapArgs({ role: "builder", cwd, tmp: tmpdir(), uid: process.getuid?.() ?? 1000, hide, browsersPath: await findBrowsersPath() }), "bash", "-c", command];
  return new Promise((resolvePromise) => {
    const child = spawn(bwrap, args, { cwd, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let note = "";
    const kill = () => {
      try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
      setTimeout(() => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }, 5000).unref();
    };
    const timer = setTimeout(() => { note = `\n[foreman] command exceeded ${Math.round(timeoutMs / 1000)}s and was killed`; kill(); }, timeoutMs);
    const onAbort = () => { note = "\n[foreman] aborted"; kill(); };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", (error) => { note = `\n[foreman] failed to start: ${error.message}`; });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolvePromise({ code: note ? (code || 1) : (code ?? 1), output: output + note });
    });
  });
}

export type CommandRunner = typeof runSandboxedCommand;
