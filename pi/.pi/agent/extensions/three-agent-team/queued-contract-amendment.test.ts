/**
 * Orchestration tests for applyQueuedContractAmendment.
 *
 * These use real git repositories, the real bundled validator, and the real
 * durable queue, because the module's whole value is the interaction between
 * them. They touch the real, non-redirectable state root only via an injected
 * `stateRoot` where the API allows it; each test removes exactly the
 * repository-keyed subtree it creates.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireRepositoryExecutionLock, inspectEnrollmentAdmission } from "./queue-repository.ts";
import { currentUid, defaultDurableStateRoot, identifyRepository } from "./durable-state.ts";
import { openDurableQueue } from "./queue.ts";
import { applyQueuedContractAmendment } from "./queued-contract-amendment.ts";

const VALIDATOR = fileURLToPath(new URL("../../skills/init-three-agent-team/assets/validate_goal_contract.py", import.meta.url));

function run(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(args[0], args.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk) => { err += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveRun(out.trim()) : reject(new Error(`${args.join(" ")} failed: ${err}`)));
  });
}

function briefText(taskId: string, baseline: string, command = "python -m unittest"): string {
  return `# Goal Contract: ${taskId}

## Goal
Verify queued contract amendment.

## Current behavior
No durable queue entry exists.

## Agreed approach
Validate immutable committed inputs.

## Success tests
### ST-01: tests pass
- Command: \`${command}\`
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
1. \`${command}\`

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
`;
}

function statusText(taskId: string, baseline: string): string {
  return `task_id: ${taskId}
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
`;
}

/** A repo with `taskIds` enrolled in the durable queue, all QUEUED and undispatched. */
async function enrolledFixture(taskIds: string[]) {
  const root = await mkdtemp(resolve(tmpdir(), "three-agent-amendment-"));
  await chmod(root, 0o700);
  const repo = resolve(root, "repo");
  const stateRoot = resolve(root, "state");
  await mkdir(repo, { mode: 0o700 });
  await run(repo, "git", "init", "-q");
  await run(repo, "git", "config", "user.name", "Amendment Test");
  await run(repo, "git", "config", "user.email", "amend@example.invalid");
  await writeFile(resolve(repo, "AGENTS.md"), "# Commands\n\n- Test: `python -m unittest`\n");
  await run(repo, "git", "add", "AGENTS.md");
  await run(repo, "git", "commit", "-qm", "chore: baseline");
  const baseline = await run(repo, "git", "rev-parse", "HEAD");

  for (const taskId of taskIds) {
    const dir = resolve(repo, "team/tasks", taskId);
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, "brief.md"), briefText(taskId, baseline));
    await writeFile(resolve(dir, "status.yaml"), statusText(taskId, baseline));
  }
  await run(repo, "git", "add", "team/tasks");
  await run(repo, "git", "commit", "-qm", "chore: commit contracts");

  const queue = await openDurableQueue(repo, { stateRoot, leaseTtlMs: 5_000 });
  for (const taskId of taskIds) {
    const admission = await inspectEnrollmentAdmission(repo, taskId, "2026-01-01T00:00:00.000Z", VALIDATOR, stateRoot);
    await queue.command({ type: "enqueue", ...admission.enqueue, dependsOn: [], ownerPrincipal: `uid:${currentUid()}` });
  }

  const cleanup = async () => {
    const identity = await identifyRepository(repo);
    await rm(resolve(defaultDurableStateRoot(), "authorizations", identity.repositoryKey), { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  };
  return { root, repo, stateRoot, queue, cleanup };
}

async function heldCapability(repo: string, stateRoot: string) {
  const lock = await acquireRepositoryExecutionLock(repo, 5_000, stateRoot);
  return {
    capability: { assertHeld: () => lock.assertHeld(), signal: lock.signal },
    release: () => lock.release(),
  };
}

/**
 * A realistic amendment: the success-test command appears in both the ST-01
 * block and the Verification commands list, and the validator requires them to
 * agree — so correcting a command genuinely means two edits, each matching
 * exactly once.
 */
function amendmentSpec(taskId: string, overrides: Partial<{ amendmentId: string; taskIds: string[]; subject: string }> = {}) {
  return {
    amendmentId: overrides.amendmentId ?? "fix-commands",
    taskIds: overrides.taskIds ?? [taskId],
    subject: overrides.subject ?? "fix: correct queued success-test command",
    edits: [
      {
        path: `team/tasks/${taskId}/brief.md`,
        oldText: "- Command: `python -m unittest`",
        newText: "- Command: `pytest -q`",
      },
      {
        path: `team/tasks/${taskId}/brief.md`,
        oldText: "1. `python -m unittest`",
        newText: "1. `pytest -q`",
      },
    ],
  };
}

test("amends a queued contract, commits it exactly, and advances the queue to the new digests", async () => {
  const { repo, stateRoot, queue, cleanup } = await enrolledFixture(["sample"]);
  const { capability, release } = await heldCapability(repo, stateRoot);
  try {
    const before = await queue.snapshot();
    const beforeEntry = before.entries[0];
    const headBefore = await run(repo, "git", "rev-parse", "HEAD");

    const result = await applyQueuedContractAmendment(repo, amendmentSpec("sample"), capability, stateRoot);

    assert.equal(result.changed, true);
    assert.notEqual(result.commit, headBefore);
    assert.equal(await run(repo, "git", "rev-parse", "HEAD"), result.commit);
    assert.equal(await run(repo, "git", "log", "-1", "--format=%s", result.commit), "fix: correct queued success-test command");
    assert.equal(await run(repo, "git", "status", "--porcelain=v2", "--untracked-files=all"), "");

    // The committed brief carries the edit.
    const brief = await readFile(resolve(repo, "team/tasks/sample/brief.md"), "utf8");
    assert.match(brief, /pytest -q/);
    assert.doesNotMatch(brief, /python -m unittest/);

    // The queue advanced its epoch and froze the new digests.
    const after = await queue.snapshot();
    assert.equal(after.expectedHead, result.commit);
    assert.notEqual(after.entries[0].approvedBriefDigest, beforeEntry.approvedBriefDigest);
    assert.notEqual(after.entries[0].contractDigest, beforeEntry.contractDigest);
    assert.equal(after.entries[0].state, "QUEUED");
  } finally {
    await release();
    await cleanup();
  }
});

test("replaying the same amendment id is idempotent and does not create a second commit", async () => {
  const { repo, stateRoot, cleanup } = await enrolledFixture(["sample"]);
  const { capability, release } = await heldCapability(repo, stateRoot);
  try {
    const first = await applyQueuedContractAmendment(repo, amendmentSpec("sample"), capability, stateRoot);
    const second = await applyQueuedContractAmendment(repo, amendmentSpec("sample"), capability, stateRoot);
    assert.equal(second.commit, first.commit, "replay must settle the existing journal, not commit again");
    assert.equal(await run(repo, "git", "rev-parse", "HEAD"), first.commit);
  } finally {
    await release();
    await cleanup();
  }
});

test("refuses a task that has already been claimed", async () => {
  const { repo, stateRoot, queue, cleanup } = await enrolledFixture(["sample"]);
  const { capability, release } = await heldCapability(repo, stateRoot);
  try {
    await queue.withDispatcher(async (session) => {
      const claimed = await session.claimNext();
      assert.ok(claimed, "fixture should claim the head entry");
    });
    await assert.rejects(
      applyQueuedContractAmendment(repo, amendmentSpec("sample"), capability, stateRoot),
      /requires an unclaimed unauthorized task/,
    );
  } finally {
    await release();
    await cleanup();
  }
});

test("refuses to amend while a dispatcher lease is active", async () => {
  const { repo, stateRoot, queue, cleanup } = await enrolledFixture(["sample"]);
  const { capability, release } = await heldCapability(repo, stateRoot);
  try {
    await queue.withDispatcher(async () => {
      await assert.rejects(
        applyQueuedContractAmendment(repo, amendmentSpec("sample"), capability, stateRoot),
        /requires an idle dispatcher/,
      );
    });
  } finally {
    await release();
    await cleanup();
  }
});

test("refuses when repository HEAD has moved off the queue's expected head", async () => {
  const { repo, stateRoot, cleanup } = await enrolledFixture(["sample"]);
  const { capability, release } = await heldCapability(repo, stateRoot);
  try {
    await writeFile(resolve(repo, "drift.txt"), "drift\n");
    await run(repo, "git", "add", "drift.txt");
    await run(repo, "git", "commit", "-qm", "chore: drift");
    await assert.rejects(
      applyQueuedContractAmendment(repo, amendmentSpec("sample"), capability, stateRoot),
      /HEAD to equal queue expectedHead/,
    );
  } finally {
    await release();
    await cleanup();
  }
});

test("refuses an edit whose old text does not match exactly once", async () => {
  const { repo, stateRoot, cleanup } = await enrolledFixture(["sample"]);
  const { capability, release } = await heldCapability(repo, stateRoot);
  try {
    const spec = {
      ...amendmentSpec("sample"),
      edits: [{ path: "team/tasks/sample/brief.md", oldText: "text that is absent", newText: "irrelevant" }],
    };
    await assert.rejects(
      applyQueuedContractAmendment(repo, spec, capability, stateRoot),
      /must match exactly once/,
    );
  } finally {
    await release();
    await cleanup();
  }
});

test("refuses an amendment that would make a sibling queued contract invalid", async () => {
  // The module validates every queued task, not just the amended ones, because
  // a shared file edit can break a contract it never named.
  const { repo, stateRoot, cleanup } = await enrolledFixture(["sample", "sibling"]);
  const { capability, release } = await heldCapability(repo, stateRoot);
  try {
    const spec = {
      amendmentId: "break-sibling",
      taskIds: ["sample"],
      subject: "fix: break the open-decisions section",
      edits: [{
        path: "team/tasks/sample/brief.md",
        oldText: "## Open decisions\nNONE",
        newText: "## Open decisions\nstill deciding",
      }],
    };
    await assert.rejects(
      applyQueuedContractAmendment(repo, spec, capability, stateRoot),
      /validation failed/i,
    );
  } finally {
    await release();
    await cleanup();
  }
});
