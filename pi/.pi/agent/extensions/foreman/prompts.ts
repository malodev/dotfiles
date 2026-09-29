import type { Task } from "./tasks.ts";

export interface Feedback {
  /** Owner note from /foreman unblock. */
  ownerNote?: string;
  /** What went wrong on the previous attempt (test output, reviewer notes, role error). */
  previous?: string;
}

function section(title: string, body: string | undefined): string {
  return body?.trim() ? `\n## ${title}\n${body.trim()}\n` : "";
}

export function builderTask(task: Task, attempt: number, maxAttempts: number, feedback: Feedback): string {
  return [
    `Task ${task.id} (build attempt ${attempt}/${maxAttempts})`,
    section("Goal", task.goal),
    task.files.length ? section("Expected files", task.files.join("\n")) : "",
    section("Success tests (must all exit 0)", task.successTests.map((command) => `- ${command}`).join("\n")),
    section("Owner note", feedback.ownerNote),
    section("What went wrong last time", feedback.previous),
    "\nImplement the goal in the working tree. Do not commit. Run the success tests yourself before you stop.",
  ].join("\n");
}

export function reviewerTask(task: Task, cycle: number): string {
  return [
    `Review task ${task.id} (review ${cycle}).`,
    section("Goal", task.goal),
    section("Success tests (already run by the harness and passing)", task.successTests.map((command) => `- ${command}`).join("\n")),
    "\nInspect the uncommitted changes with `git status` and `git diff`. Judge only whether the goal is met by the changes, not style.",
    "End with an exact `## Verdict` heading followed by one line: `APPROVE` or `REQUEST_CHANGES`, then a short list of what must change if requesting changes.",
  ].join("\n");
}

export type Verdict = { verdict: "approve" | "changes"; notes: string };

/** Reads the exact `## Verdict` section. Anything ambiguous is not a verdict. */
export function parseVerdict(text: string): Verdict | undefined {
  const match = /^##\s+Verdict\s*$/im.exec(text);
  if (!match) return undefined;
  const rest = text.slice(match.index + match[0].length).trim();
  const [first, ...tail] = rest.split("\n");
  const word = first.trim().replace(/[*`.:]/g, "").trim().replace(/\s+/g, "_").toUpperCase();
  const notes = tail.join("\n").trim();
  if (word === "APPROVE" || word === "APPROVED") return { verdict: "approve", notes };
  if (word === "REQUEST_CHANGES" || word === "CHANGES_REQUESTED") return { verdict: "changes", notes };
  return undefined;
}

export function tail(text: string, maxChars = 4000): string {
  return text.length <= maxChars ? text : `…(truncated)…\n${text.slice(text.length - maxChars)}`;
}
