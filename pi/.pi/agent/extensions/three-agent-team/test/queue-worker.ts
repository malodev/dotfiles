import { openDurableQueue } from "../queue.ts";
import { acquireAdvisoryLock } from "../durable-state.ts";

const [mode, repo, stateRoot, ...args] = process.argv.slice(2);
const A = "a".repeat(40);
const D1 = "1".repeat(64);
const D2 = "2".repeat(64);
if (!mode || !repo || !stateRoot) throw new Error("worker usage: <mode> <repo> <stateRoot> [...]");

if (mode === "enqueue") {
  const queue = await openDurableQueue(repo, { stateRoot, lockTimeoutMs: 30_000 });
  for (const id of args) {
    await queue.command({
      type: "enqueue", taskId: id, dependsOn: [], baselineCommit: A, expectedHead: A,
      approvedBriefDigest: D1, contractDigest: D2, ownerPrincipal: `worker:${process.pid}`,
      approvedAt: `2026-01-01T00:00:${String(Number(id.replace(/\D/g, "")) % 60).padStart(2, "0")}.000Z`,
      completionPolicy: { commitOnSuccess: true, pushOnSuccess: false, deployOnSuccess: false },
    });
  }
  process.stdout.write("done\n");
} else if (mode === "duplicate") {
  const queue = await openDurableQueue(repo, { stateRoot, lockTimeoutMs: 30_000 });
  const id = args[0];
  for (let index = 0; index < 10; index++) {
    await queue.command({
      type: "enqueue", taskId: id, dependsOn: [], baselineCommit: A, expectedHead: A,
      approvedBriefDigest: D1, contractDigest: D2, ownerPrincipal: "duplicate-owner",
      approvedAt: "2026-01-01T00:00:00.000Z",
      completionPolicy: { commitOnSuccess: true, pushOnSuccess: false, deployOnSuccess: false },
    });
  }
  process.stdout.write("done\n");
} else if (mode === "claim-hold") {
  const queue = await openDurableQueue(repo, { stateRoot, lockTimeoutMs: 30_000, leaseTtlMs: 1_000 });
  await queue.withDispatcher(async (session) => {
    const claimed = await session.claimNext();
    process.stdout.write(`claimed ${claimed?.attempt.attemptId ?? "none"} ${session.fencingToken}\n`);
    await new Promise(() => undefined);
  }, { leaseTtlMs: 1_000 });
} else if (mode === "hold-lock") {
  const lock = await acquireAdvisoryLock(args[0], "integration holder", { timeoutMs: 10_000 });
  process.stdout.write(`locked ${lock.brokerPid}\n`);
  await new Promise<void>((lost) => lock.signal.addEventListener("abort", () => lost(), { once: true }));
  try { lock.assertHeld(); }
  catch (error) { process.stdout.write(`lost ${(error as Error).message}\n`); }
} else {
  throw new Error(`unknown worker mode ${mode}`);
}
