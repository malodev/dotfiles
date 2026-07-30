import assert from "node:assert/strict";
import test from "node:test";
import { parsePlanManifest } from "./plan-manifest.ts";
import { stringify } from "yaml";

const VALID_SOURCES = {
  plan: { path: "plan.md", sha256: "a".repeat(64) },
  prd: { path: "prd.md", sha256: "b".repeat(64) },
};

function makeMinimalTask(id: string, dependsOn: string[] = []): Record<string, unknown> {
  return {
    id,
    goal: "Test goal",
    current_behavior: "Current behavior",
    agreed_approach: "Agreed approach",
    success_tests: [
      {
        id: "ST-01",
        title: "test passes",
        command: "echo test",
        expected_exit_code: 0,
        expected_evidence: "test output",
        writes_hardware_or_system_state: false,
        prerequisites: [],
      },
    ],
    non_goals: ["Not this"],
    relevant_files: ["src/test.ts"],
    architectural_constraints: ["No changes to core"],
    execution_authority: {
      repository_edits: true,
      non_destructive_development_commands: true,
      routine_technical_decisions: true,
      hardware_system_writes: false,
      allowed_hardware_system_operations: [],
    },
    completion_policy: {
      commit_on_success: true,
      push_on_success: false,
      deploy_on_success: false,
    },
    depends_on: dependsOn,
  };
}

function makeValidManifest(tasks: Record<string, unknown>[] = [makeMinimalTask("2026-07-28-task-one")]): string {
  return stringify({
    version: 1,
    sources: VALID_SOURCES,
    tasks,
  });
}

test("parsePlanManifest accepts minimal valid manifest", () => {
  const yaml = makeValidManifest();
  const manifest = parsePlanManifest(yaml);

  assert.equal(manifest.version, 1);
  assert.equal(manifest.sources.plan.path, "plan.md");
  assert.equal(manifest.sources.plan.sha256, "a".repeat(64));
  assert.equal(manifest.sources.prd?.path, "prd.md");
  assert.equal(manifest.tasks.length, 1);
  assert.equal(manifest.tasks[0].id, "2026-07-28-task-one");
  assert.equal(manifest.tasks[0].successTests.length, 1);
  assert.deepEqual(manifest.tasks[0].dependsOn, []);
});

test("parsePlanManifest accepts manifest with dependencies", () => {
  const tasks = [
    makeMinimalTask("2026-07-28-task-one"),
    makeMinimalTask("2026-07-28-task-two", ["2026-07-28-task-one"]),
    makeMinimalTask("2026-07-28-task-three", ["2026-07-28-task-one", "2026-07-28-task-two"]),
  ];
  const yaml = makeValidManifest(tasks);
  const manifest = parsePlanManifest(yaml);

  assert.equal(manifest.tasks.length, 3);
  assert.deepEqual(manifest.tasks[1].dependsOn, ["2026-07-28-task-one"]);
  assert.deepEqual(manifest.tasks[2].dependsOn, ["2026-07-28-task-one", "2026-07-28-task-two"]);
});

test("parsePlanManifest rejects unsupported version", () => {
  const yaml = stringify({
    version: 2,
    sources: VALID_SOURCES,
    tasks: [makeMinimalTask("2026-07-28-task-one")],
  });
  assert.throws(() => parsePlanManifest(yaml), /Unsupported manifest version: 2/);
});

test("parsePlanManifest rejects missing version", () => {
  const yaml = stringify({
    sources: VALID_SOURCES,
    tasks: [makeMinimalTask("2026-07-28-task-one")],
  });
  assert.throws(() => parsePlanManifest(yaml), /Manifest missing 'version'/);
});

test("parsePlanManifest rejects missing sources", () => {
  const yaml = stringify({
    version: 1,
    tasks: [makeMinimalTask("2026-07-28-task-one")],
  });
  assert.throws(() => parsePlanManifest(yaml), /Manifest missing 'sources'/);
});

test("parsePlanManifest rejects missing sources.plan", () => {
  const yaml = stringify({
    version: 1,
    sources: {},
    tasks: [makeMinimalTask("2026-07-28-task-one")],
  });
  assert.throws(() => parsePlanManifest(yaml), /Manifest missing 'sources.plan'/);
});

test("parsePlanManifest rejects invalid plan.sha256", () => {
  const yaml = stringify({
    version: 1,
    sources: {
      plan: { path: "plan.md", sha256: "invalid" },
    },
    tasks: [makeMinimalTask("2026-07-28-task-one")],
  });
  assert.throws(() => parsePlanManifest(yaml), /sources\.plan\.sha256 must be a 64-character hex string/);
});

test("parsePlanManifest rejects missing tasks array", () => {
  const yaml = stringify({
    version: 1,
    sources: VALID_SOURCES,
  });
  assert.throws(() => parsePlanManifest(yaml), /Manifest missing 'tasks' array/);
});

test("parsePlanManifest rejects empty tasks array", () => {
  const yaml = stringify({
    version: 1,
    sources: VALID_SOURCES,
    tasks: [],
  });
  assert.throws(() => parsePlanManifest(yaml), /Manifest 'tasks' array is empty/);
});

test("parsePlanManifest rejects duplicate task IDs", () => {
  const tasks = [
    makeMinimalTask("2026-07-28-task-one"),
    makeMinimalTask("2026-07-28-task-one"),
  ];
  const yaml = makeValidManifest(tasks);
  assert.throws(() => parsePlanManifest(yaml), /Duplicate task id: '2026-07-28-task-one'/);
});

test("parsePlanManifest rejects unknown task dependency", () => {
  const tasks = [
    makeMinimalTask("2026-07-28-task-one", ["2026-07-28-nonexistent"]),
  ];
  const yaml = makeValidManifest(tasks);
  assert.throws(() => parsePlanManifest(yaml), /depends on unknown task '2026-07-28-nonexistent'/);
});

test("parsePlanManifest rejects self-dependency", () => {
  const tasks = [
    makeMinimalTask("2026-07-28-task-one", ["2026-07-28-task-one"]),
  ];
  const yaml = makeValidManifest(tasks);
  assert.throws(() => parsePlanManifest(yaml), /depends on itself/);
});

test("parsePlanManifest detects cycles", () => {
  const tasks = [
    makeMinimalTask("2026-07-28-task-one", ["2026-07-28-task-two"]),
    makeMinimalTask("2026-07-28-task-two", ["2026-07-28-task-one"]),
  ];
  const yaml = makeValidManifest(tasks);
  assert.throws(() => parsePlanManifest(yaml), /cycle/);
});

test("parsePlanManifest rejects dependency appearing later in list", () => {
  const tasks = [
    makeMinimalTask("2026-07-28-task-one", ["2026-07-28-task-two"]),
    makeMinimalTask("2026-07-28-task-two"),
  ];
  const yaml = makeValidManifest(tasks);
  assert.throws(() => parsePlanManifest(yaml), /depends on '2026-07-28-task-two' which appears later/);
});

test("parsePlanManifest rejects missing task fields", () => {
  const task = makeMinimalTask("2026-07-28-task-one");
  delete task.goal;
  const yaml = makeValidManifest([task]);
  assert.throws(() => parsePlanManifest(yaml), /tasks\[0\]\.goal must be a non-empty string/);
});

test("parsePlanManifest rejects invalid task ID format", () => {
  const tasks = [makeMinimalTask("invalid-id")];
  const yaml = makeValidManifest(tasks);
  assert.throws(() => parsePlanManifest(yaml), /must match pattern YYYY-MM-DD-slug/);
});

test("parsePlanManifest rejects empty success_tests", () => {
  const task = makeMinimalTask("2026-07-28-task-one");
  task.success_tests = [];
  const yaml = makeValidManifest([task]);
  assert.throws(() => parsePlanManifest(yaml), /must have at least one test/);
});

test("parsePlanManifest rejects duplicate test IDs", () => {
  const task = makeMinimalTask("2026-07-28-task-one");
  task.success_tests = [
    {
      id: "ST-01",
      title: "test1",
      command: "echo test1",
      expected_exit_code: 0,
      expected_evidence: "output1",
      writes_hardware_or_system_state: false,
      prerequisites: [],
    },
    {
      id: "ST-01",
      title: "test2",
      command: "echo test2",
      expected_exit_code: 0,
      expected_evidence: "output2",
      writes_hardware_or_system_state: false,
      prerequisites: [],
    },
  ];
  const yaml = makeValidManifest([task]);
  assert.throws(() => parsePlanManifest(yaml), /duplicate test id: 'ST-01'/);
});

test("parsePlanManifest rejects unknown test prerequisite", () => {
  const task = makeMinimalTask("2026-07-28-task-one");
  task.success_tests = [
    {
      id: "ST-01",
      title: "test",
      command: "echo test",
      expected_exit_code: 0,
      expected_evidence: "output",
      writes_hardware_or_system_state: false,
      prerequisites: ["ST-99"],
    },
  ];
  const yaml = makeValidManifest([task]);
  assert.throws(() => parsePlanManifest(yaml), /unknown prerequisite 'ST-99'/);
});

test("parsePlanManifest rejects commit_on_success: false", () => {
  const task = makeMinimalTask("2026-07-28-task-one");
  task.completion_policy = {
    commit_on_success: false,
    push_on_success: false,
    deploy_on_success: false,
  };
  const yaml = makeValidManifest([task]);
  assert.throws(() => parsePlanManifest(yaml), /commit_on_success must be true/);
});

test("parsePlanManifest rejects push_on_success: true", () => {
  const task = makeMinimalTask("2026-07-28-task-one");
  task.completion_policy = {
    commit_on_success: true,
    push_on_success: true,
    deploy_on_success: false,
  };
  const yaml = makeValidManifest([task]);
  assert.throws(() => parsePlanManifest(yaml), /push\/deploy must be false/);
});

test("parsePlanManifest rejects deploy_on_success: true", () => {
  const task = makeMinimalTask("2026-07-28-task-one");
  task.completion_policy = {
    commit_on_success: true,
    push_on_success: false,
    deploy_on_success: true,
  };
  const yaml = makeValidManifest([task]);
  assert.throws(() => parsePlanManifest(yaml), /push\/deploy must be false/);
});

test("parsePlanManifest rejects unknown fields in sources", () => {
  const yaml = stringify({
    version: 1,
    sources: {
      plan: { path: "plan.md", sha256: "a".repeat(64) },
      unknown_field: "value",
    },
    tasks: [makeMinimalTask("2026-07-28-task-one")],
  });
  assert.throws(() => parsePlanManifest(yaml), /Unknown field in 'sources': 'unknown_field'/);
});

test("parsePlanManifest rejects unknown fields in task", () => {
  const task = makeMinimalTask("2026-07-28-task-one");
  task.unknown_field = "value";
  const yaml = makeValidManifest([task]);
  assert.throws(() => parsePlanManifest(yaml), /Unknown field in 'tasks\[0\]': 'unknown_field'/);
});

test("parsePlanManifest rejects unknown fields in success_test", () => {
  const task = makeMinimalTask("2026-07-28-task-one");
  task.success_tests = [
    {
      id: "ST-01",
      title: "test",
      command: "echo test",
      expected_exit_code: 0,
      expected_evidence: "output",
      writes_hardware_or_system_state: false,
      prerequisites: [],
      unknown_field: "value",
    },
  ];
  const yaml = makeValidManifest([task]);
  assert.throws(() => parsePlanManifest(yaml), /Unknown field in 'tasks\[0\]\.success_tests\[0\]': 'unknown_field'/);
});

test("parsePlanManifest rejects non-object task", () => {
  const yaml = stringify({
    version: 1,
    sources: VALID_SOURCES,
    tasks: ["not-an-object"],
  });
  assert.throws(() => parsePlanManifest(yaml), /Task at index 0 must be an object/);
});

test("parsePlanManifest rejects negative expected_exit_code", () => {
  const task = makeMinimalTask("2026-07-28-task-one");
  task.success_tests = [
    {
      id: "ST-01",
      title: "test",
      command: "echo test",
      expected_exit_code: -1,
      expected_evidence: "output",
      writes_hardware_or_system_state: false,
      prerequisites: [],
    },
  ];
  const yaml = makeValidManifest([task]);
  assert.throws(() => parsePlanManifest(yaml), /must be a non-negative integer/);
});

test("parsePlanManifest accepts manifest without prd source", () => {
  const yaml = stringify({
    version: 1,
    sources: {
      plan: { path: "plan.md", sha256: "a".repeat(64) },
    },
    tasks: [makeMinimalTask("2026-07-28-task-one")],
  });
  const manifest = parsePlanManifest(yaml);
  assert.equal(manifest.sources.prd, undefined);
  assert.equal(manifest.tasks.length, 1);
});
