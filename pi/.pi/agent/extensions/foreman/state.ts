import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Task } from "./tasks.ts";

export type TaskStatus = "pending" | "running" | "done" | "blocked";

export interface TaskState {
  status: TaskStatus;
  /** Builder attempts spent on the current stretch of work (reset by unblock). */
  attempts: number;
  blockedReason?: string;
  /** Owner note from /foreman unblock, handed to the Builder. */
  note?: string;
  /** Path (relative to the foreman dir) of the last failure output. */
  lastFailure?: string;
  commit?: string;
}

export interface State {
  version: 1;
  runId?: string;
  branch?: string;
  paused: boolean;
  tasks: Record<string, TaskState>;
}

export type Next =
  | { kind: "run"; task: Task }
  | { kind: "idle" }
  | { kind: "paused" }
  | { kind: "blocked"; taskId: string; reason: string };

export function emptyState(): State {
  return { version: 1, paused: false, tasks: {} };
}

export async function loadState(path: string): Promise<State> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
  let value: any;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON; fix or delete it (${error instanceof Error ? error.message : String(error)})`);
  }
  if (value?.version !== 1) throw new Error(`${path} has unsupported version ${String(value?.version)}`);
  return value as State;
}

export async function saveState(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function withTask(state: State, id: string, patch: Partial<TaskState>): State {
  const current = state.tasks[id];
  if (!current) throw new Error(`unknown task "${id}"`);
  const merged: TaskState = { ...current, ...patch };
  for (const key of Object.keys(merged) as (keyof TaskState)[]) if (merged[key] === undefined) delete merged[key];
  return { ...state, tasks: { ...state.tasks, [id]: merged } };
}

export function syncTasks(state: State, tasks: Task[]): State {
  const next = { ...state, tasks: { ...state.tasks } };
  for (const task of tasks) next.tasks[task.id] ??= { status: "pending", attempts: 0 };
  return next;
}

export function markRunning(state: State, id: string): State {
  return withTask(state, id, { status: "running", blockedReason: undefined });
}

export function markDone(state: State, id: string, commit: string): State {
  return withTask(state, id, { status: "done", commit, blockedReason: undefined, note: undefined });
}

export function markBlocked(state: State, id: string, reason: string): State {
  return withTask(state, id, { status: "blocked", blockedReason: reason });
}

export function setAttempts(state: State, id: string, attempts: number, lastFailure?: string): State {
  return withTask(state, id, { attempts, ...(lastFailure !== undefined ? { lastFailure } : {}) });
}

/** A crash leaves a task `running`. That is ambiguous, so it becomes blocked, never retried. */
export function recoverInterrupted(state: State): State {
  const tasks = { ...state.tasks };
  for (const [id, task] of Object.entries(tasks)) {
    if (task.status === "running") tasks[id] = { ...task, status: "blocked", blockedReason: "interrupted: the previous run ended while this task was running" };
  }
  return { ...state, tasks };
}

export function unblock(state: State, id: string, note?: string): State {
  const task = state.tasks[id];
  if (!task) throw new Error(`unknown task "${id}"`);
  if (task.status !== "blocked") throw new Error(`task "${id}" is not blocked (it is ${task.status})`);
  return withTask(state, id, { status: "pending", attempts: 0, blockedReason: undefined, note });
}

export function setPaused(state: State, paused: boolean): State {
  return { ...state, paused };
}

/** Strictly sequential: the first task that is not done is the only candidate. */
export function nextTask(tasks: Task[], state: State): Next {
  if (state.paused) return { kind: "paused" };
  for (const task of tasks) {
    const current = state.tasks[task.id];
    if (!current || current.status === "done") continue;
    if (current.status === "pending") return { kind: "run", task };
    const reason = current.status === "running" ? "another run is in progress or was interrupted" : (current.blockedReason ?? "blocked");
    return { kind: "blocked", taskId: task.id, reason };
  }
  return { kind: "idle" };
}

/** Serializes updates to one state file so concurrent commands cannot interleave writes. */
export interface StateStore {
  get(): State;
  update(change: (state: State) => State): Promise<State>;
}

export async function openStore(path: string): Promise<StateStore> {
  let state = await loadState(path);
  let chain: Promise<unknown> = Promise.resolve();
  return {
    get: () => state,
    update(change) {
      const run = chain.then(async () => {
        const next = change(state);
        await saveState(path, next);
        state = next;
        return next;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
