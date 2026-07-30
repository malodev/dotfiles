import { mkdtemp, mkdir, writeFile, symlink, readFile, chmod, stat, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, relative, join } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { stringify } from "yaml";

export interface TestManifestTask {
  id: string;
  goal: string;
  current_behavior: string;
  agreed_approach: string;
  success_tests: Array<{
    id: string;
    title?: string;
    command: string;
    expected_exit_code: number;
    expected_evidence: string;
    writes_hardware_or_system_state: boolean;
    prerequisites: string[];
  }>;
  non_goals: string[];
  relevant_files: string[];
  architectural_constraints: string[];
  execution_authority: {
    repository_edits: boolean;
    non_destructive_development_commands: boolean;
    routine_technical_decisions: boolean;
    hardware_system_writes: boolean;
    allowed_hardware_system_operations: string[];
  };
  completion_policy: {
    commit_on_success: boolean;
    push_on_success: boolean;
    deploy_on_success: boolean;
  };
  depends_on: string[];
}

export interface TestFixture {
  repo: string;
  stateRoot: string;
  baseline: string;
  manifestPath: string;
  manifestDigest: string;
  planSha: string;
  prdSha: string;
}

export async function createTestFixture(): Promise<TestFixture> {
  const root = await mkdtemp(resolve(tmpdir(), "plan-import-"));
  await chmod(root, 0o700);
  const repo = resolve(root, "repo");
  const stateRoot = resolve(root, "state");
  await mkdir(repo, { mode: 0o700 });
  await mkdir(stateRoot, { mode: 0o700 });

  // Initialize Git repo
  execSync("git init -q", { cwd: repo, stdio: "ignore" });
  execSync("git config user.email test@test.invalid", { cwd: repo, stdio: "ignore" });
  execSync("git config user.name Test", { cwd: repo, stdio: "ignore" });

  // Create AGENTS.md (required by validator)
  const agentsContent = `# Agents

Use strict commands. No placeholders.
`;
  await writeFile(resolve(repo, "AGENTS.md"), agentsContent);

  // Create source files
  const planContent = `# Plan

This is the plan.
`;
  const prdContent = `# PRD

This is the PRD.
`;
  await mkdir(resolve(repo, "team"), { mode: 0o755 });
  await writeFile(resolve(repo, "team/plan.md"), planContent);
  await writeFile(resolve(repo, "team/prd.md"), prdContent);

  // Initial commit
  execSync("git add .", { cwd: repo, stdio: "ignore" });
  execSync('git commit -qm "initial"', { cwd: repo, stdio: "ignore" });
  const baseline = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim();

  const planSha = createHash("sha256").update(planContent).digest("hex");
  const prdSha = createHash("sha256").update(prdContent).digest("hex");

  const manifestPath = resolve(repo, "team/plan.yaml");

  return { repo, stateRoot, baseline, manifestPath, manifestDigest: "", planSha, prdSha };
}

export function makeValidTask(id: string, dependsOn: string[] = []): TestManifestTask {
  return {
    id,
    goal: "Test goal",
    current_behavior: "Current behavior",
    agreed_approach: "Agreed approach",
    success_tests: [
      {
        id: "ST-01",
        title: "test passes",
        command: "echo ok",
        expected_exit_code: 0,
        expected_evidence: "ok",
        writes_hardware_or_system_state: false,
        prerequisites: [],
      },
    ],
    non_goals: ["not this"],
    relevant_files: ["src/test.ts"],
    architectural_constraints: ["no changes to core"],
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

export function writeManifest(fixture: TestFixture, tasks: TestManifestTask[]): string {
  const manifest = {
    version: 1,
    sources: {
      plan: { path: "team/plan.md", sha256: fixture.planSha },
      prd: { path: "team/prd.md", sha256: fixture.prdSha },
    },
    tasks,
  };
  const content = stringify(manifest);
  return content;
}

export async function commitManifest(fixture: TestFixture, content: string): Promise<string> {
  await writeFile(fixture.manifestPath, content);
  execSync("git add team/plan.yaml", { cwd: fixture.repo, stdio: "ignore" });
  execSync('git commit -qm "add manifest"', { cwd: fixture.repo, stdio: "ignore" });
  const digest = createHash("sha256").update(content).digest("hex");
  return digest;
}

export async function repoIsClean(repo: string): Promise<boolean> {
  const status = execSync("git status --porcelain", { cwd: repo, encoding: "utf8" });
  return status.trim() === "";
}

export async function countCommits(repo: string, since: string): Promise<number> {
  const log = execSync(`git log --oneline ${since}..HEAD`, { cwd: repo, encoding: "utf8" });
  return log.trim().split("\n").filter(l => l.length > 0).length;
}

export async function createTaskDirectory(repo: string, taskId: string): Promise<string> {
  const taskDir = resolve(repo, "team/tasks", taskId);
  await mkdir(taskDir, { recursive: true, mode: 0o755 });
  return taskDir;
}

export async function createSymlinkedTaskDir(repo: string, taskId: string): Promise<string> {
  const realDir = resolve(repo, "team/tasks", `${taskId}-real`);
  await mkdir(realDir, { recursive: true, mode: 0o755 });
  const linkDir = resolve(repo, "team/tasks", taskId);
  await symlink(realDir, linkDir);
  return linkDir;
}

export async function createSymlinkedParent(repo: string, taskId: string): Promise<string> {
  const realParent = resolve(repo, "team/real-tasks");
  await mkdir(realParent, { recursive: true, mode: 0o755 });
  const linkParent = resolve(repo, "team/tasks");
  await symlink(realParent, linkParent);
  const taskDir = resolve(linkParent, taskId);
  await mkdir(taskDir, { mode: 0o755 });
  return taskDir;
}
