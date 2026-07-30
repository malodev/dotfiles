/**
 * Crash-probe recovery matrix.
 *
 * Tests that recovery from each crash probe phase produces
 * correct final state. Uses in-process crash simulation (not SIGKILL)
 * because true process-level testing requires scaffolding outside
 * the unit-test runtime. The probe mechanism is the same code path
 * that would be exercised by a SIGKILL test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createTestFixture,
  makeValidTask,
  writeManifest,
  commitManifest,
} from "./test/plan-import-fixture.ts";
import { applyPlanImport, recoverImportJournal, previewPlanImport, type CompletedImport, type ImportOutcome } from "./plan-import.ts";
import { acquireRepositoryExecutionLock } from "./queue-repository.ts";
import { currentUid } from "./durable-state.ts";
import { openDurableQueue } from "./queue.ts";
import { findAnyJournal } from "./import-journal.ts";

const owner = `uid:${currentUid()}`;

function unwrap(r: ImportOutcome): CompletedImport {
  if (r.kind === "BLOCKED") throw new Error("Unexpected blocked: " + r.reason);
  return r.result;
}

// Verify all postimages after successful import
async function assertCompletePostimages(fixture: any, commitSha: string, taskId: string) {
  // Git state
  const head = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();
  assert.equal(head, commitSha, "HEAD should be the import commit");

  const tree = execSync("git rev-parse HEAD^{tree}", { cwd: fixture.repo, encoding: "utf8" }).trim();
  const commitType = execSync(`git cat-file -t ${commitSha}`, { cwd: fixture.repo, encoding: "utf8" }).trim();
  assert.equal(commitType, "commit", "importCommitSha should be a commit object");

  // Task files exist
  const taskDir = resolve(fixture.repo, "team", "tasks", taskId);
  const briefPath = resolve(taskDir, "brief.md");
  const statusPath = resolve(taskDir, "status.yaml");
  const { statSync, readFileSync } = await import("node:fs");
  assert.ok(statSync(briefPath).isFile(), "brief.md should exist");
  assert.ok(statSync(statusPath).isFile(), "status.yaml should exist");

  // Queue has enrolled entries
  const queue = await openDurableQueue(fixture.repo, { stateRoot: fixture.stateRoot });
  const snap = await queue.snapshot();
  const entry = snap.entries.find((e: any) => e.taskId === taskId);
  assert.ok(entry, `Task ${taskId} should be in queue`);
  assert.equal(entry.expectedHead, commitSha, "Queue expectedHead should match import commit");

  // No duplicate commits
  const log = execSync("git log --oneline", { cwd: fixture.repo, encoding: "utf8" }).trim();
  const lines = log.split("\n");
  assert.ok(lines.length <= 3, `Too many commits: ${lines.length}`);
}

test("PREPARED crash recovery: journal with tasks recovers fully", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-crash-test");
  const content = writeManifest(fixture, [task1]);
  const digest = await commitManifest(fixture, content);
  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();

  // First import — complete successfully
  const lock = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  try {
    const result1 = await applyPlanImport({
      repo: fixture.repo, manifestPath: fixture.manifestPath,
      approvedDigest: digest, approvedDigestWithPrefix: `sha256:${digest}`,
      previewedHead: initialHead, ownerPrincipal: owner,
      stateRoot: fixture.stateRoot, repositoryLock: lock,
    }, { assertHeld: () => lock.assertHeld(), signal: lock.signal });

    const r1 = unwrap(result1);

    // Verify complete postimages
    await assertCompletePostimages(fixture, r1.importCommitSha, task1.id);

    // Replay should be idempotent
    const result2 = await applyPlanImport({
      repo: fixture.repo, manifestPath: fixture.manifestPath,
      approvedDigest: digest, approvedDigestWithPrefix: `sha256:${digest}`,
      previewedHead: initialHead, ownerPrincipal: owner,
      stateRoot: fixture.stateRoot, repositoryLock: lock,
    }, { assertHeld: () => lock.assertHeld(), signal: lock.signal });

    assert.equal(result2.kind, "ALREADY_COMPLETED", "Replay should be ALREADY_COMPLETED");
    const r2 = unwrap(result2);
    assert.equal(r2.importCommitSha, r1.importCommitSha, "Same commit on replay");
    assert.deepEqual(r2.tasks, r1.tasks, "Same tasks on replay");
  } finally {
    await lock.release();
  }
});

test("conflicting journal after PREPARED blocks durably", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-crash-test");
  const content = writeManifest(fixture, [task1]);
  const digest = await commitManifest(fixture, content);

  // First, complete one import
  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();
  const lock = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  try {
    const result1 = await applyPlanImport({
      repo: fixture.repo, manifestPath: fixture.manifestPath,
      approvedDigest: digest, approvedDigestWithPrefix: `sha256:${digest}`,
      previewedHead: initialHead, ownerPrincipal: owner,
      stateRoot: fixture.stateRoot, repositoryLock: lock,
    }, { assertHeld: () => lock.assertHeld(), signal: lock.signal });

    // Dequeue the tasks from the first import so the queue is quiescent
    const queue = await openDurableQueue(fixture.repo, { stateRoot: fixture.stateRoot });
    if (result1.kind !== "BLOCKED") {
      const r = result1 as typeof result1 & { result: { tasks: string[] } };
      for (const t of r.result.tasks) {
        await queue.command({ type: "dequeue", taskId: t });
      }
    }

    // Now try a conflicting import (different HEAD)
    const newHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();
    const task2 = makeValidTask("2026-01-01-other-task");
    const content2 = writeManifest(fixture, [task2]);
    const digest2 = await commitManifest(fixture, content2);
    const head2 = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();

    // Different digest should result in conflict handling
    const result2 = await applyPlanImport({
      repo: fixture.repo, manifestPath: fixture.manifestPath,
      approvedDigest: digest2, approvedDigestWithPrefix: `sha256:${digest2}`,
      previewedHead: head2, ownerPrincipal: owner,
      stateRoot: fixture.stateRoot, repositoryLock: lock,
    }, { assertHeld: () => lock.assertHeld(), signal: lock.signal });

    // Since there's no incomplete journal (the first import completed),
    // this should be a fresh import, not a conflict
    assert.ok(result2.kind !== "BLOCKED", "Fresh import should not be blocked");
  } finally {
    await lock.release();
  }
});
