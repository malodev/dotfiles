import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { acquireRepositoryExecutionLock, completeExactCommit, freezeReviewedTree } from "./queue-repository.ts";
import {
  digestExistingEvidence,
  freezeCompletionWindow,
  resumeSealedCompletion,
  sealCompletion,
  serializeCommittingDetail,
  verifiedJournalDetail,
  writeCompletionEvidence,
  type CompletionJournal,
} from "./completion-seal.ts";

function run(repo: string, ...args: string[]): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(args[0], args.slice(1), { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk) => { err += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveRun(out.trim()) : reject(new Error(`${args.join(" ")} failed: ${err}`)));
  });
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "three-agent-completion-seal-"));
  const repo = resolve(root, "repo");
  const state = resolve(root, "state");
  await mkdir(repo, { recursive: true });
  await run(repo, "git", "init", "-q");
  await run(repo, "git", "config", "user.name", "Test");
  await run(repo, "git", "config", "user.email", "test@test");
  await writeFile(resolve(repo, "AGENTS.md"), "# baseline\n");
  await run(repo, "git", "add", "AGENTS.md");
  await run(repo, "git", "commit", "-qm", "chore: baseline");
  const parent = await run(repo, "git", "rev-parse", "HEAD");
  const taskDir = resolve(repo, "team/tasks/sample");
  await mkdir(taskDir, { recursive: true });
  return { repo, state, taskDir, parent };
}

function fakeJournal(): CompletionJournal & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    markVerified: async (detail) => { calls.push(`markVerified:${detail}`); },
    markCommitting: async (detail) => { calls.push(`markCommitting:${detail}`); },
    complete: async (commitSha) => { calls.push(`complete:${commitSha}`); },
  };
}

test("freezeCompletionWindow refuses push-on-success before touching the repository", async () => {
  const { repo, state, parent } = await fixture();
  const capability = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    await assert.rejects(
      freezeCompletionWindow(repo, parent, capability, { pushOnSuccess: true, deployOnSuccess: false }),
      /refuses push\/deploy/,
    );
  } finally {
    await capability.release();
  }
});

test("freezeCompletionWindow refuses deploy-on-success before touching the repository", async () => {
  const { repo, state, parent } = await fixture();
  const capability = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    await assert.rejects(
      freezeCompletionWindow(repo, parent, capability, { pushOnSuccess: false, deployOnSuccess: true }),
      /refuses push\/deploy/,
    );
  } finally {
    await capability.release();
  }
});

test("full window: freeze before verification writes, evidence bytes written without a disk re-read, seal installs the exact commit", async () => {
  const { repo, state, taskDir, parent } = await fixture();
  const capability = await acquireRepositoryExecutionLock(repo, 2_000, state);
  const journal = fakeJournal();
  try {
    const reviewedTree = await freezeCompletionWindow(repo, parent, capability, { pushOnSuccess: false, deployOnSuccess: false });

    // Verification runs after freeze, writing verification.log incrementally — modeled here as a single write.
    await writeFile(resolve(taskDir, "verification.log"), "test output\n");
    await journal.markVerified(verifiedJournalDetail(reviewedTree));

    const evidenceDigests = await writeCompletionEvidence(repo, [
      { path: "team/tasks/sample/status.yaml", bytes: "state: COMPLETED\n" },
      { path: "team/tasks/sample/completion-report.md", bytes: "# report\n" },
    ], capability);
    evidenceDigests["team/tasks/sample/verification.log"] = await digestExistingEvidence(repo, "team/tasks/sample/verification.log");

    const result = await sealCompletion({
      repo,
      taskId: "sample",
      expectedParent: parent,
      reviewedTree,
      capability,
      expectedEvidence: evidenceDigests,
      journal,
    });

    assert.equal(await run(repo, "git", "rev-parse", "HEAD"), result.commitSha);
    assert.equal(await readFile(resolve(taskDir, "status.yaml"), "utf8"), "state: COMPLETED\n");
    assert.equal(await readFile(resolve(taskDir, "completion-report.md"), "utf8"), "# report\n");
    assert.equal(await readFile(resolve(taskDir, "verification.log"), "utf8"), "test output\n");

    assert.equal(journal.calls.length, 3);
    assert.match(journal.calls[0], /^markVerified:/);
    assert.match(journal.calls[1], /^markCommitting:/);
    assert.equal(journal.calls[2], `complete:${result.commitSha}`);
  } finally {
    await capability.release();
  }
});

test("omits the journal entirely for immediate, non-queued completion", async () => {
  const { repo, state, taskDir, parent } = await fixture();
  const capability = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    const reviewedTree = await freezeCompletionWindow(repo, parent, capability, { pushOnSuccess: false, deployOnSuccess: false });
    await writeFile(resolve(taskDir, "verification.log"), "ok\n");
    const evidenceDigests = await writeCompletionEvidence(repo, [
      { path: "team/tasks/sample/status.yaml", bytes: "state: COMPLETED\n" },
    ], capability);
    evidenceDigests["team/tasks/sample/verification.log"] = await digestExistingEvidence(repo, "team/tasks/sample/verification.log");

    const result = await sealCompletion({ repo, taskId: "sample", expectedParent: parent, reviewedTree, capability, expectedEvidence: evidenceDigests });
    assert.equal(await run(repo, "git", "rev-parse", "HEAD"), result.commitSha);
  } finally {
    await capability.release();
  }
});

test("rejects evidence naming a file outside the completion-evidence set", async () => {
  const { repo, state, taskDir, parent } = await fixture();
  const capability = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    const reviewedTree = await freezeCompletionWindow(repo, parent, capability, { pushOnSuccess: false, deployOnSuccess: false });
    const evidenceDigests = await writeCompletionEvidence(repo, [
      { path: "team/tasks/sample/rogue.txt", bytes: "not evidence\n" },
    ], capability);

    await assert.rejects(
      sealCompletion({ repo, taskId: "sample", expectedParent: parent, reviewedTree, capability, expectedEvidence: evidenceDigests }),
      /Invalid expected completion evidence/,
    );
  } finally {
    await capability.release();
  }
});

test("the forward path's journaled COMMITTING detail is exactly what resume can reconcile", async () => {
  // Regression test for the drift the hand-rolled test protocols hit: a
  // markCommitting payload serialized with different field names than
  // reconcileJournaledExactCommit's parser expects.
  const { repo, state, taskDir, parent } = await fixture();
  const capability = await acquireRepositoryExecutionLock(repo, 2_000, state);
  try {
    await writeFile(resolve(taskDir, "status.yaml"), "state: COMPLETED\n");
    const reviewedTree = await freezeReviewedTree(repo, parent, capability);
    const exact = await completeExactCommit(repo, "sample", parent, reviewedTree, {
      "team/tasks/sample/status.yaml": createHash("sha256").update("state: COMPLETED\n").digest("hex"),
    }, capability);
    const detail = serializeCommittingDetail(exact);

    let completedWith: string | undefined;
    const resumed = await resumeSealedCompletion(repo, detail, parent, capability, async (commitSha) => { completedWith = commitSha; });

    assert.equal(resumed.commitSha, exact.commitSha);
    assert.equal(completedWith, exact.commitSha);
    assert.equal(await run(repo, "git", "rev-parse", "HEAD"), exact.commitSha);
  } finally {
    await capability.release();
  }
});
