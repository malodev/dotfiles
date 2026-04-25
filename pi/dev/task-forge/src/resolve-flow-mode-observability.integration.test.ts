import { describe, it } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskForgeV2Engine } from "./engine.ts";
import { createLayout, ensureLayout, loadSnapshot, readEvents } from "./storage.ts";
import type { ForgeTask } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeTask(id: string): ForgeTask {
  return {
    id,
    title: "Repair validation contract",
    description: "Fix the invalid acceptance command",
    complexity: "S",
    taskMode: "single-pass",
    contextManifest: {},
    outputManifest: ["src/task.ts"],
    dependencies: [],
    acceptanceCriteria: [],
    escalationTriggers: [],
    validation: {
      mode: "command",
      command: "pnpm test -- broken-command",
    },
  };
}

describe("resolve-flow-mode-observability.integration", () => {
  it("selected remediation mode is persisted and visible in diagnostics/status", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
    const layout = createLayout(cwd, ".task-forge-test");
    await ensureLayout(layout);
    const engine = new TaskForgeV2Engine(cwd, ".task-forge-test");

    await engine.createRun("orch-resolve-mode", "prd.md");
    await engine.registerTasks([makeTask("TF-03")]);
    await engine.markTaskRuntime("TF-03", {
      retries: 1,
      diagnostic: {
        classification: "requirement_or_plan_error",
        notes: "Acceptance command is prose, not executable",
        blockerCategory: "validation_contract",
      },
      diagnosticCount: 1,
    });
    await engine.markTaskBlocked("TF-03", {
      category: "validation_contract",
      reason: "Acceptance command is prose, not executable",
      suggestion: "Replace prose validation with the correct acceptance command",
      blockedTasks: ["TF-03"],
    });
    await engine.requestHumanIntervention("TF-03", "Acceptance command is prose, not executable", "Replace prose validation with the correct acceptance command");

    await engine.resolveHumanIntervention("TF-03", "Use the correct acceptance command for this task");

    const snapshot = await loadSnapshot(layout);
    assert(snapshot, "expected snapshot after resolution flow");
    assert(snapshot.taskState["TF-03"].status === "pending", "expected task to be requeued after resolve");
    assert(snapshot.taskState["TF-03"].diagnostic?.remediationMode === "patch_test_spec", "expected selected remediation mode in task diagnostics");
    assert(snapshot.taskState["TF-03"].diagnostic?.blockerCategory === "validation_contract", "expected blocker category to remain visible");
    assert(snapshot.taskState["TF-03"].resolutionInstruction === "Use the correct acceptance command for this task", "expected resolution instruction to remain visible in status data");

    const events = await readEvents(layout);
    const resolutionEvent = [...events].reverse().find((event) => event.type === "human_intervention_resolved");
    assert(resolutionEvent?.type === "human_intervention_resolved", "expected human intervention resolution event");
    assert(resolutionEvent.resolutionMode === "patch_test_spec", "expected remediation mode to be persisted on the resolution event");
  });

  it("CLI resolve entry point remains backward compatible while mode selection is internalized", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tf-test-"));
    const layout = createLayout(cwd, ".task-forge-test");
    await ensureLayout(layout);
    const engine = new TaskForgeV2Engine(cwd, ".task-forge-test");

    await engine.createRun("orch-env-retry", "prd.md");
    await engine.registerTasks([makeTask("TF-04")]);
    await engine.markTaskRuntime("TF-04", {
      retries: 0,
      diagnostic: {
        classification: "runtime_failure",
        notes: "Environment timed out while reaching test service",
        blockerCategory: "environment",
      },
      diagnosticCount: 1,
    });
    await engine.markTaskBlocked("TF-04", {
      category: "environment",
      reason: "Environment timed out while reaching test service",
      suggestion: "Retry after transient outage clears",
      blockedTasks: ["TF-04"],
    });
    await engine.requestHumanIntervention("TF-04", "Environment timed out while reaching test service", "Retry after transient outage clears");

    await engine.resolveHumanIntervention("TF-04", "Retry once the service is healthy");

    const snapshot = await loadSnapshot(layout);
    assert(snapshot, "expected snapshot after environment resolution");
    assert(snapshot.taskState["TF-04"].diagnostic?.remediationMode === "retry", "expected environment blocker resolution to preserve retry mode");

    const events = await readEvents(layout);
    const resolutionEvent = [...events].reverse().find((event) => event.type === "human_intervention_resolved" && event.taskId === "TF-04");
    assert(resolutionEvent?.type === "human_intervention_resolved", "expected resolution event for TF-04");
    assert(resolutionEvent.resolution === "Retry once the service is healthy", "expected legacy resolution payload to remain unchanged");
    assert(resolutionEvent.resolutionMode === "retry", "expected internal mode selection to persist without changing method signature");
  });
});
