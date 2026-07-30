import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { stringify } from "yaml";
import { parsePlanManifest } from "./plan-manifest.ts";
import { openDurableQueue } from "./queue.ts";
import { mkdtemp, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const A = "a".repeat(40);
const B = "b".repeat(40);

test("manifest parser rejects YAML aliases", () => {
  const planSha = createHash("sha256").update("plan").digest("hex");
  const yaml = `
version: 1
sources:
  plan: &src
    path: team/plan.md
    sha256: ${planSha}
  prd: *src
tasks:
  - id: 2026-01-01-test
    goal: Test
    current_behavior: Current
    agreed_approach: Approach
    success_tests:
      - id: ST-01
        title: test
        command: echo ok
        expected_exit_code: 0
        expected_evidence: ok
        writes_hardware_or_system_state: false
        prerequisites: []
    non_goals: []
    relevant_files: []
    architectural_constraints: []
    execution_authority:
      repository_edits: true
      hardware_system_writes: false
      allowed_hardware_system_operations: []
    completion_policy:
      commit_on_success: true
      push_on_success: false
      deploy_on_success: false
    depends_on: []
`;
  assert.throws(() => parsePlanManifest(yaml), /alias|anchor/i);
});

test("manifest parser rejects standalone anchors without aliases", () => {
  const planSha = createHash("sha256").update("plan").digest("hex");
  const yaml = `
version: 1
sources:
  plan:
    path: team/plan.md
    sha256: ${planSha}
tasks:
  - &standalone
    id: 2026-01-01-test
    goal: Test
`;
  assert.throws(() => parsePlanManifest(yaml), /anchor/i);
});

test("manifest parser rejects anchors and merge keys", () => {
  const planSha = createHash("sha256").update("plan").digest("hex");
  const yaml = `
version: 1
sources:
  plan:
    path: team/plan.md
    sha256: ${planSha}
tasks:
  - &task
    id: 2026-01-01-test
    goal: Test
    current_behavior: Current
    agreed_approach: Approach
    success_tests:
      - id: ST-01
        title: test
        command: echo ok
        expected_exit_code: 0
        expected_evidence: ok
        writes_hardware_or_system_state: false
        prerequisites: []
    non_goals: []
    relevant_files: []
    architectural_constraints: []
    execution_authority:
      repository_edits: true
      hardware_system_writes: false
      allowed_hardware_system_operations: []
    completion_policy:
      commit_on_success: true
      push_on_success: false
      deploy_on_success: false
    depends_on: []
  - <<: *task
    id: 2026-01-01-test-2
`;
  assert.throws(() => parsePlanManifest(yaml), /anchor|merge|alias/i);
});

test("manifest parser rejects unknown root fields", () => {
  const planSha = createHash("sha256").update("plan").digest("hex");
  const yaml = `
version: 1
sources:
  plan:
    path: team/plan.md
    sha256: ${planSha}
tasks:
  - id: 2026-01-01-test
    goal: Test
    current_behavior: Current
    agreed_approach: Approach
    success_tests:
      - id: ST-01
        title: test
        command: echo ok
        expected_exit_code: 0
        expected_evidence: ok
        writes_hardware_or_system_state: false
        prerequisites: []
    non_goals: []
    relevant_files: []
    architectural_constraints: []
    execution_authority:
      repository_edits: true
      hardware_system_writes: false
      allowed_hardware_system_operations: []
    completion_policy:
      commit_on_success: true
      push_on_success: false
      deploy_on_success: false
    depends_on: []
extra_field: not allowed
`;
  assert.throws(() => parsePlanManifest(yaml), /unknown.*field|extra_field/i);
});

test("manifest parser requires success-test title", () => {
  const planSha = createHash("sha256").update("plan").digest("hex");
  const yaml = `
version: 1
sources:
  plan:
    path: team/plan.md
    sha256: ${planSha}
tasks:
  - id: 2026-01-01-test
    goal: Test
    current_behavior: Current
    agreed_approach: Approach
    success_tests:
      - id: ST-01
        command: echo ok
        expected_exit_code: 0
        expected_evidence: ok
        writes_hardware_or_system_state: false
        prerequisites: []
    non_goals: []
    relevant_files: []
    architectural_constraints: []
    execution_authority:
      repository_edits: true
      hardware_system_writes: false
      allowed_hardware_system_operations: []
    completion_policy:
      commit_on_success: true
      push_on_success: false
      deploy_on_success: false
    depends_on: []
`;
  assert.throws(() => parsePlanManifest(yaml), /title/i);
});

test("manifest parser requires ST-NN format for success-test IDs", () => {
  const planSha = createHash("sha256").update("plan").digest("hex");
  const yaml = `
version: 1
sources:
  plan:
    path: team/plan.md
    sha256: ${planSha}
tasks:
  - id: 2026-01-01-test
    goal: Test
    current_behavior: Current
    agreed_approach: Approach
    success_tests:
      - id: TEST-01
        title: test
        command: echo ok
        expected_exit_code: 0
        expected_evidence: ok
        writes_hardware_or_system_state: false
        prerequisites: []
    non_goals: []
    relevant_files: []
    architectural_constraints: []
    execution_authority:
      repository_edits: true
      hardware_system_writes: false
      allowed_hardware_system_operations: []
    completion_policy:
      commit_on_success: true
      push_on_success: false
      deploy_on_success: false
    depends_on: []
`;
  assert.throws(() => parsePlanManifest(yaml), /ST-\d+/i);
});

test("manifest parser rejects duplicate prerequisites", () => {
  const planSha = createHash("sha256").update("plan").digest("hex");
  const yaml = `
version: 1
sources:
  plan:
    path: team/plan.md
    sha256: ${planSha}
tasks:
  - id: 2026-01-01-test
    goal: Test
    current_behavior: Current
    agreed_approach: Approach
    success_tests:
      - id: ST-01
        title: test1
        command: echo ok
        expected_exit_code: 0
        expected_evidence: ok
        writes_hardware_or_system_state: false
        prerequisites: []
      - id: ST-02
        title: test2
        command: echo ok
        expected_exit_code: 0
        expected_evidence: ok
        writes_hardware_or_system_state: false
        prerequisites: [ST-01, ST-01]
    non_goals: []
    relevant_files: []
    architectural_constraints: []
    execution_authority:
      repository_edits: true
      hardware_system_writes: false
      allowed_hardware_system_operations: []
    completion_policy:
      commit_on_success: true
      push_on_success: false
      deploy_on_success: false
    depends_on: []
`;
  assert.throws(() => parsePlanManifest(yaml), /duplicate.*prerequisite/i);
});

test("manifest parser rejects self-prerequisite", () => {
  const planSha = createHash("sha256").update("plan").digest("hex");
  const yaml = `
version: 1
sources:
  plan:
    path: team/plan.md
    sha256: ${planSha}
tasks:
  - id: 2026-01-01-test
    goal: Test
    current_behavior: Current
    agreed_approach: Approach
    success_tests:
      - id: ST-01
        title: test
        command: echo ok
        expected_exit_code: 0
        expected_evidence: ok
        writes_hardware_or_system_state: false
        prerequisites: [ST-01]
    non_goals: []
    relevant_files: []
    architectural_constraints: []
    execution_authority:
      repository_edits: true
      hardware_system_writes: false
      allowed_hardware_system_operations: []
    completion_policy:
      commit_on_success: true
      push_on_success: false
      deploy_on_success: false
    depends_on: []
`;
  assert.throws(() => parsePlanManifest(yaml), /cannot depend on itself/i);
});

test("manifest parser detects success-test prerequisite cycles", () => {
  const planSha = createHash("sha256").update("plan").digest("hex");
  const yaml = `
version: 1
sources:
  plan:
    path: team/plan.md
    sha256: ${planSha}
tasks:
  - id: 2026-01-01-test
    goal: Test
    current_behavior: Current
    agreed_approach: Approach
    success_tests:
      - id: ST-01
        title: test1
        command: echo ok
        expected_exit_code: 0
        expected_evidence: ok
        writes_hardware_or_system_state: false
        prerequisites: [ST-02]
      - id: ST-02
        title: test2
        command: echo ok
        expected_exit_code: 0
        expected_evidence: ok
        writes_hardware_or_system_state: false
        prerequisites: [ST-01]
    non_goals: []
    relevant_files: []
    architectural_constraints: []
    execution_authority:
      repository_edits: true
      hardware_system_writes: false
      allowed_hardware_system_operations: []
    completion_policy:
      commit_on_success: true
      push_on_success: false
      deploy_on_success: false
    depends_on: []
`;
  assert.throws(() => parsePlanManifest(yaml), /cycle/i);
});

test("bulk replay remains idempotent after queue-head advancement", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "plan-import-bulk-replay-"));
  await chmod(root, 0o700);
  const repo = resolve(root, "repo");
  const stateRoot = resolve(root, "state");
  await mkdir(repo, { mode: 0o700 });
  await mkdir(stateRoot, { mode: 0o700 });

  execSync("git init -q", { cwd: repo, stdio: "ignore" });
  execSync("git config user.email test@test.invalid", { cwd: repo, stdio: "ignore" });
  execSync("git config user.name Test", { cwd: repo, stdio: "ignore" });
  await import("node:fs/promises").then(fs => fs.writeFile(resolve(repo, "README.md"), "# Test\n"));
  execSync("git add .", { cwd: repo, stdio: "ignore" });
  execSync('git commit -qm "initial"', { cwd: repo, stdio: "ignore" });

  const queue = await openDurableQueue(repo, { stateRoot });

  // First bulk enqueue
  const entries1 = [
    {
      taskId: "2026-01-01-task-1",
      dependsOn: [],
      baselineCommit: A,
      expectedHead: A,
      approvedBriefDigest: "1".repeat(64),
      contractDigest: "2".repeat(64),
      ownerPrincipal: "uid:test",
      approvedAt: "2026-01-01T00:00:00.000Z",
      approvalSource: "/team-enqueue" as const,
      completionPolicy: { commitOnSuccess: true as const, pushOnSuccess: false as const, deployOnSuccess: false as const },
    },
    {
      taskId: "2026-01-01-task-2",
      dependsOn: ["2026-01-01-task-1"],
      baselineCommit: A,
      expectedHead: A,
      approvedBriefDigest: "3".repeat(64),
      contractDigest: "4".repeat(64),
      ownerPrincipal: "uid:test",
      approvedAt: "2026-01-01T00:00:00.000Z",
      approvalSource: "/team-enqueue" as const,
      completionPolicy: { commitOnSuccess: true as const, pushOnSuccess: false as const, deployOnSuccess: false as const },
    },
  ];

  await queue.command({ type: "bulkEnqueue", entries: entries1, expectedRevision: 0 });

  // Advance queue head by completing the first task
  await queue.withDispatcher(async (session) => {
    const claim = await session.claimNext();
    if (!claim) throw new Error("no claim");
    for (const phase of ["AUTHORIZING", "AUTHORIZED", "EXECUTING", "VERIFIED", "COMMITTING"] as const) {
      await session.advance(claim.entry.taskId, claim.attempt.attemptId, phase);
    }
    await session.complete(claim.entry.taskId, claim.attempt.attemptId, B);
  });

  // Now replay the same bulk enqueue - should be idempotent
  const replay = await queue.command({ type: "bulkEnqueue", entries: entries1, expectedRevision: 0 });

  assert.equal(replay.changed, false, "replay should be no-op");
  const snapshot = await queue.snapshot();
  assert.equal(snapshot.entries.length, 2, "should still have 2 entries");
});
