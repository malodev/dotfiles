export interface DiagnosticReviewerTaskLike {
  id: string;
  title: string;
  taskMode: string;
  acceptanceCriteria: string[];
  validationFramework?: string;
  validationOutput?: string;
  result?: string;
  testCommand?: string;
  acceptanceSignal?: string;
  coverageThreshold?: number;
  testSpecRefs?: string[];
}

export interface DiagnosticReviewHooks {
  runReviewer: (prompt: string) => Promise<string>;
}

export interface DiagnosticReviewInput<TTask extends DiagnosticReviewerTaskLike = DiagnosticReviewerTaskLike> {
  task: TTask;
  testSpec: unknown;
}

export function needsDiagnosticReview(task: Pick<DiagnosticReviewerTaskLike, "testCommand" | "acceptanceSignal" | "coverageThreshold" | "testSpecRefs">) {
  return Boolean(task.testCommand || task.acceptanceSignal || task.coverageThreshold || task.testSpecRefs?.length);
}

function extractJson(text: string): any | null {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidates = fenced ? [fenced[1], text] : [text];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim());
    } catch {}
  }
  return null;
}

export function buildDiagnosticReviewPrompt<TTask extends DiagnosticReviewerTaskLike>(input: DiagnosticReviewInput<TTask>) {
  const { task, testSpec } = input;
  return [
    "# Diagnose task failure",
    `Task: ${task.id} — ${task.title}`,
    `Mode: ${task.taskMode}`,
    "",
    "## Requirement/Acceptance Context",
    ...task.acceptanceCriteria.map((value) => `- ${value}`),
    "",
    "## Test Spec",
    JSON.stringify(testSpec ?? {}, null, 2),
    "",
    "## Validation Framework",
    task.validationFramework ?? "unknown",
    "",
    "## Validation Output",
    task.validationOutput ?? "",
    "",
    "## Worker Result",
    task.result ?? "",
    "",
    "Return one JSON object:",
    '{ "classification": "implementation_error" | "test_spec_error" | "requirement_or_plan_error", "notes": string, "rewrittenTestSpec": object | null, "blocker": {"reason": string, "suggestion": string, "blockedTasks": [] } | null }',
  ].join("\n");
}

export async function runTaskDiagnosticReview<TTask extends DiagnosticReviewerTaskLike>(
  input: DiagnosticReviewInput<TTask>,
  hooks: DiagnosticReviewHooks,
) {
  const raw = await hooks.runReviewer(buildDiagnosticReviewPrompt(input));
  return extractJson(raw);
}
