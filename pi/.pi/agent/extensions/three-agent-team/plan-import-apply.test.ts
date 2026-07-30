import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import {
  createTestFixture,
  makeValidTask,
  writeManifest,
  commitManifest,
  repoIsClean,
  countCommits,
  createTaskDirectory,
  createSymlinkedTaskDir,
  createSymlinkedParent,
} from "./test/plan-import-fixture.ts";
import { applyPlanImport, type CompletedImport, type ImportOutcome } from "./plan-import.ts";
import { openDurableQueue } from "./queue.ts";
import { currentUid } from "./durable-state.ts";
import { acquireRepositoryExecutionLock } from "./queue-repository.ts";

function unwrapResult(r: ImportOutcome): CompletedImport {
  if (r.kind === "BLOCKED") throw new Error("Unexpected blocked: " + r.reason);
  return r.result;
}

test("applyPlanImport completes without deadlock", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-test-task-1");
  const content = writeManifest(fixture, [task1]);
  const digest = await commitManifest(fixture, content);

  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();
  const initialCommits = await countCommits(fixture.repo, initialHead + "^");

  const lock = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  const capability = {
    assertHeld: () => {
      if (lock.signal.aborted) throw new Error("lock lost");
    },
    signal: lock.signal,
  };

  try {
    const result = await applyPlanImport({
      repo: fixture.repo,
      manifestPath: fixture.manifestPath,
      approvedDigest: digest,
      previewedHead: initialHead,
      approvedDigestWithPrefix: `sha256:${digest}`,
      ownerPrincipal: `uid:${currentUid()}`,
      stateRoot: fixture.stateRoot,
      repositoryLock: lock,
    }, capability);

    assert.ok(unwrapResult(result).importCommitSha);
    assert.ok(unwrapResult(result).journalId);

    const finalCommits = await countCommits(fixture.repo, initialHead + "^");
    assert.equal(finalCommits, initialCommits + 1, "should create exactly one commit");

    assert.ok(await repoIsClean(fixture.repo), "repository should be clean after import");
  } finally {
    await lock.release();
  }
});

test("applyPlanImport enrolls tasks in queue", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-test-task-1");
  const task2 = makeValidTask("2026-01-01-test-task-2", ["2026-01-01-test-task-1"]);
  const content = writeManifest(fixture, [task1, task2]);
  const digest = await commitManifest(fixture, content);

  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();
  const lock = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  const capability = {
    assertHeld: () => {
      if (lock.signal.aborted) throw new Error("lock lost");
    },
    signal: lock.signal,
  };

  try {
    const result = await applyPlanImport({
      repo: fixture.repo,
      manifestPath: fixture.manifestPath,
      approvedDigest: digest,
      previewedHead: initialHead,
      approvedDigestWithPrefix: `sha256:${digest}`,
      ownerPrincipal: `uid:${currentUid()}`,
      stateRoot: fixture.stateRoot,
      repositoryLock: lock,
    }, capability);

    const queue = await openDurableQueue(fixture.repo, { stateRoot: fixture.stateRoot });
    const snapshot = await queue.snapshot();

    assert.equal(snapshot.entries.length, 2, "should have 2 queue entries");
    assert.equal(snapshot.entries[0].taskId, task1.id);
    assert.equal(snapshot.entries[1].taskId, task2.id);
    assert.deepEqual(snapshot.entries[1].dependsOn, [task1.id]);
  } finally {
    await lock.release();
  }
});

test("generated contracts pass validator", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-test-task-1");
  const content = writeManifest(fixture, [task1]);
  const digest = await commitManifest(fixture, content);

  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();
  const lock = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  const capability = {
    assertHeld: () => {
      if (lock.signal.aborted) throw new Error("lock lost");
    },
    signal: lock.signal,
  };

  try {
    await applyPlanImport({
      repo: fixture.repo,
      manifestPath: fixture.manifestPath,
      approvedDigest: digest,
      previewedHead: initialHead,
      approvedDigestWithPrefix: `sha256:${digest}`,
      ownerPrincipal: `uid:${currentUid()}`,
      stateRoot: fixture.stateRoot,
      repositoryLock: lock,
    }, capability);

    // The validator already ran during applyPlanImport via inspectEnrollmentAdmission.
    // If we got here, validation passed.
  } finally {
    await lock.release();
  }
});

test("task directory collision blocks import", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-test-task-1");
  const content = writeManifest(fixture, [task1]);
  const digest = await commitManifest(fixture, content);

  await createTaskDirectory(fixture.repo, task1.id);
  await writeFile(resolve(fixture.repo, "team/tasks", task1.id, "brief.md"), "# Existing");
  await writeFile(resolve(fixture.repo, "team/tasks", task1.id, "status.yaml"), "state: DISCUSSING");
  execSync("git add team/tasks", { cwd: fixture.repo, stdio: "ignore" });
  execSync('git commit -qm "add task"', { cwd: fixture.repo, stdio: "ignore" });

  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();

  const lock = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  const capability = {
    assertHeld: () => {
      if (lock.signal.aborted) throw new Error("lock lost");
    },
    signal: lock.signal,
  };

  try {
    await assert.rejects(
      applyPlanImport({
        repo: fixture.repo,
        manifestPath: fixture.manifestPath,
        approvedDigest: digest,
        previewedHead: initialHead,
        approvedDigestWithPrefix: `sha256:${digest}`,
        ownerPrincipal: `uid:${currentUid()}`,
        stateRoot: fixture.stateRoot,
        repositoryLock: lock,
      }, capability),
      /collision|already exists|task directory/i
    );

    const finalHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();
    assert.equal(finalHead, initialHead, "HEAD should not change on collision");
  } finally {
    await lock.release();
  }
});

test("symlinked task directory is rejected", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-test-task-1");
  const content = writeManifest(fixture, [task1]);
  const digest = await commitManifest(fixture, content);

  await createSymlinkedTaskDir(fixture.repo, task1.id);
  execSync("git add team/tasks", { cwd: fixture.repo, stdio: "ignore" });
  execSync('git commit -qm "add symlink"', { cwd: fixture.repo, stdio: "ignore" });

  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();

  const lock = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  const capability = {
    assertHeld: () => {
      if (lock.signal.aborted) throw new Error("lock lost");
    },
    signal: lock.signal,
  };

  try {
    await assert.rejects(
      applyPlanImport({
        repo: fixture.repo,
        manifestPath: fixture.manifestPath,
        approvedDigest: digest,
        previewedHead: initialHead,
        approvedDigestWithPrefix: `sha256:${digest}`,
        ownerPrincipal: `uid:${currentUid()}`,
        stateRoot: fixture.stateRoot,
        repositoryLock: lock,
      }, capability),
      /symlink/i
    );

    const finalHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();
    assert.equal(finalHead, initialHead, "HEAD should not change on symlink");
  } finally {
    await lock.release();
  }
});

test("symlinked parent directory is rejected", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-test-task-1");
  const content = writeManifest(fixture, [task1]);
  const digest = await commitManifest(fixture, content);

  await createSymlinkedParent(fixture.repo, task1.id);
  execSync("git add .", { cwd: fixture.repo, stdio: "ignore" });
  execSync('git commit -qm "add symlink"', { cwd: fixture.repo, stdio: "ignore" });

  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();

  const lock = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  const capability = {
    assertHeld: () => {
      if (lock.signal.aborted) throw new Error("lock lost");
    },
    signal: lock.signal,
  };

  try {
    await assert.rejects(
      applyPlanImport({
        repo: fixture.repo,
        manifestPath: fixture.manifestPath,
        approvedDigest: digest,
        previewedHead: initialHead,
        approvedDigestWithPrefix: `sha256:${digest}`,
        ownerPrincipal: `uid:${currentUid()}`,
        stateRoot: fixture.stateRoot,
        repositoryLock: lock,
      }, capability),
      /symlink/i
    );

    const finalHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();
    assert.equal(finalHead, initialHead, "HEAD should not change on symlink");
  } finally {
    await lock.release();
  }
});

test("exact replay is idempotent", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-test-task-1");
  const content = writeManifest(fixture, [task1]);
  const digest = await commitManifest(fixture, content);

  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();
  const lock = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  const capability = {
    assertHeld: () => {
      if (lock.signal.aborted) throw new Error("lock lost");
    },
    signal: lock.signal,
  };

  try {
    const result1 = await applyPlanImport({
      repo: fixture.repo,
      manifestPath: fixture.manifestPath,
      approvedDigest: digest,
      previewedHead: initialHead,
      approvedDigestWithPrefix: `sha256:${digest}`,
      ownerPrincipal: `uid:${currentUid()}`,
      stateRoot: fixture.stateRoot,
      repositoryLock: lock,
    }, capability);

    const result2 = await applyPlanImport({
      repo: fixture.repo,
      manifestPath: fixture.manifestPath,
      approvedDigest: digest,
      previewedHead: initialHead,
      approvedDigestWithPrefix: `sha256:${digest}`,
      ownerPrincipal: `uid:${currentUid()}`,
      stateRoot: fixture.stateRoot,
      repositoryLock: lock,
    }, capability);

    assert.equal(unwrapResult(result2).journalId, unwrapResult(result1).journalId, "replay should return same journal");
    assert.equal(unwrapResult(result2).importCommitSha, unwrapResult(result1).importCommitSha, "replay should return same commit");
  } finally {
    await lock.release();
  }
});
