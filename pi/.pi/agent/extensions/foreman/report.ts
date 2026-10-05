import type { State } from "./state.ts";
import type { Task } from "./tasks.ts";

const STATUS_ICON = { done: "✔", running: "▶", pending: "·", blocked: "✖" } as const;

export function formatStatus(tasks: Task[], state: State): string {
  if (tasks.length === 0) return "No plan yet. Run /foreman plan <idea | prd.md>.";
  const lines = tasks.map((task) => {
    const current = state.tasks[task.id];
    const status = current?.status ?? "pending";
    const extra = [
      current && current.attempts > 0 ? `${current.attempts} attempt(s)` : undefined,
      current?.commit ? current.commit.slice(0, 8) : undefined,
    ].filter(Boolean).join(", ");
    const head = `${STATUS_ICON[status]} ${task.id.padEnd(28)} ${status}${extra ? ` (${extra})` : ""}`;
    return status === "blocked" && current?.blockedReason ? `${head}\n    ${current.blockedReason}` : head;
  });
  const done = tasks.filter((task) => state.tasks[task.id]?.status === "done").length;
  const header = `${done}/${tasks.length} done${state.paused ? " · paused" : ""}${state.branch ? ` · branch ${state.branch}` : ""}`;
  return [header, ...lines].join("\n");
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

const ANSI = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[1;32m", red: "\x1b[1;31m", yellow: "\x1b[1;33m", cyan: "\x1b[1;36m" };
const paint = (color: keyof typeof ANSI, text: string): string => `${ANSI[color]}${text}${ANSI.reset}`;

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const visibleLength = (text: string): number => [...text.replace(ANSI_PATTERN, "")].length;

/** Shorten plain text to `width` characters, ending in an ellipsis. */
function fit(text: string, width: number): string {
  const chars = [...text];
  return chars.length <= width ? text : `${chars.slice(0, Math.max(0, width - 1)).join("")}…`;
}

/** One sentence, on one line. */
const firstSentence = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](\s|$)/);
  return end < 0 ? flat : flat.slice(0, end + 1);
};

export interface Board {
  /** The panel at a default width, for tests and plain consumers. */
  lines: string[];
  /** The panel for a given terminal width; called again whenever the terminal redraws. */
  render: (width: number) => string[];
  /** Plain one-line summary for the terminal title. */
  title: string;
  /** True for end states, which are worth a terminal bell. */
  final: boolean;
}

export interface PanelInput {
  /** Plan title, shown after "foreman" in the border. */
  title?: string;
  run: "running" | "finished" | "paused" | "blocked";
  tasks: Task[];
  state: State;
  /** The task being worked on (running) or that blocked the run. */
  currentId?: string;
  maxAttempts: number;
  phase?: string;
  detail?: string;
  blocked?: { taskId: string; reason: string };
  previewUrl?: string;
  branch?: string;
  /** Where to look: the task file, the logs. Shown on the File line. */
  files?: string[];
  runStartedAt: number;
  phaseStartedAt?: number;
  /** Rows of the task list before it collapses to a "+N more" marker. */
  maxRows?: number;
  /** For tests. */
  now?: number;
}

const MAX_PANEL_WIDTH = 110;
const LABEL_WIDTH = 8;

const STATE_LABEL = {
  running: paint("cyan", "running"),
  finished: paint("green", "finished"),
  paused: paint("yellow", "paused"),
  blocked: paint("red", "blocked"),
} as const;

const ICON = {
  done: paint("green", "✓"),
  running: paint("cyan", "▸"),
  blocked: paint("red", "✖"),
  pending: paint("dim", "·"),
} as const;

function progressBar(done: number, total: number, cells = 10): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * cells);
  return `[${"█".repeat(filled)}${"░".repeat(cells - filled)}]`;
}

/** Which tasks to list: all of them, or a window around the anchor plus one "+N" marker line. */
function taskWindow(total: number, anchor: number, maxRows: number): { from: number; to: number; before: number; after: number } {
  if (total <= maxRows) return { from: 0, to: total, before: 0, after: 0 };
  const visible = Math.max(1, maxRows - 1); // the last row is the marker
  const from = Math.min(Math.max(0, anchor - 1), total - visible);
  return { from, to: from + visible, before: from, after: total - (from + visible) };
}

/** Cut a line with color codes to `width` visible characters, ending in an ellipsis; colors are kept and closed. */
function clip(content: string, width: number): string {
  if (visibleLength(content) <= width) return content;
  let out = "";
  let shown = 0;
  for (let i = 0; i < content.length && shown < width - 1;) {
    const escape = /^\x1b\[[0-9;]*m/.exec(content.slice(i));
    if (escape) {
      out += escape[0];
      i += escape[0].length;
      continue;
    }
    const char = String.fromCodePoint(content.codePointAt(i)!);
    out += char;
    i += char.length;
    shown += 1;
  }
  return `${out}…${ANSI.reset}`;
}

/** A labelled box. Every row is padded to exactly `width`, so the frame never breaks. */
function frame(width: number, title: string, sections: { label?: string; lines: string[] }[], footer: string): string[] {
  const inner = width - 4;
  const rule = (left: string, label: string, right: string): string => {
    const text = label ? ` ${label} ` : "";
    const room = width - 2 - 1 - visibleLength(text);
    return `${left}─${text}${"─".repeat(Math.max(0, room))}${right}`;
  };
  const row = (raw: string): string => {
    const content = clip(raw, inner);
    return `│ ${content}${" ".repeat(Math.max(0, inner - visibleLength(content)))} │`;
  };
  const out = [rule("╭", title, "╮")];
  sections.forEach((section, index) => {
    if (index > 0) out.push(rule("├", section.label ?? "", "┤"));
    for (const line of section.lines) out.push(row(line));
  });
  out.push(rule("╰", footer, "╯"));
  return out;
}

/** The dashboard: status header, task list, what is happening now, how it is verified, where to look. */
export function renderPanel(input: PanelInput, requestedWidth: number): string[] {
  const width = Math.max(40, Math.min(requestedWidth, MAX_PANEL_WIDTH));
  const inner = width - 4;
  const now = input.now ?? Date.now();
  const statusOf = (task: Task): keyof typeof ICON => {
    const status = input.state.tasks[task.id]?.status ?? "pending";
    return task.id === input.currentId && input.run === "running" ? "running" : status === "running" ? "running" : status;
  };
  const done = input.tasks.filter((task) => input.state.tasks[task.id]?.status === "done").length;
  const open = input.tasks.length - done;

  const header = [
    `${STATE_LABEL[input.run]} · ${formatElapsed(now - input.runStartedAt)} · ${paint("green", `✓${done} done`)} · ${open} open  ${progressBar(done, input.tasks.length)}`,
  ];

  const currentIndex = input.tasks.findIndex((task) => task.id === input.currentId);
  const firstOpen = input.tasks.findIndex((task) => input.state.tasks[task.id]?.status !== "done");
  const anchor = currentIndex >= 0 ? currentIndex : firstOpen >= 0 ? firstOpen : Math.max(0, input.tasks.length - 1);
  const window = taskWindow(input.tasks.length, anchor, input.maxRows ?? 7);
  const idWidth = Math.min(24, Math.max(...input.tasks.map((task) => task.id.length), 4));
  const taskLines: string[] = [];
  for (const task of input.tasks.slice(window.from, window.to)) {
    const status = statusOf(task);
    const attempts = input.state.tasks[task.id]?.attempts ?? 0;
    const note = status === "running" ? ` · attempt ${Math.max(1, attempts)}/${input.maxAttempts}` : status === "blocked" ? " · blocked" : "";
    const room = inner - 2 - idWidth - 1;
    const goal = fit(firstSentence(task.goal), Math.max(8, room - note.length));
    const id = fit(task.id, idWidth).padEnd(idWidth);
    taskLines.push(`${ICON[status]} ${status === "running" ? paint("bold", id) : id} ${goal}${note ? paint("dim", note) : ""}`);
  }
  if (window.before || window.after) {
    const parts = [window.before ? `+${window.before} earlier` : "", window.after ? `+${window.after} more` : ""].filter(Boolean);
    taskLines.push(paint("dim", `… ${parts.join(" · ")}`));
  }

  const labelled = (label: string, text: string): string => `${paint("dim", label.padEnd(LABEL_WIDTH))}${text}`;
  const current = input.tasks.find((task) => task.id === input.currentId);
  const info: string[] = [];
  const room = inner - LABEL_WIDTH;
  if (input.run === "running") {
    const elapsed = input.phaseStartedAt !== undefined ? ` · ${formatElapsed(now - input.phaseStartedAt)}` : "";
    if (input.phase) info.push(labelled("Now", paint("bold", fit(`${input.phase}${elapsed}`, room))));
    if (input.detail) info.push(labelled("", `› ${fit(input.detail, room - 2)}`));
  } else if (input.run === "blocked" && input.blocked) {
    // The reason is the point of this view: wrap it over two lines before cutting it off.
    const reason = [...input.blocked.reason.split("\n")[0]];
    info.push(labelled("Blocked", reason.slice(0, room).join("")));
    if (reason.length > room) info.push(labelled("", fit(reason.slice(room, room * 2).join(""), room)));
    info.push(labelled("Next", fit(`/foreman unblock ${input.blocked.taskId} [note], then /foreman run`, room)));
  } else if (input.run === "finished") {
    if (input.branch) info.push(labelled("Branch", fit(input.branch, room)));
    if (input.branch) info.push(labelled("Review", fit(`git log --oneline main..${input.branch}   then merge it yourself`, room)));
  } else if (input.run === "paused") {
    info.push(labelled("Next", "/foreman run continues"));
  }
  if (current && input.run !== "finished") info.push(labelled("Verify", fit(current.successTests.join(" · "), room)));
  if (input.previewUrl) info.push(labelled("Preview", fit(input.previewUrl, room)));
  if (input.files?.length) info.push(labelled("File", fit(input.files.join(" · "), room)));

  const title = `${paint("cyan", "foreman")}${input.title ? ` · ${fit(input.title, Math.max(8, width - 20))}` : ""}`;
  const footer = {
    running: "/foreman pause · /foreman stop",
    finished: "/foreman status · /foreman recordings",
    paused: "/foreman run · /foreman status",
    blocked: "/foreman status",
  }[input.run];
  const sections = [
    { lines: header },
    { label: `Tasks · ✓${done} done · ${open} open`, lines: taskLines },
    ...(info.length ? [{ label: "", lines: info }] : []),
  ];
  return frame(width, title, sections, footer);
}

function makeBoard(input: PanelInput, title: string, final: boolean): Board {
  const render = (width: number) => renderPanel(input, width);
  return { lines: render(100), render, title, final };
}

export function progressBoard(input: PanelInput): Board {
  const done = input.tasks.filter((task) => input.state.tasks[task.id]?.status === "done").length;
  const phase = input.phase ? ` · ${input.phase.split(" · ")[0]}` : "";
  return makeBoard(input, `foreman ▶ ${done}/${input.tasks.length} ${input.currentId ?? ""}${phase}`.replace(/\s+/g, " ").trim(), false);
}

/** The result of a run. It stays on screen until the next /foreman command, so it is what you see on return. */
export function finalBoard(input: PanelInput): Board {
  const done = input.tasks.filter((task) => input.state.tasks[task.id]?.status === "done").length;
  const title = {
    finished: `foreman ✔ done ${done}/${input.tasks.length}`,
    paused: `foreman ⏸ paused ${done}/${input.tasks.length}`,
    blocked: `foreman ✖ blocked ${input.blocked?.taskId ?? ""}`.trim(),
    running: `foreman ▶ ${done}/${input.tasks.length}`,
  }[input.run];
  return makeBoard(input, title, true);
}
