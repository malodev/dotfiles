import { runTask, type CycleDeps, type Outcome } from "./cycle.ts";
import { markBlocked, markDone, markRunning, nextTask, type StateStore } from "./state.ts";
import type { Task } from "./tasks.ts";

export interface RunSummary {
  kind: "idle" | "paused" | "blocked";
  completed: string[];
  taskId?: string;
  reason?: string;
}

export interface RunDeps extends CycleDeps {
  tasks: Task[];
  store: StateStore;
  onTask?: (task: Task) => void;
}

/** Drain the plan in order until everything is done, the owner pauses, or a task blocks. */
export async function runQueue(deps: RunDeps): Promise<RunSummary> {
  const completed: string[] = [];
  while (true) {
    const next = nextTask(deps.tasks, deps.store.get());
    if (next.kind === "idle") return { kind: "idle", completed };
    if (next.kind === "paused") return { kind: "paused", completed };
    if (next.kind === "blocked") return { kind: "blocked", completed, taskId: next.taskId, reason: next.reason };

    const { task } = next;
    deps.onTask?.(task);
    await deps.store.update((state) => markRunning(state, task.id));
    let outcome: Outcome;
    try {
      outcome = await runTask(deps, task);
    } catch (error) {
      // Fail closed: an unexpected error blocks this task instead of taking the process down.
      outcome = { kind: "blocked", reason: `internal error: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (outcome.kind === "done") {
      await deps.store.update((state) => markDone(state, task.id, outcome.sha));
      completed.push(task.id);
    } else {
      await deps.store.update((state) => markBlocked(state, task.id, outcome.reason));
      return { kind: "blocked", completed, taskId: task.id, reason: outcome.reason };
    }
  }
}
