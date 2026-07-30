import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, chmod, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { openDurableQueue, type EnqueueCommand } from "./queue.ts";

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
