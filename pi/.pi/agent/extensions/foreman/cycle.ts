import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ForemanConfig } from "./config.ts";
import type { Gpu } from "./gpu.ts";
import { builderTask, parseVerdict, reviewerTask, tail, type Feedback } from "./prompts.ts";
import type { CommandRunner, RoleResult, RoleRunner } from "./sandbox.ts";
import { setAttempts, setStage, type StateStore } from "./state.ts";
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
  /** Latest detail line (a tool call, a line of test output). */
  log?: (message: string) => void;
  /** A new phase began: building, testing, reviewing or committing. */
  phase?: (text: string) => void;
  /** Before the success tests: clear output left by earlier runs so recordings are attributed correctly. */
  resetTestOutput?: () => Promise<void>;
  /** After the success tests (pass or fail): keep their videos and screenshots. Returns a one-line summary. */
  collect?: (taskId: string, attempt: number) => Promise<string | undefined>;
}

/** Everything worth knowing about a role run that produced nothing usable. */
function diagnostics(result: RoleResult, model: string): string {
  return [
    `model: ${model}`,
    `exit code: ${result.exitCode}`,
    `stop reason: ${result.stopReason ?? "none"}`,
    `tool calls: ${result.toolCount}`,
    ...(result.durationMs !== undefined ? [`duration: ${(result.durationMs / 1000).toFixed(1)}s`] : []),
    `error: ${result.error ?? "none"}`,
    result.output.trim() ? `reply (tail):\n${tail(result.output, 1500)}` : "reply: (empty)",
    ...(result.stderr.trim() ? [`stderr (tail):\n${tail(result.stderr, 1500)}`] : []),
  ].join("\n");
}

/** One line for the block message: why there was no verdict. */
function noVerdictCause(result: RoleResult): string {
  if (result.error) return result.error;
  const facts = `stop reason ${result.stopReason ?? "none"}, ${result.toolCount} tool call${result.toolCount === 1 ? "" : "s"}`;
  return result.output.trim() ? `reply without a ## Verdict section (${facts})` : `empty reply (${facts})`;
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
  // Only the review failed last time: keep the Builder's work and go straight back to review.
  let resumeAtReview = initial?.stage === "review";
  if (resumeAtReview) await store.update((state) => setStage(state, task.id, undefined));
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
    const fail = async (name: string, content: string): Promise<void> => {
      const file = await saveLog(name, content);
      feedback = { previous: tail(content) };
      await store.update((state) => setAttempts(state, task.id, attempts, file));
    };

    if (!resumeAtReview) {
      if (attempts >= limits.buildAttempts) {
        return blocked(`used ${limits.buildAttempts} build attempts without an approved result; see ${store.get().tasks[task.id]?.lastFailure ?? "logs"}`);
      }
      attempts += 1;
      await store.update((state) => setAttempts(state, task.id, attempts));
      log(`${task.id}: build attempt ${attempts}/${limits.buildAttempts}`);


      deps.phase?.(`Builder · attempt ${attempts}/${limits.buildAttempts} · ${deps.builder.model}`);
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

      await deps.resetTestOutput?.();
      let red: string | undefined;
      for (const [index, command] of task.successTests.entries()) {
        deps.phase?.(`Testing ${index + 1}/${task.successTests.length} · ${command}`);
        const outcome = await deps.runCommand(command, deps.repo, limits.testTimeoutSeconds * 1000, deps.signal, (line) => log(line));
        if (aborted()) return aborted()!;
        if (outcome.code !== 0) {
          red = `Success test failed.\nCommand: ${command}\nExit code: ${outcome.code}\nOutput:\n${tail(outcome.output)}`;
          break;
        }
      }
      const recorded = await deps.collect?.(task.id, attempts).catch(() => undefined);
      if (recorded) log(recorded);
      if (red) {
        await fail(`attempt${attempts}-tests.txt`, red);
        continue;
      }

    }
    resumeAtReview = false;

    await deps.prepareReview?.();
    let verdict: ReturnType<typeof parseVerdict>;
    let lastReview: RoleResult | undefined;
    const reviewLog: string[] = [];
    for (let review = 1; review <= limits.reviewAttempts && !verdict; review++) {
      deps.phase?.(`Reviewer · review ${review}/${limits.reviewAttempts} · ${deps.reviewer.model}`);
      const reviewed = await callRole("reviewer", deps.reviewer, reviewerTask(task, review, lastReview ? { text: lastReview.output } : undefined));
      lastReview = reviewed;
      await saveLog(`attempt${attempts}-review${review}.txt`, reviewed.output || reviewed.stderr || diagnostics(reviewed, deps.reviewer.model));
      if (aborted()) return aborted()!;
      if (!reviewed.error) verdict = parseVerdict(reviewed.output);
      if (!verdict) reviewLog.push(`--- review ${review} ---\n${diagnostics(reviewed, deps.reviewer.model)}`);
    }
    if (!verdict) {
      const file = await saveLog(`attempt${attempts}-review-failure.txt`, `The Reviewer did not return an exact ## Verdict section.\n\n${reviewLog.join("\n\n")}\n`);
      await store.update((state) => setStage(setAttempts(state, task.id, attempts, file), task.id, "review"));
      return blocked(`Reviewer returned no verdict in ${limits.reviewAttempts} attempts (last: ${lastReview ? noVerdictCause(lastReview) : "no run"}); the Builder's work is kept and only the review is retried after /foreman unblock; details: ${file}`);
    }
    if (verdict.verdict === "changes") {
      await fail(`attempt${attempts}-changes.txt`, `Reviewer requested changes:\n${verdict.notes || "(no details given)"}`);
      continue;
    }

    deps.phase?.("Committing");
    const commit = await deps.commit(`foreman: ${task.id} — ${task.goal.split("\n")[0].slice(0, 72)}`);
    return { kind: "done", sha: commit.sha };
  }
}
