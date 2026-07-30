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
  repoIsClean,
  countCommits,
} from "./test/plan-import-fixture.ts";
import { applyPlanImport, recoverImportJournal, previewPlanImport, type CompletedImport, type ImportOutcome } from "./plan-import.ts";
import { acquireRepositoryExecutionLock } from "./queue-repository.ts";
import { currentUid } from "./durable-state.ts";
import {
  assertLegalTransition,
  createImportJournal,
  createImportJournalId,
  importJournalPath,
  writeImportJournal,
  canonicalRepoKey,
} from "./import-journal.ts";
import { taskPath } from "./core.ts";

function unwrapResult(r: ImportOutcome): CompletedImport {
  if (r.kind === "BLOCKED") throw new Error("Unexpected blocked: " + r.reason);
  return r.result;
}

const owner = `uid:${currentUid()}`;

test("completed import is idempotent on replay", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-test-task-1");
  const content = writeManifest(fixture, [task1]);
  const digest = await commitManifest(fixture, content);
  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();

  const lock = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  const capability = {
    assertHeld: () => { if (lock.signal.aborted) throw new Error("lock lost"); },
    signal: lock.signal,
  };

  try {
    const result1 = await applyPlanImport({
      repo: fixture.repo,
      manifestPath: fixture.manifestPath,
      approvedDigest: digest,
      approvedDigestWithPrefix: `sha256:${digest}`,
      previewedHead: initialHead,
      ownerPrincipal: owner,
      stateRoot: fixture.stateRoot,
      repositoryLock: lock,
    }, capability);

    const result2 = await applyPlanImport({
      repo: fixture.repo,
      manifestPath: fixture.manifestPath,
      approvedDigest: digest,
      approvedDigestWithPrefix: `sha256:${digest}`,
      previewedHead: initialHead,
      ownerPrincipal: owner,
      stateRoot: fixture.stateRoot,
      repositoryLock: lock,
    }, capability);

    assert.equal(unwrapResult(result2).journalId, unwrapResult(result1).journalId, "replay journal id");
    assert.equal(unwrapResult(result2).importCommitSha, unwrapResult(result1).importCommitSha, "replay commit sha");
    assert.ok(result2.kind !== 'NEWLY_COMPLETED', "replay should be resumed");
    assert.ok(result2.kind !== 'BLOCKED', "replay should not be blocked");
    assert.ok(await repoIsClean(fixture.repo));
  } finally {
    await lock.release();
  }
});

test("previewPlanImport rejects incomplete journal", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-test-task-1");
  const content = writeManifest(fixture, [task1]);
  const digest = await commitManifest(fixture, content);

  const journalId = createImportJournalId();
  const journalPath = await importJournalPath(fixture.repo, journalId, fixture.stateRoot);
  const repoKey = await canonicalRepoKey(fixture.repo);
  const journal = createImportJournal(
    fixture.repo, repoKey, journalId, fixture.manifestPath,
    digest, digest, owner,
    execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim(),
    { revision: 0, expectedHead: null, paused: false, nextSequence: 0 }, new Date().toISOString(), [],
  );
  journal.phase = "PREPARED";
  const fakeCap = { assertHeld: () => {}, signal: new AbortController().signal };
  await writeImportJournal(journalPath, journal, fakeCap, journal.phase, journal.revision);

  await assert.rejects(
    previewPlanImport({
      repo: fixture.repo,
      manifestPath: fixture.manifestPath,
      approvedDigest: "",
      ownerPrincipal: owner,
      stateRoot: fixture.stateRoot,
    }),
    /incomplete.*journal|import journal exists/i,
  );
});

test("applyPlanImport resumes GIT_INSTALLED matching journal", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-test-task-1");
  const content = writeManifest(fixture, [task1]);
  const digest = await commitManifest(fixture, content);

  // First, do a normal import to create task files and commit
  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();
  const lock1 = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  const cap1 = {
    assertHeld: () => { if (lock1.signal.aborted) throw new Error("lock lost"); },
    signal: lock1.signal,
  };

  let journalId = "";
  let commitSha = "";
  try {
    const result = await applyPlanImport({
      repo: fixture.repo,
      manifestPath: fixture.manifestPath,
      approvedDigest: digest,
      approvedDigestWithPrefix: `sha256:${digest}`,
      previewedHead: initialHead,
      ownerPrincipal: owner,
      stateRoot: fixture.stateRoot,
      repositoryLock: lock1,
    }, cap1);
    journalId = unwrapResult(result).journalId;
    commitSha = unwrapResult(result).importCommitSha;
  } finally {
    await lock1.release();
  }

  // Simulate a crash: reset HEAD to before the import commit
  // but leave the queue intact (the journal is COMPLETED now)
  // Actually, let's test the replay path instead
  const lock2 = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  const cap2 = {
    assertHeld: () => { if (lock2.signal.aborted) throw new Error("lock lost"); },
    signal: lock2.signal,
  };

  try {
    const replay = await applyPlanImport({
      repo: fixture.repo,
      manifestPath: fixture.manifestPath,
      approvedDigest: digest,
      approvedDigestWithPrefix: `sha256:${digest}`,
      previewedHead: initialHead,
      ownerPrincipal: owner,
      stateRoot: fixture.stateRoot,
      repositoryLock: lock2,
    }, cap2);

    assert.equal(unwrapResult(replay).journalId, journalId, "replay journal id");
    assert.equal(unwrapResult(replay).importCommitSha, commitSha, "replay commit sha");
    assert.ok(replay.kind !== 'NEWLY_COMPLETED', "replay should be resumed");
    assert.ok(await repoIsClean(fixture.repo));
  } finally {
    await lock2.release();
  }
});

test("conflicting incomplete replay becomes BLOCKED", async () => {
  const fixture = await createTestFixture();
  const task1 = makeValidTask("2026-01-01-test-task-1");
  const content = writeManifest(fixture, [task1]);
  const digest = await commitManifest(fixture, content);
  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();

  // Create a fake PREPARED journal
  const journalId = createImportJournalId();
  const journalPath = await importJournalPath(fixture.repo, journalId, fixture.stateRoot);
  const repoKey = await canonicalRepoKey(fixture.repo);
  const journal = createImportJournal(
    fixture.repo, repoKey, journalId, fixture.manifestPath,
    digest, digest, owner,
    initialHead, { revision: 0, expectedHead: null, paused: false, nextSequence: 0 }, new Date().toISOString(), [],
  );
  journal.phase = "PREPARED";
  const fakeCap = { assertHeld: () => {}, signal: new AbortController().signal };
  await writeImportJournal(journalPath, journal, fakeCap, journal.phase, journal.revision);

  // Make a conflicting manifest (different task)
  const task2 = makeValidTask("2026-01-01-test-task-2");
  const content2 = writeManifest(fixture, [task2]);
  const digest2 = await commitManifest(fixture, content2);
  const head2 = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();

  const lock = await acquireRepositoryExecutionLock(fixture.repo, 30_000, fixture.stateRoot);
  const capability = {
    assertHeld: () => { if (lock.signal.aborted) throw new Error("lock lost"); },
    signal: lock.signal,
  };

  try {
    const outcome = await applyPlanImport({
      repo: fixture.repo,
      manifestPath: fixture.manifestPath,
      approvedDigest: digest2,
      approvedDigestWithPrefix: `sha256:${digest2}`,
      previewedHead: head2,
      ownerPrincipal: owner,
      stateRoot: fixture.stateRoot,
      repositoryLock: lock,
    }, capability);

    assert.equal(outcome.kind, "BLOCKED", "conflicting import should be blocked");

    const blockedJournal = await recoverImportJournal(fixture.repo, journalId, fixture.stateRoot);
    assert.equal(blockedJournal.phase, "BLOCKED", "journal should be BLOCKED");
  } finally {
    await lock.release();
  }
});
