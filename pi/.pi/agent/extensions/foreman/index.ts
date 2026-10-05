import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Foreman, SUBCOMMANDS, type Host } from "./commands.ts";
import { readHostMode, shellLeaseClient } from "./gpu.ts";
import { realPreviewDeps } from "./preview.ts";
import { runPiRole, runSandboxedCommand, spawnSandboxedApp } from "./sandbox.ts";
import { spawn } from "node:child_process";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));

export default async function foremanExtension(pi: ExtensionAPI): Promise<void> {
  const foreman = new Foreman({
    extensionDir: EXTENSION_DIR,
    configPaths: (cwd) => [join(homedir(), ".pi/agent/foreman.json"), join(cwd, ".pi/foreman.json")],
    runRole: runPiRole,
    runCommand: runSandboxedCommand,
    makeLeaseClient: shellLeaseClient,
    readMode: (command) => readHostMode(command),
    // Opens the owner's default browser or viewer on their own desktop; not sandboxed, by design.
    openUrl: (target) => new Promise<void>((resolve, reject) => {
      const child = spawn("xdg-open", [target], { detached: true, stdio: "ignore" });
      // xdg-open normally returns at once; if it lingers (a browser started in the foreground), stop waiting.
      const done = setTimeout(resolve, 3000);
      child.on("error", (error) => { clearTimeout(done); reject(error); });
      child.on("exit", (code) => { clearTimeout(done); code === 0 || code === null ? resolve() : reject(new Error(`xdg-open exited with ${code}`)); });
      child.unref();
    }),
    preview: { ...realPreviewDeps, start: (command, options) => spawnSandboxedApp(command, options) },
    // The Architect works in the current session. ctx.newSession() would start on the default model
    // and re-create this extension's runtime, orphaning the planning lease, so it is not used.
    startArchitect: async (host, kickoff, profile) => {
      const ctx = (host as Host & { ctx: ExtensionCommandContext }).ctx;
      if (profile) {
        const model = ctx.modelRegistry.find(profile.provider, profile.model);
        if (!model) throw new Error(`Architect model is not available: ${profile.provider}/${profile.model}`);
        if (!(await pi.setModel(model))) throw new Error(`Architect model has no usable authentication: ${profile.provider}/${profile.model}`);
        if (profile.thinking) pi.setThinkingLevel(profile.thinking as Parameters<typeof pi.setThinkingLevel>[0]);
        host.notify(`Architect: ${profile.provider}/${profile.model}${profile.thinking ? ` (thinking ${profile.thinking})` : ""}. Use /new first if you want a clean context.`);
      }
      await pi.sendUserMessage(kickoff);
    },
  });

  const hostFor = (ctx: ExtensionCommandContext): Host & { ctx: ExtensionCommandContext } => ({
    ctx,
    cwd: ctx.cwd,
    notify: (message, level) => ctx.ui.notify(message, level),
    setStatus: (text) => ctx.ui.setStatus("foreman", text),
    // A function is redrawn at the terminal's current width; plain lines are shown as they are.
    setWidget: (content) => {
      if (typeof content === "function") ctx.ui.setWidget("foreman", () => ({ render: content, invalidate: () => {} }));
      else ctx.ui.setWidget("foreman", content);
    },
    setTitle: (title) => ctx.ui.setTitle(title),
    bell: () => { process.stdout.write("\x07"); },
  });

  pi.registerCommand("foreman", {
    description: "Build an MVP from an idea or PRD with local models, one task at a time",
    getArgumentCompletions: (prefix) => {
      if (/\s/.test(prefix)) return null;
      const matches = SUBCOMMANDS.filter((name) => name.startsWith(prefix));
      return matches.length ? matches.map((name) => ({ value: name, label: name })) : null;
    },
    handler: async (args, ctx) => foreman.handle(args, hostFor(ctx)),
  });

  pi.on("session_shutdown", async () => foreman.shutdown());
}
