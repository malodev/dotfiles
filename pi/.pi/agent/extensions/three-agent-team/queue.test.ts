import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, chmod, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { barrier, openDurableQueue, type EnqueueCommand } from "./queue.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D1 = "1".repeat(64);
const D2 = "2".repeat(64);
async function fixture(now?: () => Date, leaseTtlMs = 10_000) {
  const root = await mkdtemp(resolve(tmpdir(), "three-agent-queue-unit-"));
  await chmod(root, 0o700);
  const repo = resolve(root, "repo");
  const stateRoot = resolve(root, "state");
  await mkdir(repo, { mode: 0o700 });
  return { root, repo, stateRoot, queue: await openDurableQueue(repo, { stateRoot, now, leaseTtlMs }) };
}
function enqueue(taskId: string, expectedHead = A, dependsOn: string[] = []): EnqueueCommand {
  return {
    type: "enqueue", taskId, dependsOn, baselineCommit: A, expectedHead,
    approvedBriefDigest: D1, contractDigest: D2, ownerPrincipal: "uid:test",
    approvedAt: "2026-01-01T00:00:00.000Z", approvalSource: "/team-enqueue",
    completionPolicy: { commitOnSuccess: true, pushOnSuccess: false, deployOnSuccess: false },
  };
}

async function advanceToCommitting(session: any, taskId: string, attemptId: string) {
  for (const phase of ["AUTHORIZING", "AUTHORIZED", "EXECUTING", "VERIFIED", "COMMITTING"] as const) {
    await session.advance(taskId, attemptId, phase);
  }
}

test("enqueue/pause/continue/dequeue are durable and idempotent", async () => {
  const { queue } = await fixture();
  const first = await queue.command(enqueue("one"));
  assert.equal(first.snapshot.revision, 1);
  assert.equal((await queue.command(enqueue("one"))).changed, false);
  assert.equal((await queue.snapshot()).revision, 1);
  await assert.rejects(queue.command({ ...enqueue("one"), contractDigest: "3".repeat(64) }), /Conflicting immutable/);
  await assert.rejects(queue.command({ ...enqueue("one"), expectedHead: B }), /Conflicting immutable/);
  await assert.rejects(queue.command({ ...enqueue("one"), baselineCommit: B }), /Conflicting immutable/);
  assert.equal((await queue.command({ type: "pause" })).snapshot.revision, 2);
  assert.equal((await queue.command({ type: "pause" })).changed, false);
  assert.equal((await queue.command({ type: "continue" })).snapshot.revision, 3);
  assert.equal((await queue.command({ type: "continue" })).changed, false);
  assert.equal((await queue.command({ type: "dequeue", taskId: "one" })).snapshot.entries[0].state, "DEQUEUED");
  assert.equal((await queue.command({ type: "dequeue", taskId: "one" })).changed, false);
});

test("a fully dequeued queue starts a new exact-head epoch without ancestry drift", async () => {
  const { queue } = await fixture();
  await queue.command(enqueue("old", A));
  const dequeued = await queue.command({ type: "dequeue", taskId: "old" });
  assert.equal(dequeued.snapshot.expectedHead, null);
  const next = await queue.command(enqueue("new", B));
  assert.equal(next.snapshot.expectedHead, B);
  assert.equal(next.snapshot.entries.at(-1)?.expectedHead, B);
  await assert.rejects(queue.command(enqueue("drift", C)), /Queue expected HEAD/);
});

test("revision CAS rejects stale effective writes but permits exact no-op replay", async () => {
  const { queue } = await fixture();
  const enrolled = await queue.command({ ...enqueue("one"), expectedRevision: 0 });
  await assert.rejects(queue.command({ type: "pause", expectedRevision: 0 }), /Stale queue revision/);
  const replay = await queue.command({ ...enqueue("one"), expectedRevision: 0 });
  assert.equal(replay.changed, false);
  assert.equal(replay.snapshot.revision, enrolled.snapshot.revision);
});

test("FIFO completion advances expectedHead and blocked head is a queue-wide barrier", async () => {
  const { queue } = await fixture();
  await queue.command(enqueue("one"));
  await queue.command(enqueue("two", A, ["one"]));
  await queue.withDispatcher(async (session) => {
    const first = await session.claimNext();
    assert.equal(first?.entry.taskId, "one");
    await session.block("one", first!.attempt.attemptId, "uncertain child process");
    assert.equal(await session.claimNext(), undefined);
  });
  let snapshot = await queue.snapshot();
  assert.equal(snapshot.entries[0].state, "BLOCKED");
  assert.equal(snapshot.entries[1].state, "QUEUED");
  await assert.rejects(queue.command({
    type: "recover", taskId: "one", failedAttemptId: snapshot.entries[0].attempts[0].attemptId,
    approvedBy: "different-owner", approvedAt: "2026-01-02T00:00:00.000Z", expectedRevision: snapshot.revision,
  }), /does not match enrollment owner/);
  await queue.command({
    type: "recover", taskId: "one", failedAttemptId: snapshot.entries[0].attempts[0].attemptId,
    approvedBy: "uid:test", approvedAt: "2026-01-02T00:00:00.000Z", expectedRevision: snapshot.revision,
  });
  await queue.withDispatcher(async (session) => {
    const recovered = await session.claimNext();
    assert.equal(recovered?.attempt.kind, "RECOVERY");
    await advanceToCommitting(session, "one", recovered!.attempt.attemptId);
    await session.complete("one", recovered!.attempt.attemptId, B);
  });
  snapshot = await queue.snapshot();
  assert.equal(snapshot.expectedHead, B);
  await queue.withDispatcher(async (session) => {
    const second = await session.claimNext();
    assert.equal(second?.entry.taskId, "two");
    assert.equal(second?.entry.authorizationHead, B);
  });
});

test("illegal phase skips, stale attempt token, and dequeue-after-claim fail closed", async () => {
  const { queue } = await fixture();
  await queue.command(enqueue("one"));
  let stale: { session: any; attemptId: string } | undefined;
  await queue.withDispatcher(async (session) => {
    const claim = await session.claimNext();
    stale = { session, attemptId: claim!.attempt.attemptId };
    await assert.rejects(session.advance("one", claim!.attempt.attemptId, "AUTHORIZED"), /Illegal dispatch phase/);
  });
  await assert.rejects(stale!.session.heartbeat(), /Stale dispatcher fencing token/);
  await assert.rejects(queue.command({ type: "dequeue", taskId: "one" }), /cannot be dequeued/);
});

test("expired lease takeover allocates a larger fence and fences the old owner", async () => {
  let milliseconds = Date.parse("2026-01-01T00:00:00.000Z");
  const { queue } = await fixture(() => new Date(milliseconds), 100);
  await queue.command(enqueue("one"));
  await queue.withDispatcher(async (oldSession) => {
    const oldToken = oldSession.fencingToken;
    milliseconds += 101;
    await queue.withDispatcher(async (newSession) => {
      assert.ok(newSession.fencingToken > oldToken);
      await assert.rejects(oldSession.heartbeat(), /Stale dispatcher fencing token/);
    });
  });
});

test("durable queue rejects symlinked state objects and invalid persisted schema", async () => {
  const { repo, stateRoot, root, queue } = await fixture();
  await queue.command(enqueue("one"));
  const snapshot = await queue.snapshot();
  const key = snapshot.repositoryKey;
  const queuePath = resolve(stateRoot, "queues", `${key}.json`);
  const text = await readFile(queuePath, "utf8");
  assert.match(text, /"repository"/);
  const malformed = { ...JSON.parse(text), unexpected: true };
  await writeFile(queuePath, `${JSON.stringify(malformed)}\n`, { mode: 0o600 });
  await assert.rejects(queue.snapshot(), /unknown or missing fields/);

  const hostileRoot = resolve(root, "hostile-state");
  await mkdir(hostileRoot, { mode: 0o700 });
  await mkdir(resolve(hostileRoot, "queues"), { mode: 0o700 });
  await symlink(queuePath, resolve(hostileRoot, "queues", `${key}.json`));
  const hostile = await openDurableQueue(repo, { stateRoot: hostileRoot });
  await assert.rejects(hostile.snapshot(), /symlink|Insecure|ELOOP/i);

  const redirectedRoot = resolve(root, "redirected-state");
  const redirectedTarget = resolve(root, "redirected-lock-target");
  await mkdir(redirectedRoot, { mode: 0o700 });
  await mkdir(redirectedTarget, { mode: 0o700 });
  await symlink(redirectedTarget, resolve(redirectedRoot, "locks"));
  await assert.rejects(openDurableQueue(repo, { stateRoot: redirectedRoot }), /symlink/i);
});

test("bulkEnqueue writes multiple tasks atomically and resolves internal dependencies", async () => {
  const { queue } = await fixture();
  const e1 = enqueue("one");
  const e2 = enqueue("two", A, ["one"]);
  const e3 = enqueue("three", A, ["two"]);

  const extract = (e: EnqueueCommand) => {
    const { type, expectedRevision, ...rest } = e;
    return rest;
  };

  const result = await queue.command({
    type: "bulkEnqueue",
    entries: [extract(e1), extract(e2), extract(e3)]
  });

  assert.equal(result.changed, true);
  assert.equal(result.snapshot.revision, 1);
  assert.equal(result.snapshot.entries.length, 3);
  assert.equal(result.snapshot.entries[0].taskId, "one");
  assert.equal(result.snapshot.entries[1].taskId, "two");
  assert.equal(result.snapshot.entries[2].taskId, "three");

  // Conflicting immutable fields inside bulkEnqueue
  const e2Conflict = { ...extract(e2), baselineCommit: B };
  await assert.rejects(queue.command({
    type: "bulkEnqueue",
    entries: [extract(e1), e2Conflict]
  }), /Conflicting immutable/);

  // Missing dependency fails validation
  await assert.rejects(queue.command({
    type: "bulkEnqueue",
    entries: [extract(enqueue("four", A, ["missing"]))]
  }), /Dependency missing must be an earlier non-dequeued entry or enqueued earlier in this bulk operation/);
});

test("bulkEnqueue is idempotent on exact replay even with stale revision", async () => {
  const { queue } = await fixture();
  const e1 = enqueue("alpha");
  const e2 = enqueue("beta", A, ["alpha"]);

  const extract = (e: EnqueueCommand) => {
    const { type, expectedRevision, ...rest } = e;
    return rest;
  };

  // First enqueue succeeds
  const first = await queue.command({
    type: "bulkEnqueue",
    entries: [extract(e1), extract(e2)]
  });
  assert.equal(first.changed, true);
  assert.equal(first.snapshot.entries.length, 2);

  // Exact replay with stale revision is idempotent
  const replay = await queue.command({
    type: "bulkEnqueue",
    entries: [extract(e1), extract(e2)],
    expectedRevision: 999 // stale
  });
  assert.equal(replay.changed, false);
  assert.equal(replay.snapshot.entries.length, 2);
});

test("amendQueuedContracts atomically advances the head and frozen digests", async () => {
  const { queue } = await fixture();
  await queue.command(enqueue("one"));
  await queue.command(enqueue("two", A, ["one"]));
  const before = await queue.snapshot();
  const command = {
    type: "amendQueuedContracts" as const,
    expectedHead: A,
    newExpectedHead: B,
    amendments: [{
      taskId: "two",
      expectedApprovedBriefDigest: D1,
      expectedContractDigest: D2,
      approvedBriefDigest: "3".repeat(64),
      contractDigest: "4".repeat(64),
    }],
    expectedRevision: before.revision,
  };
  const amended = await queue.command(command);
  assert.equal(amended.changed, true);
  assert.equal(amended.snapshot.expectedHead, B);
  assert.equal(amended.snapshot.entries[1].approvedBriefDigest, "3".repeat(64));
  assert.equal(amended.snapshot.entries[1].contractDigest, "4".repeat(64));
  assert.equal((await queue.command({ ...command, expectedRevision: before.revision })).changed, false);
  await assert.rejects(queue.command({
    ...command,
    newExpectedHead: C,
    expectedRevision: amended.snapshot.revision,
  }), /expected HEAD/);
});

test("amendQueuedContracts starts a new epoch that can claim after completed history", async () => {
  const { queue } = await fixture();
  await queue.command(enqueue("completed"));
  await queue.withDispatcher(async (session) => {
    const claimed = await session.claimNext();
    assert.ok(claimed);
    await session.advance("completed", claimed.attempt.attemptId, "AUTHORIZING");
    await session.advance("completed", claimed.attempt.attemptId, "AUTHORIZED");
    await session.advance("completed", claimed.attempt.attemptId, "EXECUTING");
    await session.advance("completed", claimed.attempt.attemptId, "VERIFIED");
    await session.advance("completed", claimed.attempt.attemptId, "COMMITTING");
    await session.complete("completed", claimed.attempt.attemptId, B);
  });
  await queue.command(enqueue("repaired", B));
  const before = await queue.snapshot();
  const repaired = await queue.command({
    type: "amendQueuedContracts",
    expectedHead: B,
    newExpectedHead: C,
    amendments: [{
      taskId: "repaired",
      expectedApprovedBriefDigest: D1,
      expectedContractDigest: D2,
      approvedBriefDigest: "3".repeat(64),
      contractDigest: "4".repeat(64),
    }],
    expectedRevision: before.revision,
  });
  assert.deepEqual(repaired.snapshot.entries.map((entry) => entry.taskId), ["repaired"]);
  await queue.withDispatcher(async (session) => {
    const claimed = await session.claimNext();
    assert.equal(claimed?.entry.taskId, "repaired");
    assert.equal(claimed?.entry.authorizationHead, C);
  });
});

test("amendQueuedContracts rejects claimed entries and digest drift", async () => {
  const { queue } = await fixture();
  await queue.command(enqueue("one"));
  const before = await queue.snapshot();
  const amendment = {
    taskId: "one",
    expectedApprovedBriefDigest: "f".repeat(64),
    expectedContractDigest: D2,
    approvedBriefDigest: "3".repeat(64),
    contractDigest: "4".repeat(64),
  };
  await assert.rejects(queue.command({
    type: "amendQueuedContracts", expectedHead: A, newExpectedHead: B,
    amendments: [amendment], expectedRevision: before.revision,
  }), /preimage mismatch/);
  await queue.withDispatcher(async (session) => { await session.claimNext(); });
  const claimed = await queue.snapshot();
  await assert.rejects(queue.command({
    type: "amendQueuedContracts", expectedHead: A, newExpectedHead: B,
    amendments: [{ ...amendment, expectedApprovedBriefDigest: D1 }], expectedRevision: claimed.revision,
  }), /unclaimed unauthorized/);
});

test("bulkEnqueue rejects stale revision for effective writes", async () => {
  const { queue } = await fixture();
  const e1 = enqueue("one");
  const extract = (e: EnqueueCommand) => {
    const { type, expectedRevision, ...rest } = e;
    return rest;
  };

  // First enqueue succeeds at revision 0
  const first = await queue.command({
    type: "bulkEnqueue",
    entries: [extract(e1)],
    expectedRevision: 0
  });
  assert.equal(first.changed, true);
  assert.equal(first.snapshot.revision, 1);

  // Second enqueue with stale revision 0 must fail
  const e2 = enqueue("two");
  await assert.rejects(
    queue.command({
      type: "bulkEnqueue",
      entries: [extract(e2)],
      expectedRevision: 0 // stale, should be 1
    }),
    /Stale queue revision/
  );

  // With correct revision, it succeeds
  const second = await queue.command({
    type: "bulkEnqueue",
    entries: [extract(e2)],
    expectedRevision: 1
  });
  assert.equal(second.changed, true);
  assert.equal(second.snapshot.entries.length, 2);
});

test("barrier finds the earliest nonterminal entry and ignores terminal ones", async () => {
  const { queue } = await fixture();
  assert.equal(barrier(await queue.snapshot()), undefined, "an empty queue has no barrier");

  await queue.command(enqueue("one"));
  await queue.command(enqueue("two", A, ["one"]));
  let snapshot = await queue.snapshot();
  assert.equal(barrier(snapshot)?.taskId, "one", "the earliest QUEUED entry is the barrier when nothing is running");

  let completionCommit = "";
  await queue.withDispatcher(async (session) => {
    const claimed = await session.claimNext();
    assert.equal(claimed?.entry.taskId, "one");
    await advanceToCommitting(session, "one", claimed!.attempt.attemptId);
    completionCommit = B;
    await session.complete("one", claimed!.attempt.attemptId, completionCommit);
  });
  snapshot = await queue.snapshot();
  assert.equal(barrier(snapshot)?.taskId, "two", "a COMPLETED entry is skipped");

  await queue.command({ type: "dequeue", taskId: "two" });
  snapshot = await queue.snapshot();
  assert.equal(barrier(snapshot), undefined, "COMPLETED and DEQUEUED entries leave no barrier");
});

test("reconcileComplete finishes an attempt claimed under a prior fencing token", async () => {
  let milliseconds = Date.parse("2026-01-01T00:00:00.000Z");
  const { queue } = await fixture(() => new Date(milliseconds), 100);
  await queue.command(enqueue("one"));

  let attemptId = "";
  await queue.withDispatcher(async (oldSession) => {
    const claimed = await oldSession.claimNext();
    attemptId = claimed!.attempt.attemptId;
    await advanceToCommitting(oldSession, "one", attemptId);
    // Simulate a crash: the session ends without oldSession.complete() ever running.
  });

  milliseconds += 101; // expire the old lease so a new session gets a higher fence
  await queue.withDispatcher(async (newSession) => {
    // reconcileComplete must not require the attempt to match this session's
    // own fencing token — it exists specifically to finish work claimed
    // under a fence that no longer matches the current session's.
    const reconciled = await newSession.reconcileComplete("one", attemptId, B);
    const entry = reconciled.entries[0];
    assert.equal(entry.state, "COMPLETED");
    assert.equal(entry.completionCommit, B);
    assert.match(entry.attempts[0].events.at(-1)!.detail ?? "", /reconciled under replacement fence/);
  });
  assert.equal((await queue.snapshot()).expectedHead, B);
});

test("complete and reconcileComplete report identical wording for a replay conflict and a non-COMMITTING precondition failure", async () => {
  const { queue } = await fixture();
  await queue.command(enqueue("one"));
  await queue.withDispatcher(async (session) => {
    const claimed = await session.claimNext();
    const attemptId = claimed!.attempt.attemptId;
    // Not yet advanced to COMMITTING — both entry points must fail identically.
    await assert.rejects(session.complete("one", attemptId, B), /must be COMMITTING before completion/);
    await assert.rejects(session.reconcileComplete("one", attemptId, B), /must be COMMITTING before completion/);

    await advanceToCommitting(session, "one", attemptId);
    await session.complete("one", attemptId, B);
    // Exact replay of an already-completed attempt is idempotent...
    await assert.doesNotReject(session.complete("one", attemptId, B));
    await assert.doesNotReject(session.reconcileComplete("one", attemptId, B));
    // ...but a conflicting commit for the same attempt fails with the same wording either way.
    await assert.rejects(session.complete("one", attemptId, C), /Conflicting completion replay/);
    await assert.rejects(session.reconcileComplete("one", attemptId, C), /Conflicting completion replay/);
  });
});
