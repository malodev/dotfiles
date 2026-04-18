export interface IntegrationReviewTaskLike {
  id: string;
  title: string;
  status?: string;
  result?: string;
}

export interface IntegrationReviewInput<TTask extends IntegrationReviewTaskLike = IntegrationReviewTaskLike> {
  requirements: string;
  plan: string;
  tasks: TTask[];
}

export interface IntegrationReviewHooks {
  runReviewer: (prompt: string) => Promise<string>;
  saveReview: (content: string) => Promise<string>;
  complete: (reviewFile: string, review: string) => Promise<void>;
  notifyComplete?: () => Promise<void> | void;
}

export function buildIntegrationReviewPrompt<TTask extends IntegrationReviewTaskLike>(input: IntegrationReviewInput<TTask>) {
  const taskResults = input.tasks
    .filter((task) => task.status === "completed")
    .map((task) => `## ${task.id} — ${task.title}\n\n${task.result ?? ""}`)
    .join("\n\n---\n\n");

  return [
    "# Review scope",
    "- Cross-component coherence",
    "- Correctness against requirements",
    "- Security, performance, testing, documentation",
    "- Consistency across components",
    "",
    "# Requirements",
    input.requirements,
    "",
    "# Plan",
    input.plan,
    "",
    "# Implemented task results",
    taskResults,
  ].join("\n");
}

export async function runIntegrationReview<TTask extends IntegrationReviewTaskLike>(
  input: IntegrationReviewInput<TTask>,
  hooks: IntegrationReviewHooks
) {
  const prompt = buildIntegrationReviewPrompt(input);
  const review = await hooks.runReviewer(prompt);
  const reviewFile = await hooks.saveReview(review);
  await hooks.complete(reviewFile, review);
  await hooks.notifyComplete?.();
  return { prompt, review, reviewFile };
}
