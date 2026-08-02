import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rename, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  acquireAdvisoryLock,
  durableArchive,
  durableReplace,
  repositoryStatePaths,
  withAdvisoryLock,
} from "./durable-state.ts";
import { openDurableQueue, type DurableQueue } from "./queue.ts";
import { dispatchQueueOnce } from "./queue-dispatcher.ts";
import {
  acquireRepositoryExecutionLock,
  assertStrictCleanRepository,
  atomicRepositoryWrite,
  authorizeQueuedEntry,
  completeExactCommit,
  freezeReviewedTree,
  inspectEnrollmentAdmission,
  installExactCommit,
  QUEUED_EXECUTION_BLOCKER,
  realIndexDigest,
  reconcileJournaledExactCommit,
  revalidateQueuedHead,
  withRepositoryExecutionLock,
} from "./queue-repository.ts";
import { parseStatus } from "./core.ts";

const WORKER = fileURLToPath(new URL("./test/queue-worker.ts", import.meta.url));
const VALIDATOR = fileURLToPath(new URL("../../skills/init-three-agent-team/assets/validate_goal_contract.py", import.meta.url));
const A = "a".repeat(40);
const D1 = "1".repeat(64);
const D2 = "2".repeat(64);
function child(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveChild, reject) => {
    const workerProcess = spawn(process.execPath, [WORKER, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    workerProcess.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    workerProcess.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    workerProcess.once("error", reject);
    workerProcess.once("close", (code) => resolveChild({ code: code ?? 1, stdout, stderr }));
  });
}
async function baseFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "three-agent-queue-integration-"));
  await chmod(root, 0o700);
  const repo = resolve(root, "repo");
  const state = resolve(root, "state");
  await mkdir(repo, { mode: 0o700 });
  return { root, repo, state };
}
async function run(repo: string, ...args: string[]): Promise<string> {
  const result = await new Promise<{ code: number; out: string; err: string }>((done, reject) => {
    const commandProcess = spawn(args[0], args.slice(1), { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    commandProcess.stdout.on("data", (chunk) => { out += chunk.toString(); });
    commandProcess.stderr.on("data", (chunk) => { err += chunk.toString(); });
    commandProcess.once("error", reject);
    commandProcess.once("close", (code) => done({ code: code ?? 1, out, err }));
  });
  if (result.code !== 0) throw new Error(`${args.join(" ")} failed: ${result.err}`);
  return result.out.trim();
}

async function gitRepository() {
  const fixture = await baseFixture();
  await run(fixture.repo, "git", "init", "-q");
  await run(fixture.repo, "git", "config", "user.name", "Queue Test");
  await run(fixture.repo, "git", "config", "user.email", "queue@example.invalid");
  await writeFile(resolve(fixture.repo, "AGENTS.md"), "# Commands\n\n- Test: `python -m unittest`\n");
  await run(fixture.repo, "git", "add", "AGENTS.md");
  await run(fixture.repo, "git", "commit", "-qm", "chore: baseline");
  const baseline = await run(fixture.repo, "git", "rev-parse", "HEAD");
  const task = resolve(fixture.repo, "team/tasks/sample");
  await mkdir(task, { recursive: true });
  await writeFile(resolve(task, "brief.md"), `# Goal Contract: sample

## Goal
Verify queue admission.

## Current behavior
No durable queue entry exists.

## Agreed approach
Validate immutable committed inputs.

## Success tests
### ST-01: tests pass
- Command: \`python -m unittest\`
- Expected exit code: \`0\`
- Expected evidence: all tests pass
- Writes hardware/system state: \`no\`
- Prerequisites: \`none\`

## Non-goals
No deployment.

## Relevant files
Queue fixtures only.

## Architectural constraints
Fail closed on drift.

## Verification commands
1. \`python -m unittest\`

## Baseline commit
${baseline}

## Execution authority
- Repository edits: allowed
- Non-destructive development commands: allowed
- Routine technical decisions inside this contract: allowed
- Hardware/system writes: prohibited
- Allowed hardware/system operations: none
- Commit on success: true
- Push on success: false
- Deploy on success: false

## Open decisions
NONE

## Execution authorization
PENDING
`);
  await writeFile(resolve(task, "status.yaml"), `task_id: sample
state: DISCUSSING
baseline_commit: ${baseline}
authorization_head: null
contract_digest: null
execution_authorized_at: null
continue_until_complete: true
review_cycle: 0
max_review_cycles: 5
latest_build_report: null
latest_review: null
blocked_reason: null
verified_at: null
completed_at: null
completion_policy:
  commit_on_success: true
  push_on_success: false
  deploy_on_success: false
commit_sha: null
pushed_at: null
deployed_at: null
`);
  await run(fixture.repo, "git", "add", "team/tasks/sample");
  await run(fixture.repo, "git", "commit", "-qm", "chore: commit contract");
  const validator = resolve(fixture.root, "queue-validator.py");
  await writeFile(validator, `#!/usr/bin/env python3
import subprocess, sys
if "--phase" in sys.argv and sys.argv[sys.argv.index("--phase") + 1] == "execution":
    raise SystemExit(0)
raise SystemExit(subprocess.run(["python3", ${JSON.stringify(VALIDATOR)}, *sys.argv[1:]]).returncode)
`);
  await chmod(validator, 0o700);
  return { ...fixture, task, validator };
}

async function expectedEvidence(repo: string, taskId: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of ["status.yaml", "verification.log", "completion-report.md"]) {
    const path = resolve(repo, `team/tasks/${taskId}/${name}`);
    try { result[`team/tasks/${taskId}/${name}`] = createHash("sha256").update(await readFile(path)).digest("hex"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return result;
}

async function enrollSample(repo: string, state: string, validator: string): Promise<{ queue: DurableQueue; head: string }> {
  const approvedAt = "2026-01-01T00:00:00.000Z";
  const admission = await inspectEnrollmentAdmission(repo, "sample", approvedAt, validator, state);
  const queue = await openDurableQueue(repo, { stateRoot: state, leaseTtlMs: 5_000 });
  await queue.command({
    type: "enqueue",
    ...admission.enqueue,
    dependsOn: [],
    ownerPrincipal: "uid:test",
  });
  return { queue, head: admission.head };
}

const dispatchTiming = {
  leaseTtlSeconds: 5,
  heartbeatIntervalSeconds: 1,
  executionLockTimeoutSeconds: 2,
  localExpiryMarginSeconds: 1,
};

test("multi-process enqueue has no lost updates and duplicate replay has one effect", async () => {
  const { repo, state } = await baseFixture();
  const batches = Array.from({ length: 6 }, (_, worker) => Array.from({ length: 6 }, (_, item) => `t${worker}${item}`));
  const results = await Promise.all(batches.map((batch) => child(["enqueue", repo, state, ...batch])));
  assert.ok(results.every((result) => result.code === 0), results.map((result) => result.stderr).join("\n"));
  const duplicates = await Promise.all(Array.from({ length: 5 }, () => child(["duplicate", repo, state, "same-task"])));
  assert.ok(duplicates.every((result) => result.code === 0), duplicates.map((result) => result.stderr).join("\n"));
  const snapshot = await (await openDurableQueue(repo, { stateRoot: state })).snapshot();
  assert.equal(snapshot.entries.length, 37);
  assert.equal(snapshot.revision, 37);
  assert.equal(new Set(snapshot.entries.map((entry) => entry.sequence)).size, 37);
  assert.equal(snapshot.entries.filter((entry) => entry.taskId === "same-task").length, 1);
});

test("real flock excludes a live process and kernel releases it after holder death", async () => {
  const { repo, state } = await baseFixture();
  const paths = await repositoryStatePaths(repo, state);
  const holder = spawn(process.execPath, [WORKER, "hold-lock", repo, state, paths.queueTransactionLock], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise<void>((ready, reject) => {
    holder.stdout.once("data", (chunk) => chunk.toString().startsWith("locked") ? ready() : reject(new Error("holder did not lock")));
    holder.once("error", reject);
  });
  await assert.rejects(acquireAdvisoryLock(paths.queueTransactionLock, "contender", { timeoutMs: 100 }), /timed out.*current owner/i);
  holder.kill("SIGTERM");
  await new Promise((done) => holder.once("close", done));
  const acquired = await acquireAdvisoryLock(paths.queueTransactionLock, "post-crash contender", { timeoutMs: 2_000 });
  await acquired.release();
});

test("unexpected broker death is detected and does not leave a false held capability", async () => {
  const { repo, state } = await baseFixture();
  const paths = await repositoryStatePaths(repo, state);
  const holder = spawn(process.execPath, [WORKER, "hold-lock", repo, state, paths.queueTransactionLock], { stdio: ["ignore", "pipe", "pipe"] });
  const first = await new Promise<string>((ready, reject) => {
    holder.stdout.once("data", (chunk) => ready(chunk.toString().trim()));
    holder.once("error", reject);
  });
  const brokerPid = Number(/^locked (\d+)$/.exec(first)?.[1]);
  assert.ok(Number.isInteger(brokerPid) && brokerPid > 1);
  const remainderPromise = new Promise<string>((done, reject) => {
    let output = "";
    holder.stdout.on("data", (chunk) => { output += chunk.toString(); });
    holder.once("error", reject);
    holder.once("close", () => done(output));
  });
  process.kill(brokerPid, "SIGTERM");
  const remainder = await remainderPromise;
  assert.match(remainder, /lost .*broker exited unexpectedly/i);
  const acquired = await acquireAdvisoryLock(paths.queueTransactionLock, "after broker death", { timeoutMs: 2_000 });
  await acquired.release();
});

test("deferred HEAD, worktree, and brief drift fail dispatch-time revalidation", async () => {
  const { repo, task, state } = await gitRepository();
  const approvedAt = "2026-01-01T00:00:00.000Z";
  const admission = await inspectEnrollmentAdmission(repo, "sample", approvedAt, VALIDATOR, state);
  const entry: any = {
    taskId: "sample", sequence: 1, state: "QUEUED", dependsOn: [], baselineCommit: admission.status.baselineCommit,
    expectedHead: admission.head, approvedBriefDigest: admission.approvedBriefDigest, contractDigest: admission.contractDigest, ownerPrincipal: "owner",
    approvedAt, approvalSource: "/team-enqueue", completionPolicy: { commitOnSuccess: true, pushOnSuccess: false, deployOnSuccess: false },
    authorizationHead: null, completionCommit: null, attempts: [], recoveryApproval: null,
  };
  await writeFile(resolve(repo, "unrelated.txt"), "dirty\n");
  await assert.rejects(revalidateQueuedHead(repo, entry, admission.head, VALIDATOR, state), /completely clean/);
  await run(repo, "git", "add", "unrelated.txt");
  await run(repo, "git", "commit", "-qm", "chore: move head");
  await assert.rejects(revalidateQueuedHead(repo, entry, admission.head, VALIDATOR, state), /snapshot drift/);
  await writeFile(resolve(task, "brief.md"), `${await readFile(resolve(task, "brief.md"), "utf8")}\nmutated\n`);
  await assert.rejects(revalidateQueuedHead(repo, entry, admission.head, VALIDATOR, state), /completely clean|snapshot drift/);
});

test("deferred entry binds the advanced exact queue head when approved task bytes remain unchanged", async () => {
  const { repo, state } = await gitRepository();
  const approvedAt = "2026-01-01T00:00:00.000Z";
  const admission = await inspectEnrollmentAdmission(repo, "sample", approvedAt, VALIDATOR, state);
  const entry: any = {
    taskId: "sample", sequence: 1, state: "QUEUED", dependsOn: [], baselineCommit: admission.status.baselineCommit,
    expectedHead: admission.head, approvedBriefDigest: admission.approvedBriefDigest, contractDigest: admission.contractDigest,
    ownerPrincipal: "owner", approvedAt, approvalSource: "/team-enqueue",
    completionPolicy: { commitOnSuccess: true, pushOnSuccess: false, deployOnSuccess: false },
    authorizationHead: null, completionCommit: null, attempts: [], recoveryApproval: null,
  };
  await writeFile(resolve(repo, "prior-completion.txt"), "exact prior queue result\n");
  await run(repo, "git", "add", "prior-completion.txt");
  await run(repo, "git", "commit", "-qm", "feat: complete prior queued task");
  const advancedHead = await run(repo, "git", "rev-parse", "HEAD");
  const rebound = await revalidateQueuedHead(repo, entry, advancedHead, VALIDATOR, state);
  assert.equal(rebound.head, advancedHead);
  assert.notEqual(rebound.head, entry.expectedHead);
  assert.equal(rebound.approvedBriefDigest, entry.approvedBriefDigest);
});

test("hard-crashed RUNNING reconciliation is BLOCKED and never blindly requeued", async () => {
  const { repo, state } = await baseFixture();
  const queue = await openDurableQueue(repo, { stateRoot: state, leaseTtlMs: 1_000 });
  await queue.command({
    type: "enqueue", taskId: "first", dependsOn: [], baselineCommit: A, expectedHead: A,
    approvedBriefDigest: D1, contractDigest: D2, ownerPrincipal: "owner", approvedAt: "2026-01-01T00:00:00.000Z",
    completionPolicy: { commitOnSuccess: true, pushOnSuccess: false, deployOnSuccess: false },
  });
  const crashed = spawn(process.execPath, [WORKER, "claim-hold", repo, state], { stdio: ["ignore", "pipe", "pipe"] });
  const claimLine = await new Promise<string>((ready, reject) => {
    crashed.stdout.once("data", (chunk) => ready(chunk.toString().trim()));
    crashed.once("error", reject);
  });
  const attemptId = /^claimed (\S+) /.exec(claimLine)?.[1];
  assert.ok(attemptId && attemptId !== "none");
  crashed.kill("SIGTERM");
  await new Promise((done) => crashed.once("close", done));
  await new Promise((done) => setTimeout(done, 1_100));
  await queue.withDispatcher(async (session) => {
    await session.block("first", attemptId!, "crash reconciliation: execution outcome uncertain");
  }, { leaseTtlMs: 1_000 });
  const snapshot = await queue.snapshot();
  assert.equal(snapshot.entries[0].state, "BLOCKED");
  assert.equal(snapshot.entries[0].attempts.length, 1);
  assert.equal(snapshot.entries[0].attempts[0].events.at(-1)?.phase, "BLOCKED");
});

test("repository path and task symlink attacks fail admission", async () => {
  const { repo, task, state } = await gitRepository();
  const outside = resolve(dirname(repo), "outside-brief");
  await writeFile(outside, await readFile(resolve(task, "brief.md")));
  // A symlink changes the committed worktree and must fail before validator use.
  await run(repo, "git", "rm", "-q", "team/tasks/sample/brief.md");
  await symlink(outside, resolve(task, "brief.md"));
  await assert.rejects(inspectEnrollmentAdmission(repo, "sample", "2026-01-01T00:00:00.000Z", VALIDATOR, state), /clean|symlink/i);
});

test("extension-owned atomic writes reject symlinked parent directories", async () => {
  const { repo, state, root } = await baseFixture();
  const outside = resolve(root, "outside");
  await mkdir(outside);
  const redirectedParent = resolve(repo, "redirected");
  await symlink(outside, redirectedParent, "dir");
  const lock = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    await assert.rejects(atomicRepositoryWrite(resolve(redirectedParent, "evidence.md"), "must not escape\n", lock), /symlinked parent directory/);
    await assert.rejects(access(resolve(outside, "evidence.md")), /ENOENT/);
  } finally {
    await lock.release();
  }
});

test("dispatch authorizes clean input directly to repository BLOCKED and queue BLOCKED", async () => {
  const { repo, state, task, validator } = await gitRepository();
  const { queue } = await enrollSample(repo, state, validator);
  const result = await dispatchQueueOnce(repo, {
    queue,
    stateRoot: state,
    validatorPath: validator,
    timing: dispatchTiming,
  });
  assert.equal(result.kind, "blocked");
  assert.equal(result.reason, QUEUED_EXECUTION_BLOCKER);
  const snapshot = await queue.snapshot();
  const entry = snapshot.entries[0];
  assert.equal(entry.state, "BLOCKED");
  assert.deepEqual(entry.attempts[0].events.map((event) => event.phase), ["CLAIMED", "AUTHORIZING", "AUTHORIZED", "BLOCKED"]);
  assert.ok(!entry.attempts[0].events.some((event) => event.phase === "EXECUTING"));
  const statusText = await readFile(resolve(task, "status.yaml"), "utf8");
  assert.equal(parseStatus(statusText).state, "BLOCKED");
  assert.match(statusText, new RegExp(`^blocked_reason: ${JSON.stringify(QUEUED_EXECUTION_BLOCKER).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
});

test("authorizeQueuedEntry uses the held repository capability and never writes EXECUTING", async () => {
  const { repo, state, task, validator } = await gitRepository();
  const { queue } = await enrollSample(repo, state, validator);
  await queue.withDispatcher(async (session) => {
    const lock = await acquireRepositoryExecutionLock(repo, 2_000, state);
    try {
      const claimed = await session.claimNext();
      assert.ok(claimed);
      await authorizeQueuedEntry(repo, claimed!.entry, claimed!.attempt.attemptId, session, lock, state, validator);
      const repositoryStatus = parseStatus(await readFile(resolve(task, "status.yaml"), "utf8"));
      assert.equal(repositoryStatus.state, "BLOCKED");
      await session.block(claimed!.entry.taskId, claimed!.attempt.attemptId, QUEUED_EXECUTION_BLOCKER);
    } finally {
      await lock.release();
    }
  }, { leaseTtlMs: 5_000 });
  assert.equal((await queue.snapshot()).entries[0].state, "BLOCKED");
});

test("dispatch fails closed on deferred worktree and HEAD drift", async (t) => {
  await t.test("worktree drift", async () => {
    const { repo, state, validator } = await gitRepository();
    const { queue } = await enrollSample(repo, state, validator);
    await writeFile(resolve(repo, "unrelated.txt"), "dirty\n");
    await assert.rejects(dispatchQueueOnce(repo, { queue, stateRoot: state, validatorPath: validator, timing: dispatchTiming }), /completely clean/);
    assert.equal((await queue.snapshot()).entries[0].state, "QUEUED");
  });
  await t.test("HEAD drift", async () => {
    const { repo, state, validator } = await gitRepository();
    const { queue } = await enrollSample(repo, state, validator);
    await writeFile(resolve(repo, "unrelated.txt"), "committed drift\n");
    await run(repo, "git", "add", "unrelated.txt");
    await run(repo, "git", "commit", "-qm", "chore: drift head");
    await assert.rejects(dispatchQueueOnce(repo, { queue, stateRoot: state, validatorPath: validator, timing: dispatchTiming }), /snapshot drift/);
    assert.equal((await queue.snapshot()).entries[0].state, "QUEUED");
  });
});

test("broker death cooperatively aborts a callback before its durable side effect", async () => {
  const { repo, state } = await baseFixture();
  const paths = await repositoryStatePaths(repo, state);
  const target = resolve(state, "must-not-exist.json");
  await assert.rejects(
    withAdvisoryLock(paths.queueTransactionLock, "abort callback test", async (lock) => {
      process.kill(lock.brokerPid, "SIGTERM");
      await new Promise<void>((done) => lock.signal.addEventListener("abort", () => done(), { once: true }));
      await durableReplace(target, "{}\n", lock);
    }),
    /broker exited unexpectedly|capability/i,
  );
  await assert.rejects(access(target), /ENOENT/);
});

test("lease safety deadline aborts execution-lock wait before repository effects", async () => {
  const { repo, state, task, validator } = await gitRepository();
  const { queue } = await enrollSample(repo, state, validator);
  const holder = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    await assert.rejects(dispatchQueueOnce(repo, {
      queue,
      stateRoot: state,
      validatorPath: validator,
      timing: {
        leaseTtlSeconds: 1,
        heartbeatIntervalSeconds: 10,
        executionLockTimeoutSeconds: 3,
        localExpiryMarginSeconds: 0.2,
      },
    }), /timed out|aborted/i);
    assert.equal((await queue.snapshot()).entries[0].state, "QUEUED");
    assert.equal(parseStatus(await readFile(resolve(task, "status.yaml"), "utf8")).state, "DISCUSSING");
  } finally {
    await holder.release();
  }
});

test("discard and arbitrary tool mutations serialize on the repository execution lock", async () => {
  const { repo, state } = await baseFixture();
  const source = resolve(repo, "task-artifact");
  const destination = resolve(repo, "task-artifact.discarded");
  await writeFile(source, "preserve me\n");
  const holder = await acquireRepositoryExecutionLock(repo, 2_000, state);
  let entered = false;
  const contender = withRepositoryExecutionLock(repo, "discard/custom-tool test", async (lock) => {
    entered = true;
    lock.assertHeld();
    await rename(source, destination);
    lock.assertHeld();
  }, { timeoutMs: 2_000, stateRoot: state });
  await new Promise((done) => setTimeout(done, 100));
  assert.equal(entered, false);
  assert.equal(await readFile(source, "utf8"), "preserve me\n");
  await holder.release();
  await contender;
  assert.equal(await readFile(destination, "utf8"), "preserve me\n");
});

test("production executor journals exact phases and installs only the reviewed tree plus named evidence", async () => {
  const { repo, state, task, validator } = await gitRepository();
  const { queue, head } = await enrollSample(repo, state, validator);
  const result = await dispatchQueueOnce(repo, {
    queue,
    stateRoot: state,
    validatorPath: validator,
    timing: dispatchTiming,
    executor: async (execution) => {
      assert.equal(execution.expectedParent, head);
      await writeFile(resolve(repo, "implementation.txt"), "reviewed implementation\n");
      const reviewedTree = await freezeReviewedTree(repo, execution.expectedParent, execution.capability);
      await execution.markVerified(JSON.stringify({ reviewedTree }));
      await atomicRepositoryWrite(resolve(task, "completion-report.md"), "verified evidence\n", execution.capability);
      const exact = await completeExactCommit(repo, execution.taskId, execution.expectedParent, reviewedTree, await expectedEvidence(repo, execution.taskId), execution.capability);
      await execution.markCommitting(JSON.stringify(exact));
      await installExactCommit(repo, exact, execution.capability);
      await execution.complete(exact.commitSha);
    },
  });
  assert.equal(result.kind, "completed");
  const entry = (await queue.snapshot()).entries[0];
  assert.equal(entry.state, "COMPLETED");
  assert.deepEqual(entry.attempts[0].events.map((event) => event.phase), [
    "CLAIMED", "AUTHORIZING", "AUTHORIZED", "EXECUTING", "VERIFIED", "COMMITTING", "COMPLETED",
  ]);
  assert.equal(await run(repo, "git", "rev-parse", "HEAD"), entry.completionCommit);
  assert.equal(await run(repo, "git", "status", "--porcelain=v2", "--untracked-files=all"), "");
  assert.equal(await readFile(resolve(repo, "implementation.txt"), "utf8"), "reviewed implementation\n");
});

test("stale COMMITTING journal accepts an exact completion parent descended from queue authorization", async () => {
  const { repo, state, task, validator } = await gitRepository();
  const { queue } = await enrollSample(repo, state, validator);
  let completion = "";
  await queue.withDispatcher(async (session) => {
    const lock = await acquireRepositoryExecutionLock(repo, 2_000, state);
    try {
      const claimed = await session.claimNext();
      assert.ok(claimed);
      await authorizeQueuedEntry(repo, claimed!.entry, claimed!.attempt.attemptId, session, lock, state, validator);
      await session.advance("sample", claimed!.attempt.attemptId, "EXECUTING");
      await writeFile(resolve(repo, "implementation.txt"), "journaled implementation\n");
      await run(repo, "git", "add", "implementation.txt");
      await run(repo, "git", "commit", "-qm", "builder forward commit");
      const forwardParent = await run(repo, "git", "rev-parse", "HEAD");
      assert.notEqual(forwardParent, claimed!.entry.authorizationHead);
      const reviewedTree = await freezeReviewedTree(repo, forwardParent, lock);
      await session.advance("sample", claimed!.attempt.attemptId, "VERIFIED", JSON.stringify({ reviewedTree }));
      await atomicRepositoryWrite(resolve(task, "completion-report.md"), "journaled evidence\n", lock);
      const exact = await completeExactCommit(repo, "sample", forwardParent, reviewedTree, await expectedEvidence(repo, "sample"), lock);
      completion = exact.commitSha;
      await session.advance("sample", claimed!.attempt.attemptId, "COMMITTING", JSON.stringify({
        tree: exact.treeSha, parent: exact.parent, subject: exact.subject, commit: exact.commitSha,
      }));
      await installExactCommit(repo, exact, lock);
      // Simulated crash: HEAD is installed but queue COMPLETED is not written.
    } finally {
      await lock.release();
    }
  });
  assert.equal((await queue.snapshot()).entries[0].state, "RUNNING");
  const result = await dispatchQueueOnce(repo, { queue, stateRoot: state, validatorPath: validator, timing: dispatchTiming });
  assert.equal(result.kind, "completed");
  assert.equal((await queue.snapshot()).entries[0].completionCommit, completion);
  assert.equal(await run(repo, "git", "rev-parse", "HEAD"), completion);
});

test("installExactCommit accepts unchanged index via indexDigest short-circuit", async () => {
  const fixture = await baseFixture();
  const { repo, state } = fixture;
  await run(repo, "git", "init", "-q");
  await run(repo, "git", "config", "user.name", "Test");
  await run(repo, "git", "config", "user.email", "test@test");
  await writeFile(resolve(repo, "README.md"), "# Test\n");
  await run(repo, "git", "add", "README.md");
  await run(repo, "git", "commit", "-qm", "initial");
  const lock = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    await writeFile(resolve(repo, "implementation.txt"), "test impl\n");
    const parent = await run(repo, "git", "rev-parse", "HEAD");
    const reviewedTree = await freezeReviewedTree(repo, parent, lock);
    const exact = await completeExactCommit(repo, "task1", parent, reviewedTree, {}, lock);
    // Reset to parent so installExactCommit takes the HEAD === parent path
    await run(repo, "git", "update-ref", "HEAD", exact.parent);
    // Index is unchanged from when completeExactCommit journaled it
    await installExactCommit(repo, exact, lock);
    assert.equal(await run(repo, "git", "rev-parse", "HEAD"), exact.commitSha);
  } finally { await lock.release(); }
});

test("installExactCommit accepts intent-to-add index via indexDigest short-circuit", async () => {
  const { repo, state } = await baseFixture();
  await run(repo, "git", "init", "-q");
  await run(repo, "git", "config", "user.name", "Test");
  await run(repo, "git", "config", "user.email", "test@test");
  await writeFile(resolve(repo, "README.md"), "# Test\n");
  await run(repo, "git", "add", "README.md");
  await run(repo, "git", "commit", "-qm", "initial");
  const lock = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    // Create a commit that includes an intent-to-add file in its tree.
    const parent = await run(repo, "git", "rev-parse", "HEAD");
    const newFile = resolve(repo, "intent-add.txt");
    await writeFile(newFile, "intent content\n");
    await run(repo, "git", "add", "intent-add.txt");
    const idxDigest = await realIndexDigest(repo);
    const tree = await run(repo, "git", "write-tree");
    const subject = "feat: complete task1";
    const commitSha = await run(repo, "git", "commit-tree", tree, "-p", parent, "-m", subject);
    const exact = { commitSha, treeSha: tree, parent, subject, indexDigest: idxDigest };
    // Reset HEAD to parent to take the installExactCommit path
    await run(repo, "git", "update-ref", "HEAD", parent);
    // Restore the intent-to-add index (HEAD reset cleared it)
    await run(repo, "git", "add", "intent-add.txt");
    await installExactCommit(repo, exact, lock);
    assert.equal(await run(repo, "git", "rev-parse", "HEAD"), commitSha);
  } finally { await lock.release(); }
});

test("installExactCommit rejects divergent index", async () => {
  const { repo, state } = await baseFixture();
  await run(repo, "git", "init", "-q");
  await run(repo, "git", "config", "user.name", "Test");
  await run(repo, "git", "config", "user.email", "test@test");
  await writeFile(resolve(repo, "README.md"), "# Test\n");
  await run(repo, "git", "add", "README.md");
  await run(repo, "git", "commit", "-qm", "initial");
  const lock = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    await writeFile(resolve(repo, "implementation.txt"), "test impl\n");
    const parent = await run(repo, "git", "rev-parse", "HEAD");
    const reviewedTree = await freezeReviewedTree(repo, parent, lock);
    const exact = await completeExactCommit(repo, "task1", parent, reviewedTree, {}, lock);
    await run(repo, "git", "update-ref", "HEAD", exact.parent);
    await run(repo, "git", "read-tree", "--reset", exact.parent); // clean index to parent
    // Stage a divergent blob without touching worktree
    await writeFile(resolve(repo, ".divergent"), "divergent\n");
    const divergentBlob = await run(repo, "git", "hash-object", "-w", ".divergent");
    await run(repo, "git", "update-index", "--cacheinfo", "100644", divergentBlob, "README.md");
    await unlink(resolve(repo, ".divergent"));
    await assert.rejects(
      installExactCommit(repo, exact, lock),
      /Index has uncommitted changes/,
    );
  } finally { await lock.release(); }
});

test("reconcileJournaledExactCommit accepts post-reset index", async () => {
  const { repo, state } = await baseFixture();
  await run(repo, "git", "init", "-q");
  await run(repo, "git", "config", "user.name", "Test");
  await run(repo, "git", "config", "user.email", "test@test");
  await writeFile(resolve(repo, "README.md"), "# Test\n");
  await run(repo, "git", "add", "README.md");
  await run(repo, "git", "commit", "-qm", "initial");
  const lock = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    await writeFile(resolve(repo, "implementation.txt"), "test impl\n");
    const reviewedTree = await freezeReviewedTree(repo, (await run(repo, "git", "rev-parse", "HEAD")), lock);
    const exact = await completeExactCommit(repo, "task1", (await run(repo, "git", "rev-parse", "HEAD")), reviewedTree, {}, lock);
    // Simulate crash after update-ref but before read-tree: HEAD = commit, index = parent tree
    await run(repo, "git", "update-ref", "HEAD", exact.commitSha, exact.parent);
    await run(repo, "git", "read-tree", exact.parent); // restore index to parent tree
    // Now recover via the HEAD === exact.commitSha path
    const detail = JSON.stringify({ tree: exact.treeSha, parent: exact.parent, subject: exact.subject, commit: exact.commitSha, indexDigest: exact.indexDigest });
    const recovered = await reconcileJournaledExactCommit(
      repo, detail, exact.parent, lock,
    );
    assert.equal(recovered.commitSha, exact.commitSha);
    assert.equal(await assertStrictCleanRepository(repo), exact.commitSha);
  } finally { await lock.release(); }
});

test("reconcileJournaledExactCommit with divergent intent-to-add index rejects", async () => {
  const { repo, state } = await baseFixture();
  await run(repo, "git", "init", "-q");
  await run(repo, "git", "config", "user.name", "Test");
  await run(repo, "git", "config", "user.email", "test@test");
  await writeFile(resolve(repo, "README.md"), "# Test\n");
  await run(repo, "git", "add", "README.md");
  await run(repo, "git", "commit", "-qm", "initial");
  const lock = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    await writeFile(resolve(repo, "implementation.txt"), "test impl\n");
    const parent = await run(repo, "git", "rev-parse", "HEAD");
    const reviewedTree = await freezeReviewedTree(repo, parent, lock);
    const exact = await completeExactCommit(repo, "task1", parent, reviewedTree, {}, lock);
    // Advance HEAD to commit
    await run(repo, "git", "update-ref", "HEAD", exact.commitSha, exact.parent);
    // Stage a divergent index entry via cacheinfo (no worktree change)
    await writeFile(resolve(repo, ".divergent"), "divergent\n");
    const divergentBlob = await run(repo, "git", "hash-object", "-w", ".divergent");
    await run(repo, "git", "update-index", "--cacheinfo", "100644", divergentBlob, "README.md");
    await unlink(resolve(repo, ".divergent"));
    // indexDigest no longer matches → falls through to write-tree → rejects
    const detail = JSON.stringify({ tree: exact.treeSha, parent: exact.parent, subject: exact.subject, commit: exact.commitSha, indexDigest: exact.indexDigest });
    await assert.rejects(
      reconcileJournaledExactCommit(
        repo, detail, exact.parent, lock,
      ),
      /Index has uncommitted changes/,
    );
  } finally { await lock.release(); }
});

test("matching owner recovery appends a fenced attempt and resumes exact authorized execution", async () => {
  const { repo, state, task, validator } = await gitRepository();
  const { queue } = await enrollSample(repo, state, validator);
  await dispatchQueueOnce(repo, { queue, stateRoot: state, validatorPath: validator, timing: dispatchTiming });
  const blocked = await queue.snapshot();
  const failed = blocked.entries[0].attempts[0];
  await queue.command({
    type: "recover",
    taskId: "sample",
    failedAttemptId: failed.attemptId,
    approvedBy: "uid:test",
    approvedAt: "2026-01-02T00:00:00.000Z",
    expectedRevision: blocked.revision,
  });
  const result = await dispatchQueueOnce(repo, {
    queue,
    stateRoot: state,
    validatorPath: validator,
    timing: dispatchTiming,
    executor: async (execution) => {
      await writeFile(resolve(repo, "implementation.txt"), "recovered implementation\n");
      const reviewedTree = await freezeReviewedTree(repo, execution.expectedParent, execution.capability);
      await execution.markVerified(JSON.stringify({ reviewedTree }));
      await atomicRepositoryWrite(resolve(task, "completion-report.md"), "recovered evidence\n", execution.capability);
      const exact = await completeExactCommit(repo, execution.taskId, execution.expectedParent, reviewedTree, await expectedEvidence(repo, execution.taskId), execution.capability);
      await execution.markCommitting(JSON.stringify(exact));
      await installExactCommit(repo, exact, execution.capability);
      await execution.complete(exact.commitSha);
    },
  });
  assert.equal(result.kind, "completed");
  const entry = (await queue.snapshot()).entries[0];
  assert.equal(entry.state, "COMPLETED");
  assert.equal(entry.attempts.length, 2);
  assert.equal(entry.attempts[1].kind, "RECOVERY");
  assert.deepEqual(entry.attempts[1].events.map((event) => event.phase), [
    "CLAIMED", "AUTHORIZING", "AUTHORIZED", "EXECUTING", "VERIFIED", "COMMITTING", "COMPLETED",
  ]);
});

test("/team-continue auto-recovers an unapproved BLOCKED entry", async () => {
  const { repo, state, task, validator } = await gitRepository();
  const { queue } = await enrollSample(repo, state, validator);
  // Dispatch once to get the task into BLOCKED state (no executor → blocks)
  const first = await dispatchQueueOnce(repo, { queue, stateRoot: state, validatorPath: validator, timing: dispatchTiming });
  assert.equal(first.kind, "blocked");
  assert.equal((await queue.snapshot()).entries[0].state, "BLOCKED");
  assert.equal((await queue.snapshot()).entries[0].recoveryApproval, null);
  // /team-continue without prior /team-unblock — should auto-recover and complete
  const result = await dispatchQueueOnce(repo, {
    queue,
    stateRoot: state,
    validatorPath: validator,
    timing: dispatchTiming,
    executor: async (execution) => {
      await writeFile(resolve(repo, "implementation.txt"), "auto-recovered\n");
      const reviewedTree = await freezeReviewedTree(repo, execution.expectedParent, execution.capability);
      await execution.markVerified(JSON.stringify({ reviewedTree }));
      await atomicRepositoryWrite(resolve(task, "completion-report.md"), "auto-recovered evidence\n", execution.capability);
      const exact = await completeExactCommit(repo, execution.taskId, execution.expectedParent, reviewedTree, await expectedEvidence(repo, execution.taskId), execution.capability);
      await execution.markCommitting(JSON.stringify({ tree: exact.treeSha, parent: exact.parent, subject: exact.subject, commit: exact.commitSha, indexDigest: exact.indexDigest }));
      await installExactCommit(repo, exact, execution.capability);
      await execution.complete(exact.commitSha);
    },
  });
  assert.equal(result.kind, "completed");
  const entry = (await queue.snapshot()).entries[0];
  assert.equal(entry.state, "COMPLETED");
  assert.equal(entry.attempts.length, 2);
  assert.equal(entry.attempts[1].kind, "RECOVERY");
  assert.deepEqual(entry.attempts[1].events.map((event: any) => event.phase), [
    "CLAIMED", "AUTHORIZING", "AUTHORIZED", "EXECUTING", "VERIFIED", "COMMITTING", "COMPLETED",
  ]);
});

test("owner recovery refuses a recorded role process that is still live", async () => {
  const { repo, state } = await baseFixture();
  const queue = await openDurableQueue(repo, { stateRoot: state, leaseTtlMs: 5_000 });
  await queue.command({
    type: "enqueue", taskId: "live", dependsOn: [], baselineCommit: A, expectedHead: A,
    approvedBriefDigest: D1, contractDigest: D2, ownerPrincipal: "uid:test", approvedAt: "2026-01-01T00:00:00.000Z",
    completionPolicy: { commitOnSuccess: true, pushOnSuccess: false, deployOnSuccess: false },
  });
  let failedAttemptId = "";
  await queue.withDispatcher(async (session) => {
    const claimed = await session.claimNext();
    assert.ok(claimed);
    failedAttemptId = claimed!.attempt.attemptId;
    await session.advance("live", failedAttemptId, "AUTHORIZING");
    await session.advance("live", failedAttemptId, "AUTHORIZED");
    await session.advance("live", failedAttemptId, "EXECUTING");
    const pgid = Number(await run(repo, "ps", "-o", "pgid=", "-p", String(process.pid)));
    assert.ok(Number.isSafeInteger(pgid) && pgid > 1);
    await session.recordProcess("live", failedAttemptId, { role: "builder", pid: process.pid, pgid, processStart: `test:${process.pid}` });
    await session.block("live", failedAttemptId, "uncertain child");
  });
  const blocked = await queue.snapshot();
  await queue.command({
    type: "recover", taskId: "live", failedAttemptId, approvedBy: "uid:test",
    approvedAt: "2026-01-02T00:00:00.000Z", expectedRevision: blocked.revision,
  });
  await assert.rejects(
    dispatchQueueOnce(repo, { queue, stateRoot: state, timing: dispatchTiming }),
    /recorded builder process group .* is still live/,
  );
  assert.equal((await queue.snapshot()).entries[0].attempts.length, 1);
});

test("exact completion rejects post-review contamination and never overwrites worktree drift", async () => {
  const { repo, state, validator } = await gitRepository();
  const { head } = await enrollSample(repo, state, validator);
  const lock = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    await writeFile(resolve(repo, "implementation.txt"), "reviewed\n");
    const reviewedTree = await freezeReviewedTree(repo, head, lock);
    const unrelated = resolve(repo, "unrelated.txt");
    await writeFile(unrelated, "not reviewed\n");
    await assert.rejects(completeExactCommit(repo, "sample", head, reviewedTree, await expectedEvidence(repo, "sample"), lock), /not named completion evidence/);
    await run(repo, "git", "add", "unrelated.txt");
    await unlink(unrelated);
    await assert.rejects(completeExactCommit(repo, "sample", head, reviewedTree, await expectedEvidence(repo, "sample"), lock), /index changed after Reviewer approval/);
    await run(repo, "git", "read-tree", "--reset", head);
    const reportPath = resolve(repo, "team/tasks/sample/completion-report.md");
    await writeFile(reportPath, "allowed evidence\n");
    const expected = await expectedEvidence(repo, "sample");
    await writeFile(reportPath, "non-cooperative allowed-path contamination\n");
    await assert.rejects(completeExactCommit(repo, "sample", head, reviewedTree, expected, lock), /content does not match extension-owned bytes/);
    await writeFile(reportPath, "allowed evidence\n");
    const exact = await completeExactCommit(repo, "sample", head, reviewedTree, expected, lock);
    await writeFile(resolve(repo, "implementation.txt"), "drift after journal\n");
    await assert.rejects(installExactCommit(repo, exact, lock), /Worktree changed/);
    assert.equal(await readFile(resolve(repo, "implementation.txt"), "utf8"), "drift after journal\n");
    assert.equal(await run(repo, "git", "rev-parse", "HEAD"), head);
  } finally {
    await lock.release();
  }
});

test("durableArchive claims destinations without replacement and fsyncs the move", async () => {
  const { repo, state } = await baseFixture();
  const paths = await repositoryStatePaths(repo, state);
  const source = resolve(state, "archive-source.json");
  const occupied = resolve(state, "archive-occupied.json");
  const destination = resolve(state, "archive-destination.json");
  await writeFile(source, "source\n", { mode: 0o600 });
  await writeFile(occupied, "occupied\n", { mode: 0o600 });
  const lock = await acquireAdvisoryLock(paths.queueTransactionLock, "archive test");
  try {
    await assert.rejects(durableArchive(source, occupied, lock), /already exists/);
    assert.equal(await readFile(source, "utf8"), "source\n");
    assert.equal(await readFile(occupied, "utf8"), "occupied\n");
    await durableArchive(source, destination, lock);
    assert.equal(await readFile(destination, "utf8"), "source\n");
    await assert.rejects(stat(source), /ENOENT/);
  } finally {
    await lock.release();
  }
});
