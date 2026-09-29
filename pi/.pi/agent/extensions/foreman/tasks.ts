import { parse } from "yaml";

export interface Task {
  id: string;
  goal: string;
  dependsOn: string[];
  files: string[];
  successTests: string[];
}

export interface ParsedTasks {
  tasks: Task[];
  errors: string[];
}

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const PLACEHOLDER_RE = /REPLACE_ME|\bTBD\b|\bTODO\b|<[A-Za-z][A-Za-z0-9_ -]*>/i;
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Imperative prose accidentally placed in a command field. Unknown project
// commands and explicit paths stay valid: the Builder may create them.
const PROSE_HEADS = new Set(["check", "click", "confirm", "ensure", "inspect", "move", "observe", "open", "select", "switch", "verify"]);
const KNOWN_KEYS = new Set(["id", "goal", "depends_on", "files", "success_tests"]);

/** Minimal POSIX-ish word splitter; throws on unterminated quotes. */
export function shellWords(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let inWord = false;
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === "\\" && quote === '"' && i + 1 < command.length) current += command[++i];
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
    } else if (char === "\\" && i + 1 < command.length) {
      current += command[++i];
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) words.push(current);
      current = "";
      inWord = false;
    } else {
      current += char;
      inWord = true;
    }
  }
  if (quote) throw new Error("unterminated quote");
  if (inWord) words.push(current);
  return words;
}

function commandError(command: string): string | undefined {
  if (!command.trim()) return "is empty";
  if (PLACEHOLDER_RE.test(command)) return "contains a placeholder (TODO, TBD, REPLACE_ME or <angle-bracket>)";
  let words: string[];
  try {
    words = shellWords(command);
  } catch (error) {
    return `has invalid quoting: ${error instanceof Error ? error.message : String(error)}`;
  }
  let index = 0;
  while (index < words.length && ENV_ASSIGNMENT_RE.test(words[index])) index++;
  if (index >= words.length) return "contains only environment assignments";
  const head = words[index];
  if (!head.includes("/") && PROSE_HEADS.has(head.toLowerCase()) && words.length > index + 1) {
    return `looks like a prose instruction beginning with "${head}", not an executable command`;
  }
  return undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return value as string[];
}

export function parseTasks(text: string): ParsedTasks {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    return { tasks: [], errors: [`YAML parse error: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (!Array.isArray(raw)) return { tasks: [], errors: ["tasks.yaml must be a list of tasks"] };
  if (raw.length === 0) return { tasks: [], errors: ["tasks.yaml must contain at least one task"] };

  const tasks: Task[] = [];
  const errors: string[] = [];
  raw.forEach((entry, position) => {
    const label = entry && typeof entry === "object" && typeof (entry as any).id === "string" ? (entry as any).id : `#${position + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${label}: each task must be a mapping`);
      return;
    }
    const item = entry as Record<string, unknown>;
    for (const key of Object.keys(item)) {
      if (!KNOWN_KEYS.has(key)) errors.push(`${label}: unknown key "${key}"`);
    }
    if (typeof item.id !== "string" || !item.id) errors.push(`${label}: id must be a non-empty string`);
    if (typeof item.goal !== "string" || !item.goal.trim()) errors.push(`${label}: goal must be a non-empty string`);
    const dependsOn = stringList(item.depends_on);
    if (!dependsOn) errors.push(`${label}: depends_on must be a list of task ids`);
    const files = stringList(item.files);
    if (!files) errors.push(`${label}: files must be a list of paths`);
    const successTests = Array.isArray(item.success_tests) && item.success_tests.every((test) => typeof test === "string")
      ? (item.success_tests as string[])
      : undefined;
    if (!successTests) errors.push(`${label}: success_tests must be a list of commands`);
    if (typeof item.id === "string" && typeof item.goal === "string" && dependsOn && files && successTests) {
      tasks.push({ id: item.id, goal: item.goal.trim(), dependsOn, files, successTests });
    }
  });
  return { tasks, errors };
}

/** Semantic checks on structurally valid tasks. Returns human-readable errors. */
export function validateTasks(tasks: Task[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  tasks.forEach((task, position) => {
    if (!ID_RE.test(task.id)) errors.push(`${task.id}: invalid id (use lowercase letters, digits, ".", "_", "-")`);
    if (seen.has(task.id)) errors.push(`${task.id}: duplicate id "${task.id}"`);
    else seen.set(task.id, position);
  });

  tasks.forEach((task, position) => {
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) errors.push(`${task.id}: depends on itself`);
      else if (!seen.has(dependency)) errors.push(`${task.id}: unknown dependency "${dependency}"`);
      else if ((seen.get(dependency) as number) > position) errors.push(`${task.id}: dependency "${dependency}" is listed after it; order tasks so dependencies come first`);
    }
    for (const file of task.files) {
      if (!file || file.startsWith("/") || file.split("/").includes("..")) errors.push(`${task.id}: file "${file}" must be a relative path inside the repository`);
    }
    if (task.successTests.length === 0) errors.push(`${task.id}: success_tests needs at least one command`);
    const commands = new Set<string>();
    for (const command of task.successTests) {
      const problem = commandError(command);
      if (problem) errors.push(`${task.id}: success test "${command}" ${problem}`);
      if (commands.has(command)) errors.push(`${task.id}: duplicate command "${command}"`);
      commands.add(command);
    }
  });
  return errors;
}

/** Parse then validate; the single call sites use. */
export function loadTasks(text: string): ParsedTasks {
  const parsed = parseTasks(text);
  if (parsed.errors.length) return parsed;
  return { tasks: parsed.tasks, errors: validateTasks(parsed.tasks) };
}
