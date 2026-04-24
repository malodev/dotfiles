import { describe, it } from "node:test";
import { runTaskGateReview } from "../v2/gate-review.ts";
import { executeTaskSuccessPath } from "../v2/task-success.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type IntegrationTask = {
  id: string;
  title: string;
  taskMode: "single-pass" | "iterative";
  retries: number;
  status: string;
  acceptanceCriteria: string[];
  outputManifest: string[];
  validation?: {
    mode: "command" | "manual";
    command?: string;
    notes?: string;
    coverageThreshold?: number;
  };
  testCommand?: string;
  acceptanceSignal?: string;
  coverageThreshold?: number;
  result?: string;
  gateReview?: { passed: boolean; notes: string };
  validationOutput?: string;
  validationFramework?: string;
  lastCoverage?: number;
};

function createTask(overrides: Partial<IntegrationTask> = {}): IntegrationTask {
  return {
    id: "TASK-T5",
    title: "Validate execution handoff",
    taskMode: "single-pass",
    retries: 0,
    status: "running",
    acceptanceCriteria: [
      "Command mode executes shell validation",
      "Manual mode skips shell validation",
      "Manual mode reaches gate review with guidance and artifacts",
    ],
    outputManifest: ["docs/review-checklist.md", ".task-forge/results/TASK-T5.md"],
    ...overrides,
  };
}

describe("execution-manual-vs-command-validation.integration", () => {
  it("command mode still invokes shell validation flow", async () => {
    const task = createTask({
      id: "TASK-COMMAND",
      validation: {
        mode: "command",
        command: "node --test agent/extensions/task-forge/v2/validation.contract.test.ts",
      },
    });

    let validationCalls = 0;
    let markValidationCalls = 0;

    const outcome = await executeTaskSuccessPath(task, {
      runWorker: async () => "Implemented command-mode task.",
      markHeartbeat: async () => {},
      runValidation: async () => {
        validationCalls += 1;
        return { passed: true, output: "$ node --test\nexit: 0" };
      },
      markValidation: async () => {
        markValidationCalls += 1;
      },
      runGateReview: async () => ({ passed: true, notes: "Gate passed" }),
      markGateReview: async () => {},
    });

    assert(outcome.kind === "completed", "command-mode task should complete successfully");
    assert(validationCalls === 1, `expected shell validation once, got ${validationCalls}`);
    assert(markValidationCalls === 1, `expected validation persistence once, got ${markValidationCalls}`);
  });

  it("manual mode skips shell validation and reaches gate review with notes/artifacts", async () => {
    const task = createTask({
      id: "TASK-MANUAL",
      title: "Prepare manual review handoff",
      validation: {
        mode: "manual",
        notes: "Reviewer should inspect the generated checklist and attached task artifact before approving gate review.",
      },
    });

    let validationCalls = 0;
    let capturedPrompt = "";
    let reviewerRole: "gateReviewer" | "integrationReviewer" | undefined;

    const outcome = await executeTaskSuccessPath(task, {
      runWorker: async () => "Created docs/review-checklist.md and updated .task-forge/results/TASK-T5.md with handoff notes.",
      markHeartbeat: async () => {},
      runValidation: async () => {
        validationCalls += 1;
        throw new Error("manual mode should not invoke shell validation");
      },
      markValidation: async () => {
        throw new Error("manual mode should not persist shell validation results");
      },
      runGateReview: async (gateTask) => await runTaskGateReview(gateTask, {
        runReviewer: async (prompt, modelRole) => {
          capturedPrompt = prompt;
          reviewerRole = modelRole;
          return JSON.stringify({ passed: true, notes: "Manual review handoff is ready." });
        },
      }),
      markGateReview: async () => {},
    });

    assert(outcome.kind === "completed", "manual-mode task should complete through gate review");
    assert(validationCalls === 0, `manual mode should skip shell validation, got ${validationCalls} calls`);
    assert(reviewerRole === "gateReviewer", `manual-mode gate review should stay on normal gate reviewer path, got ${reviewerRole}`);
    assert(capturedPrompt.includes("## Manual Validation Notes"), "gate review payload should include manual validation notes section");
    assert(
      capturedPrompt.includes("Reviewer should inspect the generated checklist and attached task artifact before approving gate review."),
      "gate review payload should include reviewer guidance notes",
    );
    assert(capturedPrompt.includes("docs/review-checklist.md"), "gate review payload should include output artifact paths");
    assert(capturedPrompt.includes(".task-forge/results/TASK-T5.md"), "gate review payload should include persisted task artifact path");
    assert(capturedPrompt.includes("Created docs/review-checklist.md"), "gate review payload should include worker result summary");
  });
});
