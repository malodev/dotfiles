/**
 * Strict plan manifest parser and validator.
 *
 * Deep module: small interface, complex validation logic hidden inside.
 * Callers receive a fully validated PlanManifest or an error.
 */

import { parse } from "yaml";
import { isSha256 } from "./core.ts";

const PROSE_COMMAND_HEADS = new Set([
  "check", "click", "confirm", "ensure", "inspect", "move", "observe",
  "open", "select", "switch", "verify",
]);

function assertCommandShape(command: string, context: string): void {
  let remainder = command.trim();
  const assignment = /^[A-Za-z_][A-Za-z0-9_]*=(?:"(?:[^"\\]|\\.)*"|'[^']*'|\S+)\s+/;
  while (assignment.test(remainder)) remainder = remainder.replace(assignment, "");
  const head = remainder.split(/\s+/, 1)[0]?.replace(/^["']|["']$/g, "") ?? "";
  if (head && !head.includes("/") && PROSE_COMMAND_HEADS.has(head.toLowerCase()) && remainder.includes(" ")) {
    throw new Error(`${context}.command looks like prose beginning with '${head}', not an executable shell command; put manual actions in expected_evidence`);
  }
}

export interface SuccessTest {
  id: string;
  title: string;
  command: string;
  expectedExitCode: number;
  expectedEvidence: string;
  writesHardwareOrSystemState: boolean;
  prerequisites: string[];
}

export interface ExecutionAuthority {
  repositoryEdits: boolean;
  nonDestructiveDevelopmentCommands: boolean;
  routineTechnicalDecisions: boolean;
  hardwareSystemWrites: boolean;
  allowedHardwareSystemOperations: string[];
}

export interface CompletionPolicy {
  commitOnSuccess: boolean;
  pushOnSuccess: boolean;
  deployOnSuccess: boolean;
}

export interface TaskSpec {
  id: string;
  goal: string;
  currentBehavior: string;
  agreedApproach: string;
  successTests: SuccessTest[];
  nonGoals: string[];
  relevantFiles: string[];
  architecturalConstraints: string[];
  executionAuthority: ExecutionAuthority;
  completionPolicy: CompletionPolicy;
  dependsOn: string[];
}

export interface SourceRef {
  path: string;
  sha256: string;
}

export interface PlanManifest {
  version: number;
  sources: {
    plan: SourceRef;
    prd?: SourceRef;
  };
  tasks: TaskSpec[];
}

/**
 * Parse and validate a plan manifest from YAML text.
 * Throws a descriptive error if validation fails.
 */
export function parsePlanManifest(yamlText: string): PlanManifest {
  // Reject standalone YAML anchors (e.g., &task) — these are not aliases
  // but still a schema extension risk. Check before the parser which only
  // blocks alias references (*anchor).
  if (/&\w+/.test(yamlText)) {
    throw new Error('YAML anchors are not allowed');
  }

  // Parse with strict options: no aliases, no custom tags, no comments
  let raw: unknown;
  try {
    raw = parse(yamlText, {
      strict: true,
      uniqueKeys: true,
      merge: false,
      maxAliasCount: 0, // Reject YAML aliases
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('alias')) {
      throw new Error('YAML aliases are not allowed');
    }
    throw new Error(`YAML parse error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("Manifest must be a YAML object");
  }

  const manifest = raw as Record<string, unknown>;

  // Validate version
  const version = manifest.version;
  if (version === undefined) {
    throw new Error("Manifest missing 'version'");
  }
  if (version !== 1) {
    throw new Error(`Unsupported manifest version: ${version} (expected 1)`);
  }

  // Check for unknown root fields
  const knownRootFields = new Set(["version", "sources", "tasks"]);
  for (const key of Object.keys(manifest)) {
    if (!knownRootFields.has(key)) {
      throw new Error(`Unknown root field: '${key}'`);
    }
  }

  // Validate sources
  const sources = manifest.sources;
  if (!sources || typeof sources !== "object") {
    throw new Error("Manifest missing 'sources' object");
  }
  const sourcesObj = sources as Record<string, unknown>;

  const plan = sourcesObj.plan;
  if (!plan || typeof plan !== "object") {
    throw new Error("Manifest missing 'sources.plan' object");
  }
  const planObj = plan as Record<string, unknown>;
  validateSourceRef(planObj, "sources.plan");

  if (sourcesObj.prd !== undefined) {
    if (typeof sourcesObj.prd !== "object" || sourcesObj.prd === null) {
      throw new Error("Manifest 'sources.prd' must be an object");
    }
    validateSourceRef(sourcesObj.prd as Record<string, unknown>, "sources.prd");
  }

  // Check for unknown fields in sources
  const knownSourceFields = new Set(["plan", "prd"]);
  for (const key of Object.keys(sourcesObj)) {
    if (!knownSourceFields.has(key)) {
      throw new Error(`Unknown field in 'sources': '${key}'`);
    }
  }

  // Validate tasks array
  const tasksRaw = manifest.tasks;
  if (!Array.isArray(tasksRaw)) {
    throw new Error("Manifest missing 'tasks' array");
  }
  if (tasksRaw.length === 0) {
    throw new Error("Manifest 'tasks' array is empty");
  }

  // Parse and validate each task
  const tasks: TaskSpec[] = [];
  const taskIds = new Set<string>();

  for (let i = 0; i < tasksRaw.length; i++) {
    const taskRaw = tasksRaw[i];
    if (!taskRaw || typeof taskRaw !== "object") {
      throw new Error(`Task at index ${i} must be an object`);
    }
    const task = validateTaskSpec(taskRaw as Record<string, unknown>, i);

    // Check for duplicate IDs
    if (taskIds.has(task.id)) {
      throw new Error(`Duplicate task id: '${task.id}'`);
    }
    taskIds.add(task.id);
    tasks.push(task);
  }

  // Validate DAG structure: all dependencies must reference valid task IDs
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!taskIds.has(dep)) {
        throw new Error(`Task '${task.id}' depends on unknown task '${dep}'`);
      }
      if (dep === task.id) {
        throw new Error(`Task '${task.id}' depends on itself`);
      }
    }
  }

  // Validate DAG structure: detect cycles using topological sort
  validateDAG(tasks);

  return {
    version: 1,
    sources: {
      plan: {
        path: (planObj.path as string),
        sha256: (planObj.sha256 as string),
      },
      prd: sourcesObj.prd ? {
        path: ((sourcesObj.prd as Record<string, unknown>).path as string),
        sha256: ((sourcesObj.prd as Record<string, unknown>).sha256 as string),
      } : undefined,
    },
    tasks,
  };
}

function validateSourceRef(obj: Record<string, unknown>, context: string): void {
  const path = obj.path;
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error(`${context}.path must be a non-empty string`);
  }

  const sha256 = obj.sha256;
  if (typeof sha256 !== "string" || !isSha256(sha256)) {
    throw new Error(`${context}.sha256 must be a 64-character hex string`);
  }

  const knownFields = new Set(["path", "sha256"]);
  for (const key of Object.keys(obj)) {
    if (!knownFields.has(key)) {
      throw new Error(`Unknown field in '${context}': '${key}'`);
    }
  }
}

function validateTaskSpec(raw: Record<string, unknown>, index: number): TaskSpec {
  const context = `tasks[${index}]`;

  // Required string fields
  const id = requireNonEmptyString(raw, "id", context);
  const goal = requireNonEmptyString(raw, "goal", context);
  const currentBehavior = requireNonEmptyString(raw, "current_behavior", context);
  const agreedApproach = requireNonEmptyString(raw, "agreed_approach", context);

  // Validate id format
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$/.test(id)) {
    throw new Error(`${context}.id must match pattern YYYY-MM-DD-slug (got '${id}')`);
  }

  // success_tests array
  const successTestsRaw = raw.success_tests;
  if (!Array.isArray(successTestsRaw)) {
    throw new Error(`${context}.success_tests must be an array`);
  }
  if (successTestsRaw.length === 0) {
    throw new Error(`${context}.success_tests must have at least one test`);
  }

  const successTests: SuccessTest[] = [];
  const testIds = new Set<string>();

  for (let i = 0; i < successTestsRaw.length; i++) {
    const testRaw = successTestsRaw[i];
    if (!testRaw || typeof testRaw !== "object") {
      throw new Error(`${context}.success_tests[${i}] must be an object`);
    }
    const test = validateSuccessTest(testRaw as Record<string, unknown>, context, i);

    if (testIds.has(test.id)) {
      throw new Error(`${context} has duplicate test id: '${test.id}'`);
    }
    testIds.add(test.id);
    successTests.push(test);
  }

  // Validate test prerequisites
  const prerequisiteGraph = new Map<string, Set<string>>();
  for (const test of successTests) {
    if (!prerequisiteGraph.has(test.id)) {
      prerequisiteGraph.set(test.id, new Set());
    }
    for (const prereq of test.prerequisites) {
      // Check for duplicate prerequisites
      const prereqs = prerequisiteGraph.get(test.id)!;
      if (prereqs.has(prereq)) {
        throw new Error(`${context} test '${test.id}' has duplicate prerequisite '${prereq}'`);
      }
      prereqs.add(prereq);

      // Check for self-prerequisite
      if (prereq === test.id) {
        throw new Error(`${context} test '${test.id}' cannot depend on itself`);
      }

      if (!testIds.has(prereq)) {
        throw new Error(`${context} test '${test.id}' has unknown prerequisite '${prereq}'`);
      }
    }
  }

  // Detect prerequisite cycles using DFS
  function detectCycle(testId: string, visited: Set<string>, stack: Set<string>): string | null {
    if (stack.has(testId)) return testId;
    if (visited.has(testId)) return null;
    visited.add(testId);
    stack.add(testId);
    const prereqs = prerequisiteGraph.get(testId);
    if (prereqs) {
      for (const prereq of prereqs) {
        const cycle = detectCycle(prereq, visited, stack);
        if (cycle) return cycle;
      }
    }
    stack.delete(testId);
    return null;
  }

  const visited = new Set<string>();
  for (const test of successTests) {
    if (!visited.has(test.id)) {
      const stack = new Set<string>();
      const cycle = detectCycle(test.id, visited, stack);
      if (cycle) {
        throw new Error(`${context} test '${cycle}' is part of a prerequisite cycle`);
      }
    }
  }

  // String arrays
  // non_goals, relevant_files, architectural_constraints must be non-empty
  const nonGoals = requireStringArray(raw, "non_goals", context, false);
  const relevantFiles = requireStringArray(raw, "relevant_files", context, false);
  const architecturalConstraints = requireStringArray(raw, "architectural_constraints", context, false);

  // execution_authority object
  const execAuthRaw = raw.execution_authority;
  if (!execAuthRaw || typeof execAuthRaw !== "object") {
    throw new Error(`${context}.execution_authority must be an object`);
  }
  // execution_authority must include all required fields
  const execAuth = validateExecutionAuthority(execAuthRaw as Record<string, unknown>, context);

  // completion_policy object
  const compPolicyRaw = raw.completion_policy;
  if (!compPolicyRaw || typeof compPolicyRaw !== "object") {
    throw new Error(`${context}.completion_policy must be an object`);
  }
  const compPolicy = validateCompletionPolicy(compPolicyRaw as Record<string, unknown>, context);

  // depends_on array
  const dependsOn = requireStringArray(raw, "depends_on", context, true);
  if (new Set(dependsOn).size !== dependsOn.length) {
    throw new Error(`${context}has duplicate entries in depends_on`);
  }

  // Check for unknown fields
  const knownFields = new Set([
    "id", "goal", "current_behavior", "agreed_approach",
    "success_tests", "non_goals", "relevant_files", "architectural_constraints",
    "execution_authority", "completion_policy", "depends_on"
  ]);
  for (const key of Object.keys(raw)) {
    if (!knownFields.has(key)) {
      throw new Error(`Unknown field in '${context}': '${key}'`);
    }
  }

  return {
    id,
    goal,
    currentBehavior,
    agreedApproach,
    successTests,
    nonGoals,
    relevantFiles,
    architecturalConstraints,
    executionAuthority: execAuth,
    completionPolicy: compPolicy,
    dependsOn,
  };
}

function validateSuccessTest(raw: Record<string, unknown>, taskContext: string, index: number): SuccessTest {
  const context = `${taskContext}.success_tests[${index}]`;

  const id = requireNonEmptyString(raw, "id", context);

  // Validate ID format: ST-NN where NN is 2+ digits
  if (!/^ST-\d{2,}$/.test(id)) {
    throw new Error(`${context}.id must match ST-NN format (e.g., ST-01, ST-10), got '${id}'`);
  }

  const title = requireNonEmptyString(raw, "title", context);
  const command = requireNonEmptyString(raw, "command", context);
  assertCommandShape(command, context);
  const expectedEvidence = requireNonEmptyString(raw, "expected_evidence", context);

  const exitCode = raw.expected_exit_code;
  if (typeof exitCode !== "number" || !Number.isInteger(exitCode) || exitCode < 0) {
    throw new Error(`${context}.expected_exit_code must be a non-negative integer`);
  }

  const writesState = raw.writes_hardware_or_system_state;
  if (typeof writesState !== "boolean") {
    throw new Error(`${context}.writes_hardware_or_system_state must be a boolean`);
  }

  const prerequisites = requireStringArray(raw, "prerequisites", context, true);

  const knownFields = new Set([
    "id", "title", "command", "expected_exit_code", "expected_evidence",
    "writes_hardware_or_system_state", "prerequisites"
  ]);
  for (const key of Object.keys(raw)) {
    if (!knownFields.has(key)) {
      throw new Error(`Unknown field in '${context}': '${key}'`);
    }
  }

  return {
    id,
    title,
    command,
    expectedExitCode: exitCode,
    expectedEvidence,
    writesHardwareOrSystemState: writesState,
    prerequisites,
  };
}

function validateExecutionAuthority(raw: Record<string, unknown>, context: string): ExecutionAuthority {
  const repoEdits = raw.repository_edits;
  if (typeof repoEdits !== "boolean") {
    throw new Error(`${context}.execution_authority.repository_edits must be a boolean`);
  }

  const nonDestructive = raw.non_destructive_development_commands;
  if (typeof nonDestructive !== "boolean") {
    throw new Error(`${context}.execution_authority.non_destructive_development_commands must be a boolean`);
  }

  const routine = raw.routine_technical_decisions;
  if (typeof routine !== "boolean") {
    throw new Error(`${context}.execution_authority.routine_technical_decisions must be a boolean`);
  }

  const hwWrites = raw.hardware_system_writes;
  if (typeof hwWrites !== "boolean") {
    throw new Error(`${context}.execution_authority.hardware_system_writes must be a boolean`);
  }

  const allowedOps = requireStringArray(raw, "allowed_hardware_system_operations", `${context}.execution_authority`, true);

  const knownFields = new Set([
    "repository_edits", "non_destructive_development_commands", "routine_technical_decisions",
    "hardware_system_writes", "allowed_hardware_system_operations"
  ]);
  for (const key of Object.keys(raw)) {
    if (!knownFields.has(key)) {
      throw new Error(`Unknown field in '${context}.execution_authority': '${key}'`);
    }
  }

  return {
    repositoryEdits: repoEdits,
    nonDestructiveDevelopmentCommands: nonDestructive,
    routineTechnicalDecisions: routine,
    hardwareSystemWrites: hwWrites,
    allowedHardwareSystemOperations: allowedOps,
  };
}

function validateCompletionPolicy(raw: Record<string, unknown>, context: string): CompletionPolicy {
  const commitOnSuccess = raw.commit_on_success;
  if (typeof commitOnSuccess !== "boolean") {
    throw new Error(`${context}.completion_policy.commit_on_success must be a boolean`);
  }

  const pushOnSuccess = raw.push_on_success;
  if (typeof pushOnSuccess !== "boolean") {
    throw new Error(`${context}.completion_policy.push_on_success must be a boolean`);
  }

  const deployOnSuccess = raw.deploy_on_success;
  if (typeof deployOnSuccess !== "boolean") {
    throw new Error(`${context}.completion_policy.deploy_on_success must be a boolean`);
  }

  // V1 constraint: commit_on_success must be true, push/deploy must be false
  if (!commitOnSuccess) {
    throw new Error(`${context}.completion_policy.commit_on_success must be true (V1 constraint)`);
  }
  if (pushOnSuccess || deployOnSuccess) {
    throw new Error(`${context}.completion_policy push/deploy must be false (V1 constraint)`);
  }

  const knownFields = new Set(["commit_on_success", "push_on_success", "deploy_on_success"]);
  for (const key of Object.keys(raw)) {
    if (!knownFields.has(key)) {
      throw new Error(`Unknown field in '${context}.completion_policy': '${key}'`);
    }
  }

  return {
    commitOnSuccess,
    pushOnSuccess,
    deployOnSuccess,
  };
}

function requireNonEmptyString(obj: Record<string, unknown>, field: string, context: string): string {
  const value = obj[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${context}.${field} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(obj: Record<string, unknown>, field: string, context: string, allowEmpty: boolean): string[] {
  const value = obj[field];
  if (!Array.isArray(value)) {
    throw new Error(`${context}.${field} must be an array`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new Error(`${context}.${field} must not be empty`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string" || value[i].trim() === "") {
      throw new Error(`${context}.${field}[${i}] must be a non-empty string`);
    }
  }
  return value as string[];
}

/**
 * Validate DAG structure: detect cycles using topological sort (Kahn's algorithm).
 * Also validates that dependencies appear earlier in the list.
 */
function validateDAG(tasks: TaskSpec[]): void {
  const taskIds = new Set(tasks.map(t => t.id));

  // Build adjacency list and in-degree count
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // task -> tasks that depend on it

  for (const task of tasks) {
    inDegree.set(task.id, task.dependsOn.length);
    for (const dep of task.dependsOn) {
      if (!dependents.has(dep)) {
        dependents.set(dep, []);
      }
      dependents.get(dep)!.push(task.id);
    }
  }

  // Kahn's algorithm: find all nodes with in-degree 0
  const queue: string[] = [];
  for (const task of tasks) {
    if (inDegree.get(task.id) === 0) {
      queue.push(task.id);
    }
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;

    // Reduce in-degree for dependents
    const deps = dependents.get(current) || [];
    for (const dep of deps) {
      const degree = inDegree.get(dep)! - 1;
      inDegree.set(dep, degree);
      if (degree === 0) {
        queue.push(dep);
      }
    }
  }

  if (processed !== tasks.length) {
    throw new Error("Task dependency graph contains a cycle");
  }

  // Additional check: dependencies must appear earlier in the list
  const taskIndex = new Map<string, number>();
  for (let i = 0; i < tasks.length; i++) {
    taskIndex.set(tasks[i].id, i);
  }

  for (const task of tasks) {
    const taskIdx = taskIndex.get(task.id)!;
    for (const dep of task.dependsOn) {
      const depIdx = taskIndex.get(dep)!;
      if (depIdx >= taskIdx) {
        throw new Error(`Task '${task.id}' depends on '${dep}' which appears later in the manifest`);
      }
    }
  }
}
