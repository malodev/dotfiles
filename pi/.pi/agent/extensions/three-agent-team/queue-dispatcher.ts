import type { TeamQueueTiming } from "./config.ts";
import type { SideEffectCapability } from "./durable-state.ts";
import { openDurableQueue, type DispatcherLease, type DurableQueue, type QueueEntry, type QueueSnapshot } from "./queue.ts";
import {
  acquireRepositoryExecutionLock,
  authorizeQueuedEntry,
  blockQueuedRepositoryTask,
  QUEUED_EXECUTION_BLOCKER,
  reconcileJournaledExactCommit,
  revalidateAuthorizedQueueEntry,
  revalidateQueuedHead,
  type RepositoryExecutionLock,
} from "./queue-repository.ts";

export interface DispatchResult {
  kind: "idle" | "paused" | "blocked" | "completed";
  taskId?: string;
  reason?: string;
  snapshot: QueueSnapshot;
}

export interface QueuedExecutionContext {
  readonly taskId: string;
  readonly attemptId: string;
  readonly expectedParent: string;
  readonly fencingToken: number;
  readonly capability: SideEffectCapability;
  markVerified(detail: string): Promise<void>;
  markCommitting(detail: string): Promise<void>;
  recordProcess(process: { role: "builder" | "reviewer"; pid: number; pgid: number; processStart: string }): Promise<void>;
  complete(commitSha: string): Promise<void>;
}

export interface QueueDispatcherOptions {
  queue?: DurableQueue;
  timing?: TeamQueueTiming;
  /** Tests and isolated installations only; production omits this passwd-rooted override. */
  stateRoot?: string;
  /** Tests may inject a validator wrapper; production uses the bundled validator. */
  validatorPath?: string;
  onStatus?: (message: string) => void;
  executor?: (execution: QueuedExecutionContext) => Promise<void>;
  /** Called after the repository lock is acquired, before dispatch proceeds. */
  onLockAcquired?: () => Promise<void>;
}

function firstBarrier(snapshot: QueueSnapshot): QueueEntry | undefined {
  return snapshot.entries.find((entry) => entry.state !== "COMPLETED" && entry.state !== "DEQUEUED");
}

function processGroupIsLive(pgid: number): boolean {
  try {
    // Negative PID targets the whole Unix process group, including descendants
    // left behind after the original group leader exits.
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    return true;
  }
}

async function assertAttemptProcessesQuiescent(entry: QueueEntry): Promise<void> {
  const attempt = entry.attempts.at(-1);
  if (!attempt) return;
  for (const child of attempt.processes) {
    if (processGroupIsLive(child.pgid)) {
      throw new Error(`Recovery blocked because recorded ${child.role} process group ${child.pgid} (leader ${child.pid}, ${child.processStart}) is still live`);
    }
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Dispatcher side-effect capability was aborted");
}

/**
 * Execute at most one safe dispatch step. This intentionally does not call a
 * model. Until exact reviewed-tree commit plumbing is available, a newly
 * authorized attempt leaves both repository and queue durably BLOCKED.
 */
export async function dispatchQueueOnce(repo: string, options: QueueDispatcherOptions = {}): Promise<DispatchResult> {
  const timing = options.timing ?? {
    leaseTtlSeconds: 120,
    heartbeatIntervalSeconds: 30,
    executionLockTimeoutSeconds: 30,
    localExpiryMarginSeconds: 15,
  };
  const queue = options.queue ?? await openDurableQueue(repo, {
    stateRoot: options.stateRoot,
    leaseTtlMs: timing.leaseTtlSeconds * 1000,
  });

  // Acquire the repository execution lock BEFORE the dispatcher lease.
  // This guarantees the fence check (onLockAcquired) runs before any queue
  // mutation, closing the window where a dispatcher lease bumps the queue
  // revision past an in-progress import's preimage.
  const abortController = new AbortController();
  const repoLock = await acquireRepositoryExecutionLock(
    repo,
    timing.executionLockTimeoutSeconds * 1000,
    options.stateRoot,
    abortController.signal,
  );
  try {
    // Fence check before lease: if an import is in progress, bail out now
    // without mutating any queue state.
    if (options.onLockAcquired) await options.onLockAcquired();

    return await queue.withDispatcher(async (session) => {
    let executionLock = repoLock;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatInFlight: Promise<void> | undefined;

    const abort = (error: unknown) => {
      if (!abortController.signal.aborted) {
        abortController.abort(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const assertLease = () => {
      if (abortController.signal.aborted) throw abortError(abortController.signal);
    };
    const assertRepositoryCapability = () => {
      assertLease();
      if (!executionLock) throw new Error("Repository execution lock has not been acquired");
      executionLock.assertHeld();
    };
    const capability: SideEffectCapability = {
      signal: abortController.signal,
      assertHeld: assertRepositoryCapability,
    };
    const armDeadlineFromLease = (lease: DispatcherLease | null) => {
      if (!lease || lease.fencingToken !== session.fencingToken) {
        abort(new Error(`Dispatcher fence ${session.fencingToken} is no longer current`));
        return;
      }
      if (deadlineTimer) clearTimeout(deadlineTimer);
      const deadline = Date.parse(lease.expiresAt) - timing.localExpiryMarginSeconds * 1000;
      const delay = deadline - Date.now();
      if (delay <= 0) {
        abort(new Error(`Dispatcher fence ${session.fencingToken} reached its lease safety deadline`));
        return;
      }
      deadlineTimer = setTimeout(() => {
        abort(new Error(`Dispatcher fence ${session.fencingToken} reached its lease safety deadline`));
      }, delay);
      deadlineTimer.unref();
    };
    const heartbeat = () => {
      if (heartbeatInFlight || abortController.signal.aborted) return;
      heartbeatInFlight = session.heartbeat()
        .then((fresh) => { armDeadlineFromLease(fresh.dispatcherLease); })
        .catch(abort)
        .finally(() => { heartbeatInFlight = undefined; });
    };

    try {
      // Set up deadline and heartbeat against the acquired lease.
      let snapshot = await session.assertCurrent();
      armDeadlineFromLease(snapshot.dispatcherLease);
      assertLease();
      heartbeatTimer = setInterval(heartbeat, timing.heartbeatIntervalSeconds * 1000);
      heartbeatTimer.unref();

      if (snapshot.paused) return { kind: "paused", snapshot };
      const barrier = firstBarrier(snapshot);
      if (!barrier) return { kind: "idle", snapshot };

      executionLock.signal.addEventListener("abort", () => abort(executionLock!.signal.reason), { once: true });
      assertRepositoryCapability();
      // Recheck after lease acquisition — the fence could have changed while
      // we waited for the queue lease. (The pre-lease check handles the common
      // case; this handles the race against a concurrent import finishing.)
      if (options.onLockAcquired) await options.onLockAcquired();
      assertRepositoryCapability();
      // Lock wait may have consumed most of a lease. Refresh.
      snapshot = await session.assertCurrent();
      armDeadlineFromLease(snapshot.dispatcherLease);
      assertRepositoryCapability();

      const currentBarrier = firstBarrier(snapshot);
      if (!currentBarrier || currentBarrier.taskId !== barrier.taskId || currentBarrier.state !== barrier.state) {
        throw new Error("Queue head changed while waiting for the repository execution lock");
      }

      // Never infer that a stale RUNNING attempt is safe to replay. Exclusive
      // repository-lock acquisition establishes cooperative quiescence, while
      // the unknown side-effect boundary still requires BLOCKED.
      if (barrier.state === "RUNNING") {
        const attempt = barrier.attempts.at(-1)!;
        const event = attempt.events.at(-1)!;
        if (event.phase === "COMMITTING") {
          await assertAttemptProcessesQuiescent(barrier);
          const exact = await reconcileJournaledExactCommit(repo, event.detail, snapshot.expectedHead!, capability);
          snapshot = await session.reconcileComplete(barrier.taskId, attempt.attemptId, exact.commitSha);
          return { kind: "completed", taskId: barrier.taskId, snapshot };
        }
        const reason = `Crash reconciliation blocked stale RUNNING attempt ${attempt.attemptId} at ${event.phase}; no uncertain role work was replayed`;
        assertRepositoryCapability();
        await blockQueuedRepositoryTask(repo, barrier.taskId, reason, capability);
        await session.assertCurrent();
        snapshot = await session.block(barrier.taskId, attempt.attemptId, reason);
        return { kind: "blocked", taskId: barrier.taskId, reason, snapshot };
      }
      if (barrier.state === "BLOCKED" && !barrier.recoveryApproval) {
        return { kind: "blocked", taskId: barrier.taskId, reason: barrier.attempts.at(-1)?.events.at(-1)?.detail ?? "blocked FIFO barrier", snapshot };
      }
      let claimed;
      if (barrier.state === "BLOCKED" && barrier.recoveryApproval) {
        assertRepositoryCapability();
        await assertAttemptProcessesQuiescent(barrier);
        claimed = await session.claimNext();
        if (!claimed) return { kind: "blocked", taskId: barrier.taskId, reason: "recovery approval could not be claimed", snapshot: await session.assertCurrent() };
        const recoveryDetail = JSON.stringify({
          recoveredAttempt: barrier.recoveryApproval.failedAttemptId,
          authorizationHead: claimed.entry.authorizationHead,
          contractDigest: claimed.entry.contractDigest,
        });
        await session.advance(claimed.entry.taskId, claimed.attempt.attemptId, "AUTHORIZING", recoveryDetail);
        await revalidateAuthorizedQueueEntry(
          repo,
          claimed.entry,
          snapshot.expectedHead!,
          capability,
          options.stateRoot,
          options.validatorPath,
        );
        await session.advance(claimed.entry.taskId, claimed.attempt.attemptId, "AUTHORIZED", recoveryDetail);
      } else {
        assertRepositoryCapability();
        await revalidateQueuedHead(repo, barrier, snapshot.expectedHead!, options.validatorPath, options.stateRoot);
        assertRepositoryCapability();
        await session.assertCurrent();
        claimed = await session.claimNext();
        if (!claimed) return { kind: "idle", snapshot: await session.assertCurrent() };
        await authorizeQueuedEntry(repo, claimed.entry, claimed.attempt.attemptId, session, capability, options.stateRoot, options.validatorPath);
      }
      options.onStatus?.(`${claimed.entry.taskId}: CLAIMED fence ${session.fencingToken}`);
      assertRepositoryCapability();
      await session.assertCurrent();

      if (!options.executor) {
        snapshot = await session.block(claimed.entry.taskId, claimed.attempt.attemptId, QUEUED_EXECUTION_BLOCKER);
        return { kind: "blocked", taskId: claimed.entry.taskId, reason: QUEUED_EXECUTION_BLOCKER, snapshot };
      }

      await session.advance(claimed.entry.taskId, claimed.attempt.attemptId, "EXECUTING");
      const execution: QueuedExecutionContext = Object.freeze({
        taskId: claimed.entry.taskId,
        attemptId: claimed.attempt.attemptId,
        expectedParent: claimed.entry.authorizationHead!,
        fencingToken: session.fencingToken,
        capability,
        markVerified: async (detail: string) => {
          assertRepositoryCapability();
          await session.advance(claimed.entry.taskId, claimed.attempt.attemptId, "VERIFIED", detail);
        },
        markCommitting: async (detail: string) => {
          assertRepositoryCapability();
          await session.advance(claimed.entry.taskId, claimed.attempt.attemptId, "COMMITTING", detail);
        },
        recordProcess: async (process: { role: "builder" | "reviewer"; pid: number; pgid: number; processStart: string }) => {
          assertRepositoryCapability();
          await session.recordProcess(claimed.entry.taskId, claimed.attempt.attemptId, process);
        },
        complete: async (commitSha: string) => {
          assertRepositoryCapability();
          await session.complete(claimed.entry.taskId, claimed.attempt.attemptId, commitSha);
        },
      });
      await options.executor(execution);
      const completed = await session.assertCurrent();
      const completedEntry = completed.entries.find((entry) => entry.taskId === claimed.entry.taskId);
      if (completedEntry?.state !== "COMPLETED") {
        throw new Error(`Queued executor returned without durably completing ${claimed.entry.taskId}`);
      }
      return { kind: "completed", taskId: claimed.entry.taskId, snapshot: completed };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const current = await session.assertCurrent().catch(() => undefined);
      const completed = current?.entries.find((entry) => entry.state === "COMPLETED" && entry.attempts.at(-1)?.fencingToken === session.fencingToken);
      if (completed) return { kind: "completed", taskId: completed.taskId, snapshot: current! };
      const running = current?.entries.find((entry) => entry.state === "RUNNING");
      if (running) {
        await blockQueuedRepositoryTask(repo, running.taskId, reason, capability).catch(() => undefined);
        const blocked = await session.block(running.taskId, running.attempts.at(-1)!.attemptId, reason).catch(() => current!);
        return { kind: "blocked", taskId: running.taskId, reason, snapshot: blocked };
      }
      throw error;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      await heartbeatInFlight?.catch(() => undefined);
    }
  }, { leaseTtlMs: timing.leaseTtlSeconds * 1000 });
  } finally {
    await repoLock.release().catch(() => undefined);
  }
}
