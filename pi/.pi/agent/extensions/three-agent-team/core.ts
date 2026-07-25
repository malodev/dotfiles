import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type TeamState = "DISCUSSING" | "EXECUTING" | "REVIEWING" | "VERIFYING" | "COMPLETED" | "BLOCKED";

export interface SuccessTest {
  id: string;
  command: string;
  expectedExitCode: number;
  expectedEvidence: string;
  writesState: boolean;
  prerequisites: string[];
}

export interface CompletionPolicy {
  commitOnSuccess: boolean;
  pushOnSuccess: boolean;
  deployOnSuccess: boolean;
}

export interface TaskStatus {
  taskId: string;
  state: TeamState;
  baselineCommit: string;
  executionAuthorizedAt: string | null;
  reviewCycle: number;
  maxReviewCycles: number;
  completionPolicy: CompletionPolicy;
}

export interface TeamNewArgs {
  taskId: string;
  request: string;
}

export function recoveryReviewCeiling(reviewCycle: number, maxReviewCycles: number): number {
  if (!Number.isInteger(reviewCycle) || reviewCycle < 0 || !Number.isInteger(maxReviewCycles) || maxReviewCycles < 1) {
    throw new Error("Invalid review-cycle values for recovery");
  }
  return Math.max(maxReviewCycles, reviewCycle + 1);
}

const TEAM_NEW_USAGE = "Usage: /team-new <task-id> -- <task request>";
const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function localTaskDatePrefix(date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}-`;
}

export function completeTeamNewTaskId(prefix: string, date = new Date()): string | null {
  const input = prefix.trim();
  if (input.includes("--") || /\s/.test(input)) return null;

  const datePrefix = localTaskDatePrefix(date);
  if (!input || datePrefix.startsWith(input)) return datePrefix;
  if (input.startsWith(datePrefix)) return null;
  if (TASK_ID_PATTERN.test(input)) return `${datePrefix}${input}`;
  return null;
}

function assertValidTaskId(taskId: string): void {
  if (TASK_ID_PATTERN.test(taskId)) return;
  const lowercaseSuggestion = taskId.toLowerCase();
  const suggestion = lowercaseSuggestion !== taskId && TASK_ID_PATTERN.test(lowercaseSuggestion)
    ? ` Use \`${lowercaseSuggestion}\`.`
    : "";
  if (/[A-Z]/.test(taskId)) {
    throw new Error(
      `Invalid task ID \`${taskId}\`: uppercase letters are not allowed.${suggestion} ` +
      "Task IDs must start with a lowercase letter or digit and contain only lowercase letters, digits, `.`, `_`, and `-`.",
    );
  }
  throw new Error(
    `Invalid task ID \`${taskId}\`. Task IDs must start with a lowercase letter or digit and contain only ` +
    "lowercase letters, digits, `.`, `_`, and `-`.",
  );
}

export function parseTeamTaskId(args: string, commandName: string): string {
  const taskId = args.trim();
  const usage = `Usage: /${commandName} <task-id>`;
  if (!taskId) throw new Error(`Missing task ID. ${usage}`);
  if (/\s/.test(taskId)) throw new Error(`Expected exactly one task ID. ${usage}`);
  assertValidTaskId(taskId);
  return taskId;
}

export function parseTeamNewArgs(args: string): TeamNewArgs {
  const input = args.trim();
  if (!input) {
    throw new Error(`Missing task ID and task request. ${TEAM_NEW_USAGE}`);
  }
  if (/^--(?:\s|$)/.test(input)) {
    throw new Error(`Missing task ID before \`--\`. ${TEAM_NEW_USAGE}`);
  }

  const separator = /\s+--(?:\s+|$)/.exec(input);
  if (!separator || separator.index === undefined) {
    throw new Error(`Missing \` -- \` separator between the task ID and request. ${TEAM_NEW_USAGE}`);
  }

  const taskId = input.slice(0, separator.index).trim();
  const request = input.slice(separator.index + separator[0].length).trim();
  assertValidTaskId(taskId);
  if (!request) {
    throw new Error(`Missing task request after \`--\`. ${TEAM_NEW_USAGE}`);
  }
  return { taskId, request };
}

export function assertTeamGrillable(status: TaskStatus, requestedTaskId: string): void {
  if (status.taskId !== requestedTaskId) {
    throw new Error(`Task metadata mismatch: requested \`${requestedTaskId}\`, status contains \`${status.taskId}\``);
  }
  if (status.state !== "DISCUSSING" || status.executionAuthorizedAt) {
    throw new Error(
      `Task \`${requestedTaskId}\` cannot be grilled: expected unauthorized DISCUSSING state, ` +
      `found ${status.state}${status.executionAuthorizedAt ? " with recorded execution authorization" : ""}.`,
    );
  }
}

export function buildTeamGrillPrompt(taskId: string): string {
  assertValidTaskId(taskId);
  return `/skill:grill-me Stress-test the existing Goal Contract for task ${taskId} while acting only as Architect ` +
    "in the three-agent-team DISCUSSING phase. Treat the existing brief.md and status.yaml as canonical; update only " +
    "those task files as decisions are resolved. Include any necessary CONTEXT.md or ADR changes in the Builder's " +
    "Goal Contract; do not edit implementation, CONTEXT.md, ADRs, or other project documentation now. Ask one " +
    "question at a time and provide your recommended answer. Do not authorize execution, invoke roles, or run /team-go.";
}

function scalar(text: string, key: string, indent = 0): string | undefined {
  const match = text.match(new RegExp(`^${" ".repeat(indent)}${key}:\\s*(.*?)\\s*$`, "m"));
  if (!match) return undefined;
  const value = match[1].trim();
  if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function parseBoolean(value: string | undefined, key: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid or missing ${key} in status.yaml`);
}

export function parseStatus(text: string): TaskStatus {
  const state = scalar(text, "state") as TeamState | undefined;
  const validStates = new Set<TeamState>(["DISCUSSING", "EXECUTING", "REVIEWING", "VERIFYING", "COMPLETED", "BLOCKED"]);
  if (!state || !validStates.has(state)) throw new Error("Invalid or missing state in status.yaml");
  const taskId = scalar(text, "task_id");
  const baselineCommit = scalar(text, "baseline_commit");
  const reviewCycleRaw = scalar(text, "review_cycle");
  const maxReviewCyclesRaw = scalar(text, "max_review_cycles");
  if (!taskId || !baselineCommit || !reviewCycleRaw || !maxReviewCyclesRaw) {
    throw new Error("status.yaml is missing required task metadata");
  }
  const reviewCycle = Number(reviewCycleRaw);
  const maxReviewCycles = Number(maxReviewCyclesRaw);
  if (!Number.isInteger(reviewCycle) || !Number.isInteger(maxReviewCycles) || maxReviewCycles < 1) {
    throw new Error("status.yaml has invalid review-cycle values");
  }
  const authorization = scalar(text, "execution_authorized_at");
  return {
    taskId,
    state,
    baselineCommit,
    executionAuthorizedAt: !authorization || authorization === "null" ? null : authorization,
    reviewCycle,
    maxReviewCycles,
    completionPolicy: {
      commitOnSuccess: parseBoolean(scalar(text, "commit_on_success", 2), "commit_on_success"),
      pushOnSuccess: parseBoolean(scalar(text, "push_on_success", 2), "push_on_success"),
      deployOnSuccess: parseBoolean(scalar(text, "deploy_on_success", 2), "deploy_on_success"),
    },
  };
}

export function setYamlScalar(text: string, key: string, value: string, indent = 0): string {
  const expression = new RegExp(`^${" ".repeat(indent)}${key}:.*$`, "m");
  if (!expression.test(text)) throw new Error(`Cannot update missing status field: ${key}`);
  return text.replace(expression, `${" ".repeat(indent)}${key}: ${value}`);
}

export async function readStatus(taskDir: string): Promise<{ text: string; status: TaskStatus }> {
  const text = await readFile(resolve(taskDir, "status.yaml"), "utf8");
  return { text, status: parseStatus(text) };
}

export async function updateStatus(taskDir: string, updates: Record<string, string>): Promise<TaskStatus> {
  const path = resolve(taskDir, "status.yaml");
  let text = await readFile(path, "utf8");
  for (const [key, value] of Object.entries(updates)) text = setYamlScalar(text, key, value);
  await writeFile(path, text, "utf8");
  return parseStatus(text);
}

function field(block: string, label: string): string | undefined {
  return block.match(new RegExp(`^- ${label}:\\s*(.+?)\\s*$`, "m"))?.[1]?.trim();
}

function codeValue(value: string | undefined): string | undefined {
  if (!value?.startsWith("`") || !value.endsWith("`")) return undefined;
  return value.slice(1, -1).trim();
}

export function parseSuccessTests(brief: string): SuccessTest[] {
  const sectionHeading = /^## Success tests\s*$/m.exec(brief);
  if (!sectionHeading || sectionHeading.index === undefined) throw new Error("brief.md has no structured Success tests section");
  const start = sectionHeading.index + sectionHeading[0].length;
  const remainder = brief.slice(start);
  const nextHeading = /^##\s+/m.exec(remainder);
  const section = nextHeading?.index === undefined ? remainder : remainder.slice(0, nextHeading.index);
  const heading = /^###\s+(ST-\d{2,})\s*[:—-]\s*.+$/gm;
  const matches = [...section.matchAll(heading)];
  if (!matches.length) throw new Error("brief.md has no ST-NN success tests");
  const tests: SuccessTest[] = [];
  for (let index = 0; index < matches.length; index++) {
    const start = (matches[index].index ?? 0) + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? section.length : section.length;
    const block = section.slice(start, end);
    const id = matches[index][1];
    const command = codeValue(field(block, "Command"));
    const exitCode = Number(codeValue(field(block, "Expected exit code")));
    const evidence = field(block, "Expected evidence");
    const writes = codeValue(field(block, "Writes hardware/system state"));
    const prereq = codeValue(field(block, "Prerequisites"));
    if (!command || !Number.isInteger(exitCode) || !evidence || !writes || !prereq) {
      throw new Error(`${id} is not structurally complete`);
    }
    tests.push({
      id,
      command,
      expectedExitCode: exitCode,
      expectedEvidence: evidence,
      writesState: writes === "yes",
      prerequisites: prereq === "none" ? [] : prereq.split(",").map((item) => item.trim()),
    });
  }
  return tests;
}

export function orderSuccessTests(tests: SuccessTest[]): SuccessTest[] {
  const byId = new Map(tests.map((test) => [test.id, test]));
  const ordered: SuccessTest[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Success-test prerequisite cycle at ${id}`);
    const test = byId.get(id);
    if (!test) throw new Error(`Unknown success-test prerequisite: ${id}`);
    visiting.add(id);
    for (const prerequisite of test.prerequisites) visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
    ordered.push(test);
  };
  for (const test of tests) visit(test.id);
  return ordered;
}

export function parseReviewVerdict(review: string): "APPROVED" | "CHANGES_REQUESTED" | "ESCALATE" {
  const match = review.match(/^## Verdict\s*\n\s*(APPROVED|CHANGES_REQUESTED|ESCALATE)\s*$/m);
  if (!match) throw new Error("Reviewer output has no valid ## Verdict");
  return match[1] as "APPROVED" | "CHANGES_REQUESTED" | "ESCALATE";
}

const REQUIRED_CONTRACT_HEADINGS = [
  "Goal",
  "Current behavior",
  "Agreed approach",
  "Success tests",
  "Non-goals",
  "Relevant files",
  "Architectural constraints",
  "Verification commands",
  "Baseline commit",
  "Execution authority",
  "Open decisions",
  "Execution authorization",
];

/**
 * Preserves the draft schema while Architect incrementally fills it in. This is
 * intentionally weaker than the pre-go validator: placeholders and unresolved
 * decisions remain allowed until Architect has finished the discussion.
 */
export function assertDraftContractShape(brief: string, statusText: string, taskId: string, baseline: string): void {
  if (!new RegExp(`^# Goal Contract: ${taskId}\\s*$`, "m").test(brief)) {
    throw new Error("brief.md must retain the # Goal Contract heading for this task");
  }
  for (const heading of REQUIRED_CONTRACT_HEADINGS) {
    if (!new RegExp(`^## ${heading}\\s*$`, "m").test(brief)) {
      throw new Error(`brief.md must retain ## ${heading}`);
    }
  }
  if (!/^### ST-\d{2,}\s*[:—-]\s*.+$/m.test(brief)) {
    throw new Error("brief.md must retain a structured ### ST-NN success-test block");
  }
  for (const label of ["Command", "Expected exit code", "Expected evidence", "Writes hardware/system state", "Prerequisites"]) {
    if (!new RegExp(`^- ${label}:`, "m").test(brief)) {
      throw new Error(`brief.md must retain the structured success-test field: ${label}`);
    }
  }
  let tests: SuccessTest[];
  try {
    tests = parseSuccessTests(brief);
  } catch (error) {
    throw new Error(`brief.md success tests must remain parser-valid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const testsById = new Map(tests.map((test) => [test.id, test]));
  for (const test of tests) {
    if (test.writesState && !test.prerequisites.some((id) => testsById.get(id)?.writesState === false)) {
      throw new Error(`${test.id} writes hardware/system state and must directly depend on a non-writing success test`);
    }
  }
  if (!new RegExp(`^## Baseline commit\\s*\\n${baseline}\\s*$`, "m").test(brief)) {
    throw new Error("brief.md baseline must retain the extension-created full SHA");
  }
  for (const [label, pattern] of [
    ["Repository edits", "allowed|prohibited"],
    ["Non-destructive development commands", "allowed|prohibited"],
    ["Routine technical decisions inside this contract", "allowed|prohibited"],
    ["Hardware/system writes", "allowed|prohibited"],
    ["Commit on success", "true|false"],
    ["Push on success", "true|false"],
    ["Deploy on success", "true|false"],
  ]) {
    if (!new RegExp(`^- ${label}: (?:${pattern})\\s*$`, "m").test(brief)) {
      throw new Error(`brief.md must retain a valid execution-authority field: ${label}`);
    }
  }
  if (!/^## Execution authorization\s*\nPENDING\s*$/m.test(brief)) {
    throw new Error("unauthorized draft brief.md must retain execution authorization PENDING");
  }

  const status = parseStatus(statusText);
  if (status.taskId !== taskId) throw new Error("status.yaml task_id must match the task directory");
  if (status.state !== "DISCUSSING") throw new Error("unauthorized draft status.yaml must remain DISCUSSING");
  if (status.baselineCommit !== baseline) throw new Error("status.yaml baseline_commit must retain the extension-created SHA");
  if (status.executionAuthorizedAt) throw new Error("unauthorized draft status.yaml must retain execution_authorized_at: null");
}

export function taskPath(repo: string, taskId: string): string {
  assertValidTaskId(taskId);
  return resolve(repo, "team", "tasks", taskId);
}
