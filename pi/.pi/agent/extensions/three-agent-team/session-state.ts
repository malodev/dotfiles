/**
 * The extension's session state.
 *
 * One instance per threeAgentTeamExtension(pi) call, mirroring queue.ts's
 * openDurableQueue factory pattern: a frozen object closing over the
 * mutable state a running extension needs to track across commands and
 * events. Owns exactly what index.ts used to hold as nine free `let`
 * bindings — which run is active, which locks/leases are held outside a
 * run, and which architect chat turn (recovery, discussion, or
 * validation) is in progress — behind named operations instead of raw
 * slot access.
 *
 * Orchestration that merely *uses* this state (executeWorkflow,
 * finalizeRecovery, the extension's command and event handlers) stays in
 * index.ts, next to the file I/O and role-invocation helpers it already
 * depends on. This module's job is the bookkeeping, not the business
 * logic that triggers it.
 *
 * See CONTEXT.md for the domain terms.
 */

import type { AdvisoryLock, SideEffectCapability } from "./durable-state.ts";
import { activeRunDenial, releaseInteractiveGuard, releaseOwnedSlot } from "./core.ts";
import { barrier as queueBarrier, openDurableQueue } from "./queue.ts";
import { acquireRepositoryExecutionLock } from "./queue-repository.ts";
import type { QueuedExecutionContext } from "./queue-dispatcher.ts";
import type { TeamConfig } from "./config.ts";

export interface ActiveRun {
  taskId: string;
  abortController: AbortController;
  leaseOwner?: string;
  leaseAcquired?: boolean;
  leaseHeartbeat?: ReturnType<typeof setInterval>;
  leaseExpiryTimer?: ReturnType<typeof setTimeout>;
  leaseRenewing?: boolean;
  leaseFailure?: Error;
  abortAgent?: () => void;
  leaseRepo?: string;
  leaseConfig?: TeamConfig;
  legacyInferenceReady?: boolean;
  repositoryExecutionLock?: AdvisoryLock;
  queuedExecution?: QueuedExecutionContext;
  dispatcherCapability?: SideEffectCapability;
  expectedParent?: string;
  repositoryLockFailure?: Error;
}

export interface PendingArchitectValidation {
  repo: string;
  taskId: string;
  repairAttempts: number;
}

export interface PendingUnblockRecovery {
  repo: string;
  taskId: string;
  repositoryExecutionLock?: AdvisoryLock;
}

export type ArchitectStopReason = "stop" | "length" | "error" | "aborted" | "toolUse";

/** Minimal surface this module needs from ExtensionCommandContext-shaped values. */
interface NotifyingContext {
  ui: { notify(message: string, level: "info" | "warning" | "error"): void };
}
interface AbortableContext {
  abort(): void;
}

export interface SessionState {
  // Run lifecycle
  reserveRun(taskId: string): ActiveRun;
  releaseRun(run: ActiveRun): void;
  currentRun(): ActiveRun | undefined;
  workflowCapability(run: ActiveRun): SideEffectCapability;
  attachQueuedExecution(run: ActiveRun, execution: QueuedExecutionContext): void;
  attachRepositoryExecutionLock(run: ActiveRun, lock: AdvisoryLock): void;

  // Repository lock resolution
  currentRepositoryLock(): AdvisoryLock | undefined;
  withRepositoryMutationBoundary<T>(
    repo: string,
    action: string,
    callback: (lock: AdvisoryLock) => Promise<T>,
    opts?: { skipQueueCheck?: boolean },
  ): Promise<T>;

  // Interactive authorization guard
  currentInteractiveAuthorization(): string | undefined;
  setInteractiveAuthorization(taskId: string | undefined): void;
  releaseInteractiveAuthorization(taskId: string): void;

  // Interactive inference lease (raw storage; acquisition orchestration stays in index.ts)
  interactiveLease(): ActiveRun | undefined;
  setInteractiveLease(lease: ActiveRun | undefined): void;

  // Interactive repository lock (raw storage; acquisition orchestration stays in index.ts)
  interactiveRepositoryLock(): AdvisoryLock | undefined;
  setInteractiveRepositoryLock(lock: AdvisoryLock | undefined): void;
  releaseInteractiveRepositoryLock(): Promise<void>;

  // Idle check
  requireIdle(ctx: NotifyingContext, commandName: string): boolean;

  // Recovery / discussion / validation turns
  beginRecovery(repo: string, taskId: string, ctx: AbortableContext & NotifyingContext): Promise<PendingUnblockRecovery>;
  beginDiscussion(repo: string, taskId: string, ctx: AbortableContext & NotifyingContext): Promise<PendingUnblockRecovery>;
  beginValidation(repo: string, taskId: string): void;

  pendingRecovery(): PendingUnblockRecovery | undefined;
  activeDiscussion(): PendingUnblockRecovery | undefined;
  pendingValidation(): PendingArchitectValidation | undefined;

  clearRecovery(recovery: PendingUnblockRecovery): void;
  clearDiscussion(): void;
  clearValidation(): void;
  promoteToDiscussion(recovery: PendingUnblockRecovery): void;
  promoteToRecovery(discussion: PendingUnblockRecovery): void;

  ensureRecoveryExecutionLock(recovery: PendingUnblockRecovery, ctx: AbortableContext & NotifyingContext): Promise<AdvisoryLock>;
  releaseRecoveryExecutionLock(recovery: PendingUnblockRecovery): Promise<void>;

  // Architect stop reason
  recordArchitectStopReason(reason: ArchitectStopReason | undefined): void;
  takeArchitectStopReason(): ArchitectStopReason | undefined;

  // Shutdown
  shutdown(completionCwd: string): Promise<void>;
}

/** Same shape as index.ts's releaseInferenceLease — injected to avoid a circular import. */
export type ReleaseInferenceLease = (run: ActiveRun, repo: string, config: TeamConfig) => Promise<string | undefined>;

export async function assertImmediateQueueAvailable(repo: string, action: string): Promise<void> {
  const snapshot = await (await openDurableQueue(repo)).snapshot();
  const barrier = queueBarrier(snapshot);
  if (snapshot.dispatcherLease) {
    throw new Error(`${action} is blocked by dispatcher fence ${snapshot.dispatcherLease.fencingToken}; use /team-queue.`);
  }
  if (barrier) {
    throw new Error(`${action} cannot bypass queued task ${barrier.taskId} (${barrier.state}); use /team-continue, /team-unblock, or /team-dequeue as applicable.`);
  }
}

export function createSessionState(configuredTeam: TeamConfig, releaseInferenceLease: ReleaseInferenceLease): SessionState {
  let activeRun: ActiveRun | undefined;
  let interactiveInferenceLease: ActiveRun | undefined;
  let interactiveRepositoryLockValue: AdvisoryLock | undefined;
  let scopedRepositoryLock: AdvisoryLock | undefined;
  let authorizedInteractiveTaskId: string | undefined;
  let pendingArchitectValidation: PendingArchitectValidation | undefined;
  let pendingUnblockRecovery: PendingUnblockRecovery | undefined;
  let activeUnblockDiscussion: PendingUnblockRecovery | undefined;
  let pendingArchitectStopReason: ArchitectStopReason | undefined;

  const reserveRun = (taskId: string): ActiveRun => {
    const denial = activeRunDenial(activeRun?.taskId, "team workflow launch");
    if (denial) throw new Error(denial);
    const run: ActiveRun = { taskId, abortController: new AbortController() };
    activeRun = run;
    return run;
  };

  const releaseRun = (run: ActiveRun): void => {
    activeRun = releaseOwnedSlot(activeRun, run);
  };

  const workflowCapability = (run: ActiveRun): SideEffectCapability => {
    const capability = run.dispatcherCapability ?? run.repositoryExecutionLock;
    if (!capability) throw new Error(`Workflow ${run.taskId} has no repository side-effect capability`);
    capability.assertHeld();
    return capability;
  };

  const attachQueuedExecution = (run: ActiveRun, execution: QueuedExecutionContext): void => {
    run.queuedExecution = execution;
    run.dispatcherCapability = execution.capability;
    run.expectedParent = execution.expectedParent;
    execution.capability.signal.addEventListener("abort", () => {
      run.repositoryLockFailure = execution.capability.signal.reason instanceof Error
        ? execution.capability.signal.reason
        : new Error("Queued dispatcher capability was lost");
      run.abortController.abort(run.repositoryLockFailure);
      run.abortAgent?.();
    }, { once: true });
  };

  const attachRepositoryExecutionLock = (run: ActiveRun, lock: AdvisoryLock): void => {
    run.repositoryExecutionLock = lock;
    lock.signal.addEventListener("abort", () => {
      run.repositoryLockFailure = lock.signal.reason instanceof Error
        ? lock.signal.reason
        : new Error("Repository execution lock was lost");
      run.abortController.abort(run.repositoryLockFailure);
      run.abortAgent?.();
    }, { once: true });
  };

  const currentRepositoryLock = (): AdvisoryLock | undefined =>
    activeRun?.repositoryExecutionLock
    ?? pendingUnblockRecovery?.repositoryExecutionLock
    ?? activeUnblockDiscussion?.repositoryExecutionLock
    ?? interactiveRepositoryLockValue
    ?? scopedRepositoryLock;

  const withRepositoryMutationBoundary = async <T>(
    repo: string,
    action: string,
    callback: (lock: AdvisoryLock) => Promise<T>,
    opts?: { skipQueueCheck?: boolean },
  ): Promise<T> => {
    const existing = currentRepositoryLock();
    if (existing) {
      existing.assertHeld();
      if (!opts?.skipQueueCheck) await assertImmediateQueueAvailable(repo, action);
      existing.assertHeld();
      return callback(existing);
    }
    const lock = await acquireRepositoryExecutionLock(repo, configuredTeam.queue.executionLockTimeoutSeconds * 1000);
    const previousScopedLock = scopedRepositoryLock;
    try {
      scopedRepositoryLock = lock;
      lock.assertHeld();
      if (!opts?.skipQueueCheck) await assertImmediateQueueAvailable(repo, action);
      lock.assertHeld();
      return await callback(lock);
    } finally {
      scopedRepositoryLock = previousScopedLock;
      await lock.release();
    }
  };

  const requireIdle = (ctx: NotifyingContext, commandName: string): boolean => {
    const recoveryTask = pendingUnblockRecovery?.taskId ?? activeUnblockDiscussion?.taskId;
    if (recoveryTask) {
      ctx.ui.notify(`Task ${recoveryTask} has an active recovery discussion or finalization; /${commandName} must wait.`, "warning");
      return false;
    }
    const denial = activeRunDenial(activeRun?.taskId, commandName);
    if (!denial) return true;
    ctx.ui.notify(denial, "warning");
    return false;
  };

  const ensureRecoveryExecutionLock = async (
    recovery: PendingUnblockRecovery,
    ctx: AbortableContext & NotifyingContext,
  ): Promise<AdvisoryLock> => {
    if (recovery.repositoryExecutionLock) {
      recovery.repositoryExecutionLock.assertHeld();
      return recovery.repositoryExecutionLock;
    }
    const lock = await acquireRepositoryExecutionLock(recovery.repo, configuredTeam.queue.executionLockTimeoutSeconds * 1000);
    try {
      lock.assertHeld();
      const queueSnapshot = await (await openDurableQueue(recovery.repo)).snapshot();
      if (queueSnapshot.dispatcherLease) throw new Error(`Queue dispatcher fence ${queueSnapshot.dispatcherLease.fencingToken} is active; retry recovery after it releases.`);
      const barrier = queueBarrier(queueSnapshot);
      if (barrier && (barrier.taskId !== recovery.taskId || barrier.state !== "BLOCKED")) {
        throw new Error(`Task ${barrier.taskId} (${barrier.state}) is the durable queue barrier; ${recovery.taskId} cannot bypass it.`);
      }
      recovery.repositoryExecutionLock = lock;
      lock.signal.addEventListener("abort", () => {
        if (activeUnblockDiscussion === recovery) activeUnblockDiscussion = undefined;
        if (pendingUnblockRecovery === recovery) pendingUnblockRecovery = undefined;
        ctx.abort();
        ctx.ui.notify(`Recovery for ${recovery.taskId} stopped because the repository execution lock was lost.`, "error");
      }, { once: true });
      return lock;
    } catch (error) {
      await lock.release().catch(() => undefined);
      throw error;
    }
  };

  const releaseRecoveryExecutionLock = async (recovery: PendingUnblockRecovery): Promise<void> => {
    const lock = recovery.repositoryExecutionLock;
    recovery.repositoryExecutionLock = undefined;
    if (lock) await lock.release().catch(() => undefined);
  };

  const beginRecovery = async (repo: string, taskId: string, ctx: AbortableContext & NotifyingContext): Promise<PendingUnblockRecovery> => {
    const existing = pendingUnblockRecovery?.taskId === taskId ? pendingUnblockRecovery
      : activeUnblockDiscussion?.taskId === taskId ? activeUnblockDiscussion
      : undefined;
    pendingUnblockRecovery = existing ?? { repo, taskId };
    await ensureRecoveryExecutionLock(pendingUnblockRecovery, ctx);
    activeUnblockDiscussion = undefined;
    authorizedInteractiveTaskId = taskId;
    pendingArchitectStopReason = undefined;
    return pendingUnblockRecovery;
  };

  const beginDiscussion = async (repo: string, taskId: string, ctx: AbortableContext & NotifyingContext): Promise<PendingUnblockRecovery> => {
    const existing = activeUnblockDiscussion?.taskId === taskId ? activeUnblockDiscussion : undefined;
    activeUnblockDiscussion = existing ?? { repo, taskId };
    await ensureRecoveryExecutionLock(activeUnblockDiscussion, ctx);
    authorizedInteractiveTaskId = taskId;
    pendingArchitectStopReason = undefined;
    return activeUnblockDiscussion;
  };

  const beginValidation = (repo: string, taskId: string): void => {
    pendingArchitectValidation = { repo, taskId, repairAttempts: 0 };
    pendingArchitectStopReason = undefined;
  };

  const releaseInteractiveRepositoryLock = async (): Promise<void> => {
    const lock = interactiveRepositoryLockValue;
    interactiveRepositoryLockValue = undefined;
    if (lock) await lock.release().catch(() => undefined);
  };

  const shutdown = async (completionCwd: string): Promise<void> => {
    const workflow = activeRun;
    workflow?.abortController.abort();
    if (workflow?.leaseOwner && workflow.leaseRepo && workflow.leaseConfig) {
      await releaseInferenceLease(workflow, workflow.leaseRepo, workflow.leaseConfig).catch(() => undefined);
    }
    if (workflow?.repositoryExecutionLock) {
      await workflow.repositoryExecutionLock.release().catch(() => undefined);
      workflow.repositoryExecutionLock = undefined;
    }
    const lease = interactiveInferenceLease;
    interactiveInferenceLease = undefined;
    if (lease) await releaseInferenceLease(lease, completionCwd, configuredTeam).catch(() => undefined);
    await releaseInteractiveRepositoryLock();
    // Session contexts are not reusable. Release recovery ownership now; a
    // replacement session must reacquire and revalidate the durable evidence.
    const recovery = pendingUnblockRecovery ?? activeUnblockDiscussion;
    if (recovery?.repositoryExecutionLock) await releaseRecoveryExecutionLock(recovery);
  };

  return Object.freeze({
    reserveRun,
    releaseRun,
    currentRun: () => activeRun,
    workflowCapability,
    attachQueuedExecution,
    attachRepositoryExecutionLock,

    currentRepositoryLock,
    withRepositoryMutationBoundary,

    currentInteractiveAuthorization: () => authorizedInteractiveTaskId,
    setInteractiveAuthorization: (taskId: string | undefined) => { authorizedInteractiveTaskId = taskId; },
    releaseInteractiveAuthorization: (taskId: string) => {
      authorizedInteractiveTaskId = releaseInteractiveGuard(authorizedInteractiveTaskId, taskId);
    },

    interactiveLease: () => interactiveInferenceLease,
    setInteractiveLease: (lease: ActiveRun | undefined) => { interactiveInferenceLease = lease; },

    interactiveRepositoryLock: () => interactiveRepositoryLockValue,
    setInteractiveRepositoryLock: (lock: AdvisoryLock | undefined) => { interactiveRepositoryLockValue = lock; },
    releaseInteractiveRepositoryLock,

    requireIdle,

    beginRecovery,
    beginDiscussion,
    beginValidation,

    pendingRecovery: () => pendingUnblockRecovery,
    activeDiscussion: () => activeUnblockDiscussion,
    pendingValidation: () => pendingArchitectValidation,

    clearRecovery: (recovery: PendingUnblockRecovery) => {
      if (pendingUnblockRecovery === recovery) pendingUnblockRecovery = undefined;
    },
    clearDiscussion: () => { activeUnblockDiscussion = undefined; },
    clearValidation: () => { pendingArchitectValidation = undefined; },
    promoteToDiscussion: (recovery: PendingUnblockRecovery) => { activeUnblockDiscussion = recovery; },
    promoteToRecovery: (discussion: PendingUnblockRecovery) => { pendingUnblockRecovery = discussion; },

    ensureRecoveryExecutionLock,
    releaseRecoveryExecutionLock,

    recordArchitectStopReason: (reason: ArchitectStopReason | undefined) => { pendingArchitectStopReason = reason; },
    takeArchitectStopReason: () => {
      const reason = pendingArchitectStopReason;
      pendingArchitectStopReason = undefined;
      return reason;
    },

    shutdown,
  });
}
