export interface TaskLaunchHooks<TTask> {
  runTask: (task: TTask) => Promise<void>;
  sweep: () => Promise<void> | void;
  sweepIntervalMs: number;
}

export async function launchTaskWithWatchdog<TTask>(task: TTask, hooks: TaskLaunchHooks<TTask>) {
  const timer = setInterval(() => {
    void hooks.sweep();
  }, hooks.sweepIntervalMs);

  try {
    await hooks.runTask(task);
  } finally {
    clearInterval(timer);
  }
}

export async function launchTaskBatchWithWatchdogs<TTask>(tasks: TTask[], hooks: TaskLaunchHooks<TTask>) {
  await Promise.allSettled(tasks.map((task) => launchTaskWithWatchdog(task, hooks)));
}
