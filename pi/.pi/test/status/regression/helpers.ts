export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function makeTask(id: string, dependencies: string[] = []) {
  return {
    id,
    title: id,
    description: id,
    complexity: "S" as const,
    taskMode: "single-pass" as const,
    contextManifest: {},
    outputManifest: [],
    dependencies,
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: { mode: "manual" as const, notes: "n/a" },
  };
}

export function blocker(taskId: string, category: string, reason: string) {
  return {
    taskId,
    category,
    reason,
    suggestion: `Resolve ${taskId}`,
    blockedTasks: [taskId],
  };
}

export function buildSnapshot(args: {
  orchestrationId: string;
  tasks: unknown[];
  taskState: Record<string, unknown>;
  blockers: unknown[];
}) {
  return {
    schemaVersion: 3,
    orchestrationId: args.orchestrationId,
    status: "needs_human_intervention",
    currentPhase: 5,
    phaseLabel: "Execution",
    resolvedModels: {},
    cost: {},
    tasks: args.tasks,
    taskState: args.taskState,
    blockers: args.blockers,
    supervisors: {},
    timestamps: {
      started: "2026-04-22T09:00:00.000Z",
      lastUpdated: "2026-04-22T10:00:00.000Z",
    },
  };
}
