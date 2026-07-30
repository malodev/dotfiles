import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { stringify } from "yaml";
import { execSync } from "node:child_process";
import { previewPlanImport } from "./plan-import.ts";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const PLAN_CONTENT = "# Plan\n\nThis is the plan.\n";
const PRD_CONTENT = "# PRD\n\nThis is the PRD.\n";
const VALID_SOURCES = {
  plan: { path: "plan.md", sha256: sha256(PLAN_CONTENT) },
  prd: { path: "prd.md", sha256: sha256(PRD_CONTENT) },
};

function makeMinimalTask(id: string, dependsOn: string[] = []) {
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

async function createTestRepo() {
  const repoPath = await mkdtemp(join(tmpdir(), "team-import-test-"));

  execSync("git init", { cwd: repoPath, stdio: "ignore" });
  execSync("git config user.email 'test@test.com'", { cwd: repoPath, stdio: "ignore" });
  execSync("git config user.name 'Test User'", { cwd: repoPath, stdio: "ignore" });

  // Create tracked source files so verifyManifestSources passes
  await writeFile(join(repoPath, "README.md"), "# Test Repo\n");
  await writeFile(join(repoPath, "plan.md"), PLAN_CONTENT);
  await writeFile(join(repoPath, "prd.md"), PRD_CONTENT);
  execSync("git add README.md plan.md prd.md", { cwd: repoPath, stdio: "ignore" });
  execSync("git commit -m 'Initial commit'", { cwd: repoPath, stdio: "ignore" });

  return repoPath;
}

test("previewPlanImport returns manifest digest and task list", async () => {
  const repoPath = await createTestRepo();
  const manifestPath = join(repoPath, "team", "plan.yaml");

  const manifest = {
    version: 1,
    sources: VALID_SOURCES,
    tasks: [
      makeMinimalTask("2026-07-28-task-one"),
      makeMinimalTask("2026-07-28-task-two", ["2026-07-28-task-one"]),
    ],
  };

  await mkdir(join(repoPath, "team"), { recursive: true });
  const manifestContent = stringify(manifest);
  await writeFile(manifestPath, manifestContent);

  // Commit the manifest to make repo clean
  const { execSync } = await import("node:child_process");
  execSync("git add team/plan.yaml", { cwd: repoPath, stdio: "ignore" });
  execSync("git commit -m 'Add manifest'", { cwd: repoPath, stdio: "ignore" });

  const digest = createHash("sha256").update(manifestContent).digest("hex");

  const preview = await previewPlanImport({
    repo: repoPath,
    manifestPath,
    approvedDigest: digest,
    ownerPrincipal: "test-user",
  });

  assert.ok(preview.manifestDigest);
  assert.ok(preview.initialHead);
  assert.equal(preview.tasks.length, 2);
  assert.equal(preview.tasks[0].id, "2026-07-28-task-one");
  assert.equal(preview.tasks[1].id, "2026-07-28-task-two");
  assert.deepEqual(preview.tasks[1].dependsOn, ["2026-07-28-task-one"]);
  assert.ok(preview.approvalCommand.includes("/team-import"));
  assert.ok(preview.approvalCommand.includes(preview.manifestDigest));
});

test("previewPlanImport rejects missing manifest file", async () => {
  const repoPath = await createTestRepo();
  const manifestPath = join(repoPath, "team", "nonexistent.yaml");

  await assert.rejects(
    previewPlanImport({
      repo: repoPath,
      manifestPath,
      approvedDigest: "dummy",
      ownerPrincipal: "test-user",
    }),
    /ENOENT/i
  );
});

test("previewPlanImport rejects invalid manifest", async () => {
  const repoPath = await createTestRepo();
  const manifestPath = join(repoPath, "team", "invalid.yaml");

  await mkdir(join(repoPath, "team"), { recursive: true });
  await writeFile(manifestPath, "invalid: yaml: content: [");

  await assert.rejects(
    previewPlanImport({
      repo: repoPath,
      manifestPath,
      approvedDigest: "dummy",
      ownerPrincipal: "test-user",
    }),
    /yaml|parse/i
  );
});

test("previewPlanImport rejects dirty repository", async () => {
  const repoPath = await createTestRepo();
  const manifestPath = join(repoPath, "team", "plan.yaml");

  const manifest = {
    version: 1,
    sources: VALID_SOURCES,
    tasks: [makeMinimalTask("2026-07-28-task-one")],
  };

  await mkdir(join(repoPath, "team"), { recursive: true });
  const manifestContent = stringify(manifest);
  await writeFile(manifestPath, manifestContent);
  const digest = createHash("sha256").update(manifestContent).digest("hex");

  // Make repo dirty
  await writeFile(join(repoPath, "dirty.txt"), "untracked");

  await assert.rejects(
    previewPlanImport({
      repo: repoPath,
      manifestPath,
      approvedDigest: digest,
      ownerPrincipal: "test-user",
    }),
    /clean|dirty/i
  );
});

test("previewPlanImport handles single task without dependencies", async () => {
  const repoPath = await createTestRepo();
  const manifestPath = join(repoPath, "team", "plan.yaml");

  const manifest = {
    version: 1,
    sources: { plan: VALID_SOURCES.plan },
    tasks: [makeMinimalTask("2026-07-28-single-task")],
  };

  await mkdir(join(repoPath, "team"), { recursive: true });
  const manifestContent = stringify(manifest);
  await writeFile(manifestPath, manifestContent);

  // Commit the manifest to make repo clean
  const { execSync } = await import("node:child_process");
  execSync("git add team/plan.yaml", { cwd: repoPath, stdio: "ignore" });
  execSync("git commit -m 'Add manifest'", { cwd: repoPath, stdio: "ignore" });

  const digest = createHash("sha256").update(manifestContent).digest("hex");

  const preview = await previewPlanImport({
    repo: repoPath,
    manifestPath,
    approvedDigest: digest,
    ownerPrincipal: "test-user",
  });

  assert.equal(preview.tasks.length, 1);
  assert.deepEqual(preview.tasks[0].dependsOn, []);
});

test("previewPlanImport handles complex dependency graph", async () => {
  const repoPath = await createTestRepo();
  const manifestPath = join(repoPath, "team", "plan.yaml");

  const manifest = {
    version: 1,
    sources: VALID_SOURCES,
    tasks: [
      makeMinimalTask("2026-07-28-task-a"),
      makeMinimalTask("2026-07-28-task-b"),
      makeMinimalTask("2026-07-28-task-c", ["2026-07-28-task-a", "2026-07-28-task-b"]),
      makeMinimalTask("2026-07-28-task-d", ["2026-07-28-task-c"]),
    ],
  };

  await mkdir(join(repoPath, "team"), { recursive: true });
  const manifestContent = stringify(manifest);
  await writeFile(manifestPath, manifestContent);

  // Commit the manifest to make repo clean
  const { execSync } = await import("node:child_process");
  execSync("git add team/plan.yaml", { cwd: repoPath, stdio: "ignore" });
  execSync("git commit -m 'Add manifest'", { cwd: repoPath, stdio: "ignore" });

  const digest = createHash("sha256").update(manifestContent).digest("hex");

  const preview = await previewPlanImport({
    repo: repoPath,
    manifestPath,
    approvedDigest: digest,
    ownerPrincipal: "test-user",
  });

  assert.equal(preview.tasks.length, 4);
  assert.deepEqual(preview.tasks[2].dependsOn, ["2026-07-28-task-a", "2026-07-28-task-b"]);
  assert.deepEqual(preview.tasks[3].dependsOn, ["2026-07-28-task-c"]);
});

test("previewPlanImport rejects cyclic dependencies", async () => {
  const repoPath = await createTestRepo();
  const manifestPath = join(repoPath, "team", "plan.yaml");

  const manifest = {
    version: 1,
    sources: VALID_SOURCES,
    tasks: [
      makeMinimalTask("2026-07-28-task-a", ["2026-07-28-task-b"]),
      makeMinimalTask("2026-07-28-task-b", ["2026-07-28-task-a"]),
    ],
  };

  await mkdir(join(repoPath, "team"), { recursive: true });
  const manifestContent = stringify(manifest);
  await writeFile(manifestPath, manifestContent);
  const digest = createHash("sha256").update(manifestContent).digest("hex");

  await assert.rejects(
    previewPlanImport({
      repo: repoPath,
      manifestPath,
      approvedDigest: digest,
      ownerPrincipal: "test-user",
    }),
    /cycle|later/i
  );
});

test("previewPlanImport rejects duplicate task IDs", async () => {
  const repoPath = await createTestRepo();
  const manifestPath = join(repoPath, "team", "plan.yaml");

  const manifest = {
    version: 1,
    sources: VALID_SOURCES,
    tasks: [
      makeMinimalTask("2026-07-28-duplicate"),
      makeMinimalTask("2026-07-28-duplicate"),
    ],
  };

  await mkdir(join(repoPath, "team"), { recursive: true });
  const manifestContent = stringify(manifest);
  await writeFile(manifestPath, manifestContent);
  const digest = createHash("sha256").update(manifestContent).digest("hex");

  await assert.rejects(
    previewPlanImport({
      repo: repoPath,
      manifestPath,
      approvedDigest: digest,
      ownerPrincipal: "test-user",
    }),
    /duplicate/i
  );
});

test("previewPlanImport rejects task with unknown dependency", async () => {
  const repoPath = await createTestRepo();
  const manifestPath = join(repoPath, "team", "plan.yaml");

  const manifest = {
    version: 1,
    sources: VALID_SOURCES,
    tasks: [
      makeMinimalTask("2026-07-28-task-a", ["2026-07-28-nonexistent"]),
    ],
  };

  await mkdir(join(repoPath, "team"), { recursive: true });
  const manifestContent = stringify(manifest);
  await writeFile(manifestPath, manifestContent);
  const digest = createHash("sha256").update(manifestContent).digest("hex");

  await assert.rejects(
    previewPlanImport({
      repo: repoPath,
      manifestPath,
      approvedDigest: digest,
      ownerPrincipal: "test-user",
    }),
    /unknown/i
  );
});
