import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ForemanConfig } from "./config.ts";
import type { Gpu } from "./gpu.ts";
import { builderTask, parseVerdict, reviewerTask, tail, type Feedback } from "./prompts.ts";
import type { CommandRunner, RoleResult, RoleRunner } from "./sandbox.ts";
import { setAttempts, type StateStore } from "./state.ts";
import type { Task } from "./tasks.ts";

export interface RoleSetting {
  model: string;
  thinking?: string;
}

export interface CycleDeps {
  repo: string;
  /** Where per-attempt evidence is written. Lives under the ignored runtime dir. */
  logDir: string;
  limits: ForemanConfig["limits"];
  builder: RoleSetting;
  reviewer: RoleSetting;
  prompts: { builder: string; reviewer: string };
  runRole: RoleRunner;
  runCommand: CommandRunner;
  gpu: Gpu;
  store: StateStore;
  commit: (message: string) => Promise<{ sha: string; empty: boolean }>;
  /** Runs once tests are green, before each Reviewer pass (e.g. `git add -N .` so new files show in the diff). */
  prepareReview?: () => Promise<void>;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

export type Outcome = { kind: "done"; sha: string } | { kind: "blocked"; reason: string };

/**
 * One task: Builder → success tests → Reviewer → commit. Tests run with no model loaded, and a red
 * test goes straight back to the Builder, so the resident model changes only when the Reviewer runs
 * on a different model than the Builder.
 */
export async function runTask(deps: CycleDeps, task: Task): Promise<Outcome> {
  const { limits, store } = deps;
  const log = deps.log ?? (() => {});
  const blocked = (reason: string): Outcome => ({ kind: "blocked", reason });
  const aborted = (): Outcome | undefined => (deps.signal?.aborted ? blocked("aborted: the run was cancelled or lost the GPU lease") : undefined);

  await mkdir(deps.logDir, { recursive: true });
  const saveLog = async (name: string, content: string): Promise<string> => {
    const relative = `${task.id}-${name}`;
    await writeFile(join(deps.logDir, relative), content);
    return relative;
  };

  const initial = store.get().tasks[task.id];
  let attempts = initial?.attempts ?? 0;
  let feedback: Feedback = { ownerNote: initial?.note };
  if (initial?.lastFailure) {
    const previous = await readFile(join(deps.logDir, initial.lastFailure), "utf8").catch(() => undefined);
    if (previous) feedback.previous = tail(previous);
  }

  const callRole = async (role: "builder" | "reviewer", setting: RoleSetting, taskText: string): Promise<RoleResult> => {
    const loading = deps.gpu.wouldSwap(setting.model);
    const idleSeconds = loading ? Math.max(limits.idleTimeoutSeconds, limits.modelLoadTimeoutSeconds) : limits.idleTimeoutSeconds;
    return deps.gpu.withModel(setting.model, () => deps.runRole({
      role,
      model: setting.model,
      thinking: setting.thinking,
      cwd: deps.repo,
      promptPath: deps.prompts[role],
      task: taskText,
      timeoutMs: limits.roleTimeoutSeconds * 1000,
      idleTimeoutMs: idleSeconds * 1000,
      signal: deps.signal,
      onProgress: log,
    }));
  };

  while (true) {
    const stop = aborted();
    if (stop) return stop;
    if (attempts >= limits.buildAttempts) {
      return blocked(`used ${limits.buildAttempts} build attempts without an approved result; see ${store.get().tasks[task.id]?.lastFailure ?? "logs"}`);
    }
    attempts += 1;
    await store.update((state) => setAttempts(state, task.id, attempts));
    log(`${task.id}: build attempt ${attempts}/${limits.buildAttempts}`);

    const fail = async (name: string, content: string): Promise<void> => {
      const file = await saveLog(name, content);
      feedback = { previous: tail(content) };
      await store.update((state) => setAttempts(state, task.id, attempts, file));
    };

    const built = await callRole("builder", deps.builder, builderTask(task, attempts, limits.buildAttempts, feedback));
    await saveLog(`attempt${attempts}-builder.txt`, built.output || built.stderr);
    if (aborted()) return aborted()!;
    if (built.error) {
      const detail = tail(built.output || built.stderr);
      // No output, no tool calls, non-zero exit: the role never started (missing binary, sandbox or
      // config problem). Retrying cannot help and only burns attempts, so stop and say why.
      if (built.exitCode !== 0 && built.toolCount === 0 && !built.output.trim()) {
        const file = await saveLog(`attempt${attempts}-launch-failure.txt`, `Builder could not start: ${built.error}\n${detail}`);
        await store.update((state) => setAttempts(state, task.id, attempts, file));
        return blocked(`Builder could not start: ${built.error}${detail ? ` — ${detail.split("\n")[0]}` : ""}; see ${file}`);
      }
      await fail(`attempt${attempts}-failure.txt`, `Builder run failed: ${built.error}\n${detail}`);
      continue;
    }

    let red: string | undefined;
    for (const command of task.successTests) {
      const outcome = await deps.runCommand(command, deps.repo, limits.testTimeoutSeconds * 1000, deps.signal);
      if (aborted()) return aborted()!;
      if (outcome.code !== 0) {
        red = `Success test failed.\nCommand: ${command}\nExit code: ${outcome.code}\nOutput:\n${tail(outcome.output)}`;
        break;
      }
    }
    if (red) {
      await fail(`attempt${attempts}-tests.txt`, red);
      continue;
    }

    await deps.prepareReview?.();
    let verdict: ReturnType<typeof parseVerdict>;
    for (let review = 1; review <= limits.reviewAttempts && !verdict; review++) {
      const reviewed = await callRole("reviewer", deps.reviewer, reviewerTask(task, review));
      await saveLog(`attempt${attempts}-review${review}.txt`, reviewed.output || reviewed.stderr);
      if (aborted()) return aborted()!;
      if (!reviewed.error) verdict = parseVerdict(reviewed.output);
    }
    if (!verdict) {
      const file = await saveLog(`attempt${attempts}-review-failure.txt`, "Reviewer did not return an exact ## Verdict section.");
      await store.update((state) => setAttempts(state, task.id, attempts, file));
      return blocked(`Reviewer returned no verdict in ${limits.reviewAttempts} attempts; see ${file}`);
    }
    if (verdict.verdict === "changes") {
      await fail(`attempt${attempts}-changes.txt`, `Reviewer requested changes:\n${verdict.notes || "(no details given)"}`);
      continue;
    }

    const commit = await deps.commit(`foreman: ${task.id} — ${task.goal.split("\n")[0].slice(0, 72)}`);
    return { kind: "done", sha: commit.sha };
  }
}
