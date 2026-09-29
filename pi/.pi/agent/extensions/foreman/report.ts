import type { State } from "./state.ts";
import type { Task } from "./tasks.ts";

const ICON = { done: "✔", running: "▶", pending: "·", blocked: "✖" } as const;

export function formatStatus(tasks: Task[], state: State): string {
  if (tasks.length === 0) return "No plan yet. Run /foreman plan <idea | prd.md>.";
  const lines = tasks.map((task) => {
    const current = state.tasks[task.id];
    const status = current?.status ?? "pending";
    const extra = [
      current && current.attempts > 0 ? `${current.attempts} attempt(s)` : undefined,
      current?.commit ? current.commit.slice(0, 8) : undefined,
    ].filter(Boolean).join(", ");
    const head = `${ICON[status]} ${task.id.padEnd(28)} ${status}${extra ? ` (${extra})` : ""}`;
    return status === "blocked" && current?.blockedReason ? `${head}\n    ${current.blockedReason}` : head;
  });
  const done = tasks.filter((task) => state.tasks[task.id]?.status === "done").length;
  const header = `${done}/${tasks.length} done${state.paused ? " · paused" : ""}${state.branch ? ` · branch ${state.branch}` : ""}`;
  return [header, ...lines].join("\n");
}

const ANSI = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[1;32m", red: "\x1b[1;31m", yellow: "\x1b[1;33m", cyan: "\x1b[1;36m" };
const paint = (color: keyof typeof ANSI, text: string): string => `${ANSI[color]}${text}${ANSI.reset}`;

export interface Board {
  /** Lines for the widget above the editor. */
  lines: string[];
  /** Plain one-line summary for the terminal title. */
  title: string;
  /** True for end states, which are worth a terminal bell. */
  final: boolean;
}

/** Live view while a run is in progress. */
export function progressBoard(progress: { done: number; total: number; taskId: string; activity?: string }): Board {
  const head = `${paint("cyan", "▶ foreman")}  ${progress.done}/${progress.total} done · working on ${paint("bold", progress.taskId)}`;
  return {
    lines: [head, ...(progress.activity ? [`   ${progress.activity}`] : []), "   /foreman pause: stop after this task · /foreman stop: abort now"],
    title: `foreman ▶ ${progress.done}/${progress.total} ${progress.taskId}`,
    final: false,
  };
}

/** The result of a run. Stays on screen until the next /foreman command, so it is what you see on return. */
export function finalBoard(summary: { kind: "idle" | "paused" | "blocked"; taskId?: string; reason?: string }, total: number, doneCount: number, branch: string): Board {
  if (summary.kind === "idle") {
    return {
      lines: [
        paint("green", `✔ foreman  finished: all ${total} task(s) done`),
        `   branch ${branch}`,
        `   review: git log --oneline main..${branch}   merge it yourself when happy`,
      ],
      title: `foreman ✔ done ${total}/${total}`,
      final: true,
    };
  }
  if (summary.kind === "paused") {
    return {
      lines: [paint("yellow", `⏸ foreman  paused: ${doneCount}/${total} done`), "   /foreman run to continue"],
      title: `foreman ⏸ paused ${doneCount}/${total}`,
      final: true,
    };
  }
  return {
    lines: [
      paint("red", `✖ foreman  blocked on ${summary.taskId}  (${doneCount}/${total} done)`),
      `   ${summary.reason ?? "unknown reason"}`,
      `   fix it or guide the Builder: /foreman unblock ${summary.taskId} [note], then /foreman run`,
    ],
    title: `foreman ✖ blocked ${summary.taskId}`,
    final: true,
  };
}
