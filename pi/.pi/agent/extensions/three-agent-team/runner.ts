import { spawn } from "node:child_process";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedIdentity, roleModel, writeChildAgentConfig, type TeamConfig } from "./config.ts";

export const STALE_STREAM_ERROR = "role produced no process event before the configured inactivity deadline";
export const MISSING_FINISH_REASON_ERROR = "Stream ended without finish_reason";
const ROLE_LAUNCHER = fileURLToPath(new URL("./role-launcher.py", import.meta.url));

export interface RoleProcessIdentity {
  role: "builder" | "reviewer";
  pid: number;
  pgid: number;
  processStart: string;
}

export interface RoleResult {
  role: "builder" | "reviewer";
  requestedModel: string;
  responseProvider?: string;
  responseModel?: string;
  stopReason?: string;
  output: string;
  stderr: string;
  exitCode: number;
  toolCount: number;
  error?: string;
}

function exactRequestedIdentity(result: RoleResult): boolean {
  const slash = result.requestedModel.indexOf("/");
  if (slash < 1) return false;
  return result.responseProvider === result.requestedModel.slice(0, slash)
    && result.responseModel === result.requestedModel.slice(slash + 1);
}

export function isRetryableStaleRoleResult(result: RoleResult): boolean {
  return result.error === STALE_STREAM_ERROR
    && exactRequestedIdentity(result)
    && result.toolCount > 0;
}

export function hasTerminalEnvelopeDespiteMissingFinishReason(result: RoleResult): boolean {
  return result.error === MISSING_FINISH_REASON_ERROR
    && result.exitCode === 0
    && result.stopReason === "stop"
    && exactRequestedIdentity(result)
    && result.toolCount > 0
    && result.output.trim().length > 0;
}

export function isContinuableLengthRoleResult(result: RoleResult): boolean {
  return result.stopReason === "length"
    && result.exitCode === 0
    && !result.error
    && exactRequestedIdentity(result)
    && (result.toolCount > 0 || result.output.trim().length > 0);
}

function promptBody(markdown: string): string {
  if (!markdown.startsWith("---\n")) return markdown;
  const end = markdown.indexOf("\n---\n", 4);
  return end < 0 ? markdown : markdown.slice(end + 5);
}

function assistantText(message: any): string {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("\n");
}

export async function runRole(options: {
  role: "builder" | "reviewer";
  config: TeamConfig;
  cwd: string;
  task: string;
  promptPath: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  timeoutMs?: number;
  sessionId?: string;
  sessionDir?: string;
  /** Called while the child process group is SIGSTOPed, before the role executable starts. */
  onSpawn?: (identity: RoleProcessIdentity) => Promise<void>;
}): Promise<RoleResult> {
  const profile = options.config.roles[options.role];
  const requestedModel = roleModel(options.config, options.role);
  const expected = expectedIdentity(options.config, options.role);
  const tools = options.role === "builder"
    ? "read,grep,find,ls,bash,edit,write"
    : "read,grep,find,ls,bash";
  const sourcePrompt = await readFile(options.promptPath, "utf8");
  const temporaryDir = await mkdtemp(join(tmpdir(), "pi-three-agent-role-"));
  const promptPath = join(temporaryDir, `${options.role}.md`);
  const agentDir = join(temporaryDir, "agent");
  await writeFile(promptPath, promptBody(sourcePrompt), { encoding: "utf8", mode: 0o600 });
  const childConfigFiles = await writeChildAgentConfig(options.config, agentDir);

  const piBin = process.env.PI_THREE_AGENT_PI_BIN || "pi";
  const sessionArgs = options.sessionId
    ? ["--session-id", options.sessionId, ...(options.sessionDir ? ["--session-dir", options.sessionDir] : [])]
    : ["--no-session"];
  const args = [
    "--mode", "json", "-p", ...sessionArgs,
    "--no-extensions", "--no-skills", "--no-prompt-templates",
    "--approve",
    "--model", requestedModel,
    "--thinking", profile.thinking,
    "--tools", tools,
    "--append-system-prompt", promptPath,
    `Task: ${options.task}`,
  ];

  let stdoutBuffer = "";
  let stderr = "";
  let output = "";
  let responseProvider: string | undefined;
  let responseModel: string | undefined;
  let stopReason: string | undefined;
  let error: string | undefined;
  let toolCount = 0;
  let timedOut = false;
  let idleTimedOut = false;
  let aborted = false;
  let lastActivityAt = Date.now();

  try {
    const exitCode = await new Promise<number>((resolvePromise) => {
      const sandboxedBuilder = options.role === "builder";
      const executable = sandboxedBuilder
        ? (process.env.PI_THREE_AGENT_BWRAP_BIN || "bwrap")
        : piBin;
      const executableArgs = sandboxedBuilder
        ? [
            "--die-with-parent",
            "--unshare-pid", "--unshare-ipc", "--unshare-uts",
            "--ro-bind", "/", "/",
            "--dev", "/dev",
            "--proc", "/proc",
            "--bind", options.cwd, options.cwd,
            "--bind", tmpdir(), tmpdir(),
            "--tmpfs", `/run/user/${process.getuid?.() ?? 1000}`,
            "--tmpfs", "/run/dbus",
            "--setenv", "DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/blocked/bus",
            "--setenv", "npm_config_cache", join(tmpdir(), "pi-three-agent-npm-cache"),
            "--setenv", "npm_config_update_notifier", "false",
            "--setenv", "UV_CACHE_DIR", join(tmpdir(), "pi-three-agent-uv-cache"),
            "--setenv", "XDG_CACHE_HOME", join(tmpdir(), "pi-three-agent-xdg-cache"),
            piBin,
            ...args,
          ]
        : args;
      // The bundled launcher reports its PID/start identity on fd 3, then
      // SIGSTOPs itself. The dispatcher journals that identity before SIGCONT
      // permits exec, so no role tool can run ahead of its durable fence.
      const child = spawn("python3", [ROLE_LAUNCHER, executable, ...executableArgs], {
        cwd: options.cwd,
        env: { ...process.env, PI_SUBAGENT_DEPTH: "1", PI_CODING_AGENT_DIR: agentDir },
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe", "pipe"],
      });
      let launchReady = false;
      let launchBuffer = "";
      const launchPipe = child.stdio[3];
      const terminate = () => {
        try { if (child.pid) process.kill(-child.pid, "SIGCONT"); } catch { /* ignore */ }
        try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { /* ignore */ }
        setTimeout(() => {
          try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* ignore */ }
        }, 5000).unref();
      };
      launchPipe?.on("data", (chunk: Buffer) => {
        if (launchReady) return;
        launchBuffer += chunk.toString("utf8");
        const newline = launchBuffer.indexOf("\n");
        if (newline < 0) return;
        launchReady = true;
        void (async () => {
          try {
            const identity = JSON.parse(launchBuffer.slice(0, newline)) as { pid?: unknown; pgid?: unknown; processStart?: unknown };
            if (!Number.isSafeInteger(identity.pid) || Number(identity.pid) !== child.pid || !Number.isSafeInteger(identity.pgid) || Number(identity.pgid) < 1 || typeof identity.processStart !== "string" || !identity.processStart) {
              throw new Error("role launcher returned an invalid process identity");
            }
            await options.onSpawn?.({ role: options.role, pid: Number(identity.pid), pgid: Number(identity.pgid), processStart: identity.processStart });
            if (options.signal?.aborted) throw options.signal.reason ?? new Error("role aborted before launch");
            process.kill(-Number(identity.pid), "SIGCONT");
          } catch (launchError) {
            error = `role launch was not authorized: ${launchError instanceof Error ? launchError.message : String(launchError)}`;
            try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* ignore */ }
          }
        })();
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, options.timeoutMs ?? options.config.limits.roleTimeoutSeconds * 1000);
      const idleTimeoutMs = options.config.limits.idleTimeoutSeconds * 1000;
      const idleWatchdog = setInterval(() => {
        if (Date.now() - lastActivityAt >= idleTimeoutMs) {
          idleTimedOut = true;
          terminate();
        }
      }, Math.min(15_000, Math.max(1000, Math.floor(idleTimeoutMs / 4))));

      const processLine = (line: string) => {
        if (!line.trim()) return;
        lastActivityAt = Date.now();
        let event: any;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === "tool_execution_start") {
          toolCount += 1;
          options.onProgress?.(`${options.role}: ${event.toolName ?? "tool"}`);
        }
        if (event.type === "message_end" && event.message?.role === "assistant") {
          const text = assistantText(event.message);
          if (text) output = text;
          responseProvider = event.message.provider ?? responseProvider;
          responseModel = event.message.model ?? responseModel;
          stopReason = event.message.stopReason ?? stopReason;
          if (event.message.errorMessage) error = event.message.errorMessage;
          if (stopReason && stopReason !== "stop" && stopReason !== "toolUse" && stopReason !== "length") {
            error ||= `assistant stop reason: ${stopReason}`;
          }
        }
      };

      child.stdout!.on("data", (chunk) => {
        lastActivityAt = Date.now();
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });
      child.stderr!.on("data", (chunk) => {
        lastActivityAt = Date.now();
        stderr += chunk.toString();
      });
      child.on("error", (spawnError) => {
        error = `failed to spawn Pi: ${spawnError.message}`;
      });
      const abort = () => {
        aborted = true;
        terminate();
      };
      child.on("close", (code) => {
        clearTimeout(timeout);
        clearInterval(idleWatchdog);
        options.signal?.removeEventListener("abort", abort);
        if (!launchReady) error ||= "role launcher exited before reporting process identity";
        if (stdoutBuffer.trim()) processLine(stdoutBuffer);
        resolvePromise(code ?? 1);
      });
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });

    if (timedOut) error = "role exceeded its overall timeout";
    if (idleTimedOut) error = STALE_STREAM_ERROR;
    if (aborted) error = "role aborted";
    if (exitCode !== 0) error ||= `Pi exited with code ${exitCode}`;
    if (responseProvider !== expected.provider) {
      error ||= `wrong or missing provider: expected ${expected.provider}, got ${responseProvider ?? "none"}`;
    }
    if (responseModel !== expected.model) {
      error ||= `wrong or missing model: expected ${expected.model}, got ${responseModel ?? "none"}`;
    }
    if (stopReason === "length" && !output.trim() && toolCount === 0) {
      error ||= "assistant reached the configured output limit without measurable progress";
    }
    if (!output.trim() && toolCount === 0) error ||= "role produced no final output and executed no tools";
    return { role: options.role, requestedModel, responseProvider, responseModel, stopReason, output, stderr, exitCode, toolCount, error };
  } finally {
    await unlink(promptPath).catch(() => undefined);
    for (const path of childConfigFiles) await unlink(path).catch(() => undefined);
    await rmdir(agentDir).catch(() => undefined);
    await rmdir(temporaryDir).catch(() => undefined);
  }
}
