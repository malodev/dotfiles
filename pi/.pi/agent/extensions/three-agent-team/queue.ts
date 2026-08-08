import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  canonicalJson,
  createLockOwner,
  durableReplaceJson,
  readSecureJson,
  repositoryStatePaths,
  withAdvisoryLock,
  type AdvisoryLock,
  type AdvisoryLockOwner,
} from "./durable-state.ts";
import { isSha1, isSha256, isTaskId } from "./core.ts";

const SCHEMA_VERSION = 1 as const;
const ENTRY_STATES = ["QUEUED", "RUNNING", "BLOCKED", "COMPLETED", "DEQUEUED"] as const;
const PHASES = ["CLAIMED", "AUTHORIZING", "AUTHORIZED", "EXECUTING", "VERIFIED", "COMMITTING", "COMPLETED", "BLOCKED"] as const;
const LINEAR_PHASES = PHASES.slice(0, -1);

export type QueueEntryState = typeof ENTRY_STATES[number];
export type DispatchPhase = typeof PHASES[number];
export type AttemptKind = "INITIAL" | "RECOVERY";

export interface QueueCompletionPolicy {
  commitOnSuccess: true;
  pushOnSuccess: false;
  deployOnSuccess: false;
}

export interface QueueOwnerIdentity {
  uid: number;
  hostname: string;
  pid: number;
  processStart: string;
  ownerId: string;
}

export interface DispatcherLease {
  owner: QueueOwnerIdentity;
  fencingToken: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface DispatchEvent {
  phase: DispatchPhase;
  at: string;
  detail: string | null;
  completionCommit: string | null;
}

export interface DispatchProcessIdentity {
  role: "builder" | "reviewer";
  pid: number;
  pgid: number;
  processStart: string;
  recordedAt: string;
}

export interface DispatchAttempt {
  attemptId: string;
  kind: AttemptKind;
  fencingToken: number;
  owner: QueueOwnerIdentity;
  startedAt: string;
  processes: DispatchProcessIdentity[];
  events: DispatchEvent[];
}

export interface RecoveryApproval {
  failedAttemptId: string;
  approvedBy: string;
  approvedAt: string;
  queueRevision: number;
}

export interface QueueEntry {
  taskId: string;
  sequence: number;
  state: QueueEntryState;
  dependsOn: string[];
  baselineCommit: string;
  /** Repository HEAD observed and approved at enrollment. */
  expectedHead: string;
  approvedBriefDigest: string;
  contractDigest: string;
  ownerPrincipal: string;
  approvedAt: string;
  approvalSource: "/team-enqueue";
  completionPolicy: QueueCompletionPolicy;
  authorizationHead: string | null;
  completionCommit: string | null;
  attempts: DispatchAttempt[];
  recoveryApproval: RecoveryApproval | null;
}

export interface QueueSnapshot {
  version: 1;
  repository: string;
  repositoryKey: string;
  uid: number;
  revision: number;
  nextSequence: number;
  nextFencingToken: number;
  expectedHead: string | null;
  paused: boolean;
  dispatcherLease: DispatcherLease | null;
  entries: QueueEntry[];
}

export interface EnqueueCommand {
  type: "enqueue";
  taskId: string;
  dependsOn: string[];
  baselineCommit: string;
  expectedHead: string;
  approvedBriefDigest: string;
  contractDigest: string;
  ownerPrincipal: string;
  approvedAt: string;
  approvalSource?: "/team-enqueue";
  completionPolicy: QueueCompletionPolicy;
  expectedRevision?: number;
}

export interface BulkEnqueueCommand {
  type: "bulkEnqueue";
  entries: Omit<EnqueueCommand, "type" | "expectedRevision">[];
  expectedRevision?: number;
}

export interface AmendQueuedContractsCommand {
  type: "amendQueuedContracts";
  expectedHead: string;
  newExpectedHead: string;
  amendments: Array<{
    taskId: string;
    expectedApprovedBriefDigest: string;
    expectedContractDigest: string;
    approvedBriefDigest: string;
    contractDigest: string;
  }>;
  expectedRevision: number;
}

/**
 * Atomic import enrollment.  Stricter than bulkEnqueue:
 *  - Requires the exact preimage queue state (revision, expectedHead, paused,
 *    nextSequence) rather than just CAS.
 *  - Sets new expectedHead to the import commit after enrollment.
 *  - Returns a no-op when every intended tuple and postimage already match.
 */
export interface BulkImportEnqueueCommand {
  type: "bulkImportEnqueue";
  entries: Omit<EnqueueCommand, "type" | "expectedRevision">[];
  /** Queue preimage that must match before any write. */
  preimage: {
    revision: number;
    expectedHead: string | null;
    paused: boolean;
    nextSequence: number;
  };
  /** New expected head after enrollment (the import commit SHA). */
  newExpectedHead: string;
}

export type QueueCommand =
  | EnqueueCommand
  | BulkEnqueueCommand
  | AmendQueuedContractsCommand
  | BulkImportEnqueueCommand
  | { type: "pause"; expectedRevision?: number }
  | { type: "continue"; expectedRevision?: number }
  | { type: "dequeue"; taskId: string; expectedRevision?: number }
  | { type: "recover"; taskId: string; failedAttemptId: string; approvedBy: string; approvedAt: string; expectedRevision: number };

export interface CommandResult {
  changed: boolean;
  snapshot: QueueSnapshot;
}

export interface DispatcherSession {
  readonly owner: QueueOwnerIdentity;
  readonly fencingToken: number;
  heartbeat(expectedRevision?: number): Promise<QueueSnapshot>;
  claimNext(expectedRevision?: number): Promise<{ entry: QueueEntry; attempt: DispatchAttempt; snapshot: QueueSnapshot } | undefined>;
  advance(taskId: string, attemptId: string, phase: Exclude<DispatchPhase, "CLAIMED" | "BLOCKED" | "COMPLETED">, detail?: string, expectedRevision?: number): Promise<QueueSnapshot>;
  recordProcess(taskId: string, attemptId: string, process: Omit<DispatchProcessIdentity, "recordedAt">, expectedRevision?: number): Promise<QueueSnapshot>;
  block(taskId: string, attemptId: string, reason: string, expectedRevision?: number): Promise<QueueSnapshot>;
  complete(taskId: string, attemptId: string, completionCommit: string, expectedRevision?: number): Promise<QueueSnapshot>;
  /** Complete only an exact stale COMMITTING journal under the replacement fence. */
  reconcileComplete(taskId: string, attemptId: string, completionCommit: string, expectedRevision?: number): Promise<QueueSnapshot>;
  assertCurrent(): Promise<QueueSnapshot>;
}

export interface DurableQueue {
  snapshot(): Promise<QueueSnapshot>;
  command(command: QueueCommand): Promise<CommandResult>;
  withDispatcher<T>(callback: (session: DispatcherSession) => Promise<T>, options?: DispatcherOptions): Promise<T>;
}

export interface DurableQueueOptions {
  /** Tests only. Production callers must omit this passwd-rooted override. */
  stateRoot?: string;
  lockTimeoutMs?: number;
  leaseTtlMs?: number;
  now?: () => Date;
}

export interface DispatcherOptions {
  owner?: Partial<Omit<AdvisoryLockOwner, "uid" | "acquiredAt" | "purpose">>;
  leaseTtlMs?: number;
}

function fail(message: string): never { throw new Error(`Invalid durable queue: ${message}`); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...fields].sort();
  if (actual.length !== wanted.length || actual.some((field, index) => field !== wanted[index])) {
    fail(`${label} has unknown or missing fields`);
  }
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) fail(`${label} must be a non-empty string`);
  return value;
}
function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail(`${label} must be an integer >= ${minimum}`);
  return Number(value);
}
function timestamp(value: unknown, label: string): string {
  const text = string(value, label);
  if (!Number.isFinite(Date.parse(text))) fail(`${label} must be an ISO timestamp`);
  return text;
}
function sha(value: unknown, matches: (value: string) => boolean, label: string): string {
  const text = string(value, label);
  if (!matches(text)) fail(`${label} has the wrong digest format`);
  return text;
}
function nullableSha(value: unknown, matches: (value: string) => boolean, label: string): string | null {
  return value === null ? null : sha(value, matches, label);
}
function taskId(value: unknown, label: string): string {
  const text = string(value, label);
  if (!isTaskId(text)) fail(`${label} is invalid`);
  return text;
}
function clone<T>(value: T): T { return structuredClone(value); }
function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }

const OWNER_FIELDS = ["uid", "hostname", "pid", "processStart", "ownerId"] as const;
function parseOwner(value: unknown, uid: number, label: string): QueueOwnerIdentity {
  if (!isRecord(value)) fail(`${label} must be an object`);
  exact(value, OWNER_FIELDS, label);
  const owner: QueueOwnerIdentity = {
    uid: integer(value.uid, `${label}.uid`),
    hostname: string(value.hostname, `${label}.hostname`),
    pid: integer(value.pid, `${label}.pid`, 1),
    processStart: string(value.processStart, `${label}.processStart`),
    ownerId: string(value.ownerId, `${label}.ownerId`),
  };
  if (owner.uid !== uid) fail(`${label}.uid does not own this queue`);
  return owner;
}

function parsePolicy(value: unknown, label: string): QueueCompletionPolicy {
  if (!isRecord(value)) fail(`${label} must be an object`);
  exact(value, ["commitOnSuccess", "pushOnSuccess", "deployOnSuccess"], label);
  if (value.commitOnSuccess !== true || value.pushOnSuccess !== false || value.deployOnSuccess !== false) {
    fail(`${label} must require commit and prohibit push/deploy`);
  }
  return value as unknown as QueueCompletionPolicy;
}

function parseEvent(value: unknown, label: string): DispatchEvent {
  if (!isRecord(value)) fail(`${label} must be an object`);
  exact(value, ["phase", "at", "detail", "completionCommit"], label);
  if (!PHASES.includes(value.phase as DispatchPhase)) fail(`${label}.phase is invalid`);
  if (value.detail !== null && typeof value.detail !== "string") fail(`${label}.detail is invalid`);
  return {
    phase: value.phase as DispatchPhase,
    at: timestamp(value.at, `${label}.at`),
    detail: value.detail as string | null,
    completionCommit: nullableSha(value.completionCommit, isSha1, `${label}.completionCommit`),
  };
}

function parseAttempt(value: unknown, uid: number, label: string): DispatchAttempt {
  if (!isRecord(value)) fail(`${label} must be an object`);
  exact(value, ["attemptId", "kind", "fencingToken", "owner", "startedAt", "processes", "events"], label);
  if (value.kind !== "INITIAL" && value.kind !== "RECOVERY") fail(`${label}.kind is invalid`);
  if (!Array.isArray(value.processes)) fail(`${label}.processes must be an array`);
  const processes = value.processes.map((item, index): DispatchProcessIdentity => {
    const processLabel = `${label}.processes[${index}]`;
    if (!isRecord(item)) fail(`${processLabel} must be an object`);
    exact(item, ["role", "pid", "pgid", "processStart", "recordedAt"], processLabel);
    if (item.role !== "builder" && item.role !== "reviewer") fail(`${processLabel}.role is invalid`);
    return {
      role: item.role,
      pid: integer(item.pid, `${processLabel}.pid`, 1),
      pgid: integer(item.pgid, `${processLabel}.pgid`, 1),
      processStart: string(item.processStart, `${processLabel}.processStart`),
      recordedAt: timestamp(item.recordedAt, `${processLabel}.recordedAt`),
    };
  });
  const processKeys = processes.map((item) => `${item.pid}:${item.processStart}`);
  if (new Set(processKeys).size !== processKeys.length) fail(`${label}.processes contains duplicate identities`);
  if (!Array.isArray(value.events) || value.events.length < 1) fail(`${label}.events must be non-empty`);
  const events = value.events.map((event, index) => parseEvent(event, `${label}.events[${index}]`));
  const startedAt = timestamp(value.startedAt, `${label}.startedAt`);
  if (events[0].phase !== "CLAIMED" || events[0].at !== startedAt) fail(`${label} must begin at CLAIMED at startedAt`);
  if (processes.some((process) => Date.parse(process.recordedAt) < Date.parse(startedAt))) fail(`${label} records a process before attempt start`);
  if (processes.length && !events.some((event) => event.phase === "EXECUTING")) fail(`${label} records a process before EXECUTING`);
  let terminal = false;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (terminal) fail(`${label} has events after a terminal event`);
    if (event.phase === "BLOCKED") {
      terminal = true;
      if (!event.detail?.trim() || event.completionCommit !== null) fail(`${label} BLOCKED event is malformed`);
      continue;
    }
    const expected = LINEAR_PHASES[index];
    if (event.phase !== expected) fail(`${label} skips or reorders phase ${expected}`);
    if (event.phase === "COMPLETED") {
      terminal = true;
      if (!event.completionCommit) fail(`${label} completed without commit`);
    } else if (event.completionCommit !== null) fail(`${label} records a commit before completion`);
  }
  return {
    attemptId: string(value.attemptId, `${label}.attemptId`),
    kind: value.kind,
    fencingToken: integer(value.fencingToken, `${label}.fencingToken`, 1),
    owner: parseOwner(value.owner, uid, `${label}.owner`),
    startedAt,
    processes,
    events,
  };
}

function parseRecovery(value: unknown, label: string): RecoveryApproval | null {
  if (value === null) return null;
  if (!isRecord(value)) fail(`${label} must be an object or null`);
  exact(value, ["failedAttemptId", "approvedBy", "approvedAt", "queueRevision"], label);
  return {
    failedAttemptId: string(value.failedAttemptId, `${label}.failedAttemptId`),
    approvedBy: string(value.approvedBy, `${label}.approvedBy`),
    approvedAt: timestamp(value.approvedAt, `${label}.approvedAt`),
    queueRevision: integer(value.queueRevision, `${label}.queueRevision`),
  };
}

function parseEntry(value: unknown, uid: number, label: string): QueueEntry {
  if (!isRecord(value)) fail(`${label} must be an object`);
  exact(value, [
    "taskId", "sequence", "state", "dependsOn", "baselineCommit", "expectedHead", "approvedBriefDigest", "contractDigest",
    "ownerPrincipal", "approvedAt", "approvalSource", "completionPolicy", "authorizationHead", "completionCommit",
    "attempts", "recoveryApproval",
  ], label);
  if (!ENTRY_STATES.includes(value.state as QueueEntryState)) fail(`${label}.state is invalid`);
  if (!Array.isArray(value.dependsOn)) fail(`${label}.dependsOn must be an array`);
  const dependsOn = value.dependsOn.map((item, index) => taskId(item, `${label}.dependsOn[${index}]`));
  if (new Set(dependsOn).size !== dependsOn.length) fail(`${label}.dependsOn contains duplicates`);
  if (!Array.isArray(value.attempts)) fail(`${label}.attempts must be an array`);
  const attempts = value.attempts.map((attempt, index) => parseAttempt(attempt, uid, `${label}.attempts[${index}]`));
  const attemptIds = new Set<string>();
  let priorFence = 0;
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    if (attemptIds.has(attempt.attemptId)) fail(`${label} has duplicate attempt IDs`);
    if (attempt.fencingToken <= priorFence) fail(`${label} attempt fencing tokens are not strictly increasing`);
    if ((index === 0 && attempt.kind !== "INITIAL") || (index > 0 && attempt.kind !== "RECOVERY")) fail(`${label} attempt kinds are reordered`);
    attemptIds.add(attempt.attemptId);
    priorFence = attempt.fencingToken;
  }
  const entry: QueueEntry = {
    taskId: taskId(value.taskId, `${label}.taskId`),
    sequence: integer(value.sequence, `${label}.sequence`, 1),
    state: value.state as QueueEntryState,
    dependsOn,
    baselineCommit: sha(value.baselineCommit, isSha1, `${label}.baselineCommit`),
    expectedHead: sha(value.expectedHead, isSha1, `${label}.expectedHead`),
    approvedBriefDigest: sha(value.approvedBriefDigest, isSha256, `${label}.approvedBriefDigest`),
    contractDigest: sha(value.contractDigest, isSha256, `${label}.contractDigest`),
    ownerPrincipal: string(value.ownerPrincipal, `${label}.ownerPrincipal`),
    approvedAt: timestamp(value.approvedAt, `${label}.approvedAt`),
    approvalSource: value.approvalSource === "/team-enqueue" ? "/team-enqueue" : fail(`${label}.approvalSource is invalid`),
    completionPolicy: parsePolicy(value.completionPolicy, `${label}.completionPolicy`),
    authorizationHead: nullableSha(value.authorizationHead, isSha1, `${label}.authorizationHead`),
    completionCommit: nullableSha(value.completionCommit, isSha1, `${label}.completionCommit`),
    attempts,
    recoveryApproval: parseRecovery(value.recoveryApproval, `${label}.recoveryApproval`),
  };
  const last = attempts.at(-1)?.events.at(-1);
  if (entry.state === "QUEUED" && (attempts.length || entry.authorizationHead || entry.completionCommit || entry.recoveryApproval)) fail(`${label} QUEUED invariants fail`);
  if (entry.state === "DEQUEUED" && attempts.length) fail(`${label} DEQUEUED entry was dispatched`);
  if (["RUNNING", "BLOCKED", "COMPLETED"].includes(entry.state) && (!attempts.length || !entry.authorizationHead)) fail(`${label} dispatched invariants fail`);
  if (entry.state === "RUNNING" && (last?.phase === "BLOCKED" || last?.phase === "COMPLETED")) fail(`${label} RUNNING has terminal attempt`);
  if (entry.state === "BLOCKED" && last?.phase !== "BLOCKED") fail(`${label} BLOCKED lacks terminal attempt`);
  if (entry.state === "COMPLETED" && (last?.phase !== "COMPLETED" || entry.completionCommit !== last.completionCommit)) fail(`${label} COMPLETED commit mismatch`);
  if (entry.state !== "COMPLETED" && entry.completionCommit) fail(`${label} has premature completion commit`);
  return entry;
}

/** Not yet terminal: excludes COMPLETED and DEQUEUED. QUEUED/RUNNING/BLOCKED all count. */
function isNonterminal(entry: QueueEntry): boolean {
  return entry.state !== "COMPLETED" && entry.state !== "DEQUEUED";
}

/** The earliest nonterminal FIFO entry — the only runnable entry, and the queue-wide barrier for everything behind it. */
export function barrier(snapshot: QueueSnapshot): QueueEntry | undefined {
  return snapshot.entries.find(isNonterminal);
}

const SNAPSHOT_FIELDS = [
  "version", "repository", "repositoryKey", "uid", "revision", "nextSequence", "nextFencingToken", "expectedHead",
  "paused", "dispatcherLease", "entries",
] as const;
function validateSnapshot(value: unknown, repository: string, repositoryKey: string, uid: number): QueueSnapshot {
  if (!isRecord(value)) fail("snapshot must be an object");
  exact(value, SNAPSHOT_FIELDS, "snapshot");
  if (value.version !== SCHEMA_VERSION || value.repository !== repository || value.repositoryKey !== repositoryKey || value.uid !== uid) {
    fail("repository identity or schema version mismatch");
  }
  if (typeof value.paused !== "boolean" || !Array.isArray(value.entries)) fail("snapshot fields have invalid types");
  const revision = integer(value.revision, "revision");
  const entries = value.entries.map((entry, index) => parseEntry(entry, uid, `entries[${index}]`));
  const ids = new Set<string>();
  const sequences = new Set<number>();
  let previousSequence = 0;
  let nonterminalSeen = false;
  let activeBarrierSeen = false;
  let chainHead: string | null = null;
  const expectedHead = nullableSha(value.expectedHead, isSha1, "expectedHead");
  for (const entry of entries) {
    if (ids.has(entry.taskId) || sequences.has(entry.sequence) || entry.sequence <= previousSequence) fail("entry IDs/sequences are duplicate or reordered");
    ids.add(entry.taskId); sequences.add(entry.sequence); previousSequence = entry.sequence;
    for (const dependency of entry.dependsOn) {
      const prior = entries.find((candidate) => candidate.taskId === dependency);
      if (!prior || prior.sequence >= entry.sequence || prior.state === "DEQUEUED") fail(`${entry.taskId} has a non-earlier/dequeued dependency`);
    }
    if (entry.recoveryApproval && entry.recoveryApproval.queueRevision >= revision) fail(`${entry.taskId} recovery approval has an impossible queue revision`);
    if (entry.state === "COMPLETED") {
      if (nonterminalSeen) fail("a completed entry appears behind a FIFO barrier");
      if (!entry.completionCommit || !entry.authorizationHead) fail("completed chain is missing a commit");
      if (chainHead && entry.authorizationHead !== chainHead) fail("completed entry breaks the authorization/commit head chain");
      chainHead = entry.completionCommit;
    } else if (entry.state !== "DEQUEUED") {
      nonterminalSeen = true;
      if (entry.state === "RUNNING" || entry.state === "BLOCKED") {
        if (activeBarrierSeen) fail("more than one running/blocked barrier exists");
        activeBarrierSeen = true;
        if (chainHead && entry.authorizationHead !== chainHead) fail("active entry breaks the authorization/commit head chain");
      }
    }
  }
  if (chainHead && expectedHead !== chainHead) {
    // Allow drift when the only non-terminated entries are QUEUED — a fresh import
    // may start a new epoch after completed work, advancing expectedHead to the
    // import commit while the old completions still point to their own chain.
    const active = entries.find(isNonterminal);
    if (!active || active.state === "QUEUED") { /* ok — new epoch after completed history */ }
    else fail("expectedHead does not equal the last completed commit");
  }
  const activeEntry = entries.find((entry) => entry.state === "RUNNING" || entry.state === "BLOCKED");
  if (activeEntry?.authorizationHead !== undefined && activeEntry.authorizationHead !== expectedHead) fail("active authorization head does not equal expectedHead");
  const epochEntries = entries.filter((entry) => entry.state !== "DEQUEUED");
  if (epochEntries.length === 0 && expectedHead !== null) fail("empty queue epoch must have expectedHead reset");
  if (epochEntries.length > 0 && expectedHead === null) fail("non-empty queue epoch is missing expectedHead");
  const nextSequence = integer(value.nextSequence, "nextSequence", 1);
  if (entries.some((entry) => entry.sequence >= nextSequence)) fail("nextSequence is not greater than all sequences");
  const nextFencingToken = integer(value.nextFencingToken, "nextFencingToken", 1);
  const usedTokens = entries.flatMap((entry) => entry.attempts.map((attempt) => attempt.fencingToken));
  if (usedTokens.some((token) => token >= nextFencingToken)) fail("nextFencingToken is not greater than used fencing tokens");
  let dispatcherLease: DispatcherLease | null = null;
  if (value.dispatcherLease !== null) {
    if (!isRecord(value.dispatcherLease)) fail("dispatcherLease must be an object or null");
    exact(value.dispatcherLease, ["owner", "fencingToken", "acquiredAt", "heartbeatAt", "expiresAt"], "dispatcherLease");
    dispatcherLease = {
      owner: parseOwner(value.dispatcherLease.owner, uid, "dispatcherLease.owner"),
      fencingToken: integer(value.dispatcherLease.fencingToken, "dispatcherLease.fencingToken", 1),
      acquiredAt: timestamp(value.dispatcherLease.acquiredAt, "dispatcherLease.acquiredAt"),
      heartbeatAt: timestamp(value.dispatcherLease.heartbeatAt, "dispatcherLease.heartbeatAt"),
      expiresAt: timestamp(value.dispatcherLease.expiresAt, "dispatcherLease.expiresAt"),
    };
    if (dispatcherLease.fencingToken >= nextFencingToken) fail("dispatcher lease token is not below nextFencingToken");
    if (Date.parse(dispatcherLease.expiresAt) <= Date.parse(dispatcherLease.heartbeatAt)) fail("dispatcher lease expiry is not after heartbeat");
  }
  return {
    version: 1,
    repository, repositoryKey, uid,
    revision,
    nextSequence, nextFencingToken, expectedHead,
    paused: value.paused,
    dispatcherLease,
    entries,
  };
}

function initialSnapshot(repository: string, repositoryKey: string, uid: number): QueueSnapshot {
  return { version: 1, repository, repositoryKey, uid, revision: 0, nextSequence: 1, nextFencingToken: 1, expectedHead: null, paused: false, dispatcherLease: null, entries: [] };
}
function errno(error: unknown, code: string): boolean { return (error as NodeJS.ErrnoException)?.code === code; }
function assertRevision(snapshot: QueueSnapshot, expected: number | undefined): void {
  if (expected !== undefined && snapshot.revision !== expected) throw new Error(`Stale queue revision: expected ${expected}, current ${snapshot.revision}`);
}
function ownerEquals(left: QueueOwnerIdentity, right: QueueOwnerIdentity): boolean {
  return same(left, right);
}
function leaseAlive(lease: DispatcherLease, now: Date): boolean { return Date.parse(lease.expiresAt) > now.getTime(); }
function currentPhase(attempt: DispatchAttempt): DispatchPhase { return attempt.events[attempt.events.length - 1].phase; }

export async function openDurableQueue(repo: string, options: DurableQueueOptions = {}): Promise<DurableQueue> {
  const paths = await repositoryStatePaths(repo, options.stateRoot);
  const now = options.now ?? (() => new Date());
  const lockTimeoutMs = options.lockTimeoutMs ?? 10_000;
  const leaseTtlMs = options.leaseTtlMs ?? 120_000;
  if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs < 1) throw new Error("leaseTtlMs must be a positive integer");

  const read = async (): Promise<QueueSnapshot> => {
    try {
      return validateSnapshot(await readSecureJson(paths.queue), paths.repository, paths.repositoryKey, paths.uid);
    } catch (error) {
      if (errno(error, "ENOENT")) return initialSnapshot(paths.repository, paths.repositoryKey, paths.uid);
      throw error;
    }
  };
  const transaction = <T>(purpose: string, callback: (snapshot: QueueSnapshot, lock: AdvisoryLock) => Promise<T>) =>
    withAdvisoryLock(paths.queueTransactionLock, purpose, async (lock) => {
      lock.assertHeld();
      const snapshot = await read();
      lock.assertHeld();
      return callback(snapshot, lock);
    }, { timeoutMs: lockTimeoutMs });
  const persist = async (snapshot: QueueSnapshot, lock: AdvisoryLock): Promise<QueueSnapshot> => {
    lock.assertHeld();
    snapshot.revision += 1;
    const validated = validateSnapshot(snapshot, paths.repository, paths.repositoryKey, paths.uid);
    lock.assertHeld();
    await durableReplaceJson(paths.queue, validated, lock);
    lock.assertHeld();
    return clone(validated);
  };

  const command = async (input: QueueCommand): Promise<CommandResult> => transaction(`queue command ${input.type}`, async (snapshot, lock) => {
    if (input.type === "pause") {
      if (snapshot.paused) return { changed: false, snapshot: clone(snapshot) };
      assertRevision(snapshot, input.expectedRevision);
      snapshot.paused = true;
      return { changed: true, snapshot: await persist(snapshot, lock) };
    }
    if (input.type === "continue") {
      if (!snapshot.paused) return { changed: false, snapshot: clone(snapshot) };
      assertRevision(snapshot, input.expectedRevision);
      snapshot.paused = false;
      return { changed: true, snapshot: await persist(snapshot, lock) };
    }
    if (input.type === "enqueue") {
      taskId(input.taskId, "enqueue.taskId");
      const head = sha(input.expectedHead, isSha1, "enqueue.expectedHead");
      const proposed = {
        taskId: input.taskId,
        dependsOn: input.dependsOn,
        baselineCommit: input.baselineCommit,
        expectedHead: head,
        approvedBriefDigest: input.approvedBriefDigest,
        contractDigest: input.contractDigest,
        ownerPrincipal: input.ownerPrincipal,
        approvedAt: input.approvedAt,
        approvalSource: input.approvalSource ?? "/team-enqueue",
        completionPolicy: input.completionPolicy,
      };
      const existing = snapshot.entries.find((entry) => entry.taskId === input.taskId);
      if (existing) {
        const immutable = {
          taskId: existing.taskId, dependsOn: existing.dependsOn, baselineCommit: existing.baselineCommit,
          expectedHead: existing.expectedHead, approvedBriefDigest: existing.approvedBriefDigest, contractDigest: existing.contractDigest,
          ownerPrincipal: existing.ownerPrincipal, approvedAt: existing.approvedAt,
          approvalSource: existing.approvalSource, completionPolicy: existing.completionPolicy,
        };
        if (!same(immutable, proposed)) throw new Error(`Conflicting immutable enrollment for ${input.taskId}`);
        return { changed: false, snapshot: clone(snapshot) };
      }
      assertRevision(snapshot, input.expectedRevision);
      if (snapshot.expectedHead !== null && snapshot.expectedHead !== head) {
        // expectedHead mismatch — may be a new epoch after completed work.
        // Only allow if all existing entries are COMPLETED or DEQUEUED (no active work).
        const active = snapshot.entries.find(isNonterminal);
        if (active) {
          throw new Error(`Queue expected HEAD ${snapshot.expectedHead}, not ${head}`);
        }
        // Start a new epoch: compact old entries, reset expectedHead.
        snapshot.entries = [];
        snapshot.nextSequence = 1;
      }
      const earlier = new Map(snapshot.entries.map((entry) => [entry.taskId, entry]));
      for (const dependency of input.dependsOn) {
        const entry = earlier.get(dependency);
        if (!entry || entry.state === "DEQUEUED") throw new Error(`Dependency ${dependency} must be an earlier non-dequeued entry`);
      }
      if (new Set(input.dependsOn).size !== input.dependsOn.length || input.dependsOn.includes(input.taskId)) throw new Error("Invalid queue dependencies");
      const entry = parseEntry({
        ...proposed,
        sequence: snapshot.nextSequence,
        state: "QUEUED",
        baselineCommit: input.baselineCommit,
        authorizationHead: null,
        completionCommit: null,
        attempts: [],
        recoveryApproval: null,
      }, paths.uid, `new entry ${input.taskId}`);
      snapshot.nextSequence += 1;
      snapshot.expectedHead = head;
      snapshot.entries.push(entry);
      return { changed: true, snapshot: await persist(snapshot, lock) };
    }
    if (input.type === "bulkEnqueue") {
      const expectedHead = input.entries[0] ? sha(input.entries[0].expectedHead, isSha1, "bulkEnqueue.expectedHead") : null;

      // First pass: check ALL existing entries before any expectedHead check
      const newProposals: Array<{ index: number; proposed: { taskId: string; dependsOn: string[]; baselineCommit: string; expectedHead: string; approvedBriefDigest: string; contractDigest: string; ownerPrincipal: string; approvedAt: string; approvalSource: string; completionPolicy: { commitOnSuccess: boolean; pushOnSuccess: boolean; deployOnSuccess: boolean } } }> = [];
      for (let i = 0; i < input.entries.length; i++) {
        const item = input.entries[i];
        taskId(item.taskId, `bulkEnqueue[${i}].taskId`);
        const head = sha(item.expectedHead, isSha1, `bulkEnqueue[${i}].expectedHead`);
        if (head !== expectedHead) throw new Error(`bulkEnqueue[${i}].expectedHead mismatch`);

        const proposed = {
          taskId: item.taskId,
          dependsOn: item.dependsOn,
          baselineCommit: item.baselineCommit,
          expectedHead: head,
          approvedBriefDigest: item.approvedBriefDigest,
          contractDigest: item.contractDigest,
          ownerPrincipal: item.ownerPrincipal,
          approvedAt: item.approvedAt,
          approvalSource: item.approvalSource ?? "/team-enqueue",
          completionPolicy: item.completionPolicy,
        };
        const existing = snapshot.entries.find((entry) => entry.taskId === item.taskId);
        if (existing) {
          const immutable = {
            taskId: existing.taskId, dependsOn: existing.dependsOn, baselineCommit: existing.baselineCommit,
            expectedHead: existing.expectedHead, approvedBriefDigest: existing.approvedBriefDigest, contractDigest: existing.contractDigest,
            ownerPrincipal: existing.ownerPrincipal, approvedAt: existing.approvedAt,
            approvalSource: existing.approvalSource, completionPolicy: existing.completionPolicy,
          };
          if (!same(immutable, proposed)) throw new Error(`Conflicting immutable enrollment for ${item.taskId}`);
          continue; // Existing match — skip
        }
        newProposals.push({ index: i, proposed });
      }

      // All entries already exist → idempotent no-op
      if (newProposals.length === 0) return { changed: false, snapshot: clone(snapshot) };

      // Check expectedHead only when we have new entries to write
      if (expectedHead && snapshot.expectedHead !== null && snapshot.expectedHead !== expectedHead) {
        throw new Error(`Queue expected HEAD ${snapshot.expectedHead}, not ${expectedHead}`);
      }

      // Second pass: validate dependencies and build new entries
      const newEntries: QueueEntry[] = [];
      const pendingIds = new Set(input.entries.map(e => e.taskId));
      for (const { index: i, proposed } of newProposals) {
        const item = input.entries[i];
        const earlier = new Map(snapshot.entries.map((entry) => [entry.taskId, entry]));
        for (const dependency of item.dependsOn) {
          const entry = earlier.get(dependency);
          const isPendingInBulk = pendingIds.has(dependency) && input.entries.findIndex(e => e.taskId === dependency) < i;
          if (!isPendingInBulk && (!entry || entry.state === "DEQUEUED")) {
            throw new Error(`Dependency ${dependency} must be an earlier non-dequeued entry or enqueued earlier in this bulk operation`);
          }
        }
        if (new Set(item.dependsOn).size !== item.dependsOn.length || item.dependsOn.includes(item.taskId)) {
          throw new Error("Invalid queue dependencies");
        }

        const entry = parseEntry({
          ...proposed,
          sequence: snapshot.nextSequence + newEntries.length,
          state: "QUEUED",
          baselineCommit: item.baselineCommit,
          authorizationHead: null,
          completionCommit: null,
          attempts: [],
          recoveryApproval: null,
        }, paths.uid, `new entry ${item.taskId}`);
        newEntries.push(entry);
      }

      // All entries already exist → idempotent no-op (revision doesn't matter)
      if (newEntries.length === 0) return { changed: false, snapshot: clone(snapshot) };

      // Effective write → must check revision before persisting
      assertRevision(snapshot, input.expectedRevision);

      snapshot.nextSequence += newEntries.length;
      snapshot.expectedHead ??= expectedHead;
      snapshot.entries.push(...newEntries);
      return { changed: true, snapshot: await persist(snapshot, lock) };
    }
    if (input.type === "amendQueuedContracts") {
      const expectedHead = sha(input.expectedHead, isSha1, "amendQueuedContracts.expectedHead");
      const newExpectedHead = sha(input.newExpectedHead, isSha1, "amendQueuedContracts.newExpectedHead");
      if (!input.amendments.length) throw new Error("Queued contract amendment requires at least one task");
      const seen = new Set<string>();
      const parsed = input.amendments.map((amendment, index) => {
        taskId(amendment.taskId, `amendQueuedContracts[${index}].taskId`);
        if (seen.has(amendment.taskId)) throw new Error(`Duplicate queued contract amendment for ${amendment.taskId}`);
        seen.add(amendment.taskId);
        return {
          ...amendment,
          expectedApprovedBriefDigest: sha(amendment.expectedApprovedBriefDigest, isSha256, `amendQueuedContracts[${index}].expectedApprovedBriefDigest`),
          expectedContractDigest: sha(amendment.expectedContractDigest, isSha256, `amendQueuedContracts[${index}].expectedContractDigest`),
          approvedBriefDigest: sha(amendment.approvedBriefDigest, isSha256, `amendQueuedContracts[${index}].approvedBriefDigest`),
          contractDigest: sha(amendment.contractDigest, isSha256, `amendQueuedContracts[${index}].contractDigest`),
        };
      });
      const postimage = snapshot.expectedHead === newExpectedHead && parsed.every((amendment) => {
        const entry = snapshot.entries.find((candidate) => candidate.taskId === amendment.taskId);
        return entry?.state === "QUEUED" && entry.attempts.length === 0
          && entry.approvedBriefDigest === amendment.approvedBriefDigest
          && entry.contractDigest === amendment.contractDigest;
      });
      const historicalEntriesRemain = snapshot.entries.some((entry) => entry.state === "COMPLETED" || entry.state === "DEQUEUED");
      if (postimage && !historicalEntriesRemain) return { changed: false, snapshot: clone(snapshot) };

      assertRevision(snapshot, input.expectedRevision);
      if (snapshot.dispatcherLease) throw new Error("Cannot amend queued contracts while a dispatcher lease is active");
      if (snapshot.expectedHead !== expectedHead) throw new Error(`Queue amendment expected HEAD ${expectedHead}, not ${snapshot.expectedHead}`);
      for (const amendment of parsed) {
        const entry = snapshot.entries.find((candidate) => candidate.taskId === amendment.taskId);
        if (!entry) throw new Error(`Queued contract amendment task not found: ${amendment.taskId}`);
        if (entry.state !== "QUEUED" || entry.attempts.length !== 0 || entry.authorizationHead !== null) {
          throw new Error(`Queued contract amendment requires an unclaimed unauthorized entry: ${amendment.taskId}`);
        }
        if (entry.approvedBriefDigest !== amendment.expectedApprovedBriefDigest || entry.contractDigest !== amendment.expectedContractDigest) {
          throw new Error(`Queued contract amendment preimage mismatch for ${amendment.taskId}`);
        }
      }
      for (const amendment of parsed) {
        const entry = snapshot.entries.find((candidate) => candidate.taskId === amendment.taskId)!;
        entry.approvedBriefDigest = amendment.approvedBriefDigest;
        entry.contractDigest = amendment.contractDigest;
      }
      // Advancing HEAD outside task completion starts a new queue epoch. Keep
      // only nonterminal entries so the first repaired task can bind its
      // authorization head to the repair commit without breaking the exact
      // completed-task chain from the prior epoch.
      const retainedIds = new Set(
        snapshot.entries
          .filter(isNonterminal)
          .map((entry) => entry.taskId),
      );
      snapshot.entries = snapshot.entries
        .filter((entry) => retainedIds.has(entry.taskId))
        .map((entry) => ({ ...entry, dependsOn: entry.dependsOn.filter((dependency) => retainedIds.has(dependency)) }));
      snapshot.expectedHead = newExpectedHead;
      return { changed: true, snapshot: await persist(snapshot, lock) };
    }
    if (input.type === "bulkImportEnqueue") {
      // Verify full preimage before any mutation
      if (snapshot.revision !== input.preimage.revision) {
        throw new Error(
          `Queue preimage revision mismatch: expected ${input.preimage.revision}, got ${snapshot.revision}`,
        );
      }
      if (snapshot.paused !== input.preimage.paused) {
        throw new Error(
          `Queue preimage paused mismatch: expected ${input.preimage.paused}, got ${snapshot.paused}`,
        );
      }
      if (snapshot.nextSequence !== input.preimage.nextSequence) {
        throw new Error(
          `Queue preimage nextSequence mismatch: expected ${input.preimage.nextSequence}, got ${snapshot.nextSequence}`,
        );
      }
      if (snapshot.expectedHead !== input.preimage.expectedHead) {
        throw new Error(
          `Queue preimage expectedHead mismatch`,
        );
      }

      // First pass: compare all existing entries, collect new ones
      const newProposals: Array<{ index: number; proposed: { taskId: string; dependsOn: string[]; baselineCommit: string; expectedHead: string; approvedBriefDigest: string; contractDigest: string; ownerPrincipal: string; approvedAt: string; approvalSource: "/team-enqueue"; completionPolicy: QueueCompletionPolicy } }> = [];
      for (let i = 0; i < input.entries.length; i++) {
        const item = input.entries[i];
        taskId(item.taskId, `bulkImportEnqueue[${i}].taskId`);
        const head = sha(item.expectedHead, isSha1, `bulkImportEnqueue[${i}].expectedHead`);

        const proposed = {
          taskId: item.taskId, dependsOn: item.dependsOn,
          baselineCommit: item.baselineCommit, expectedHead: head,
          approvedBriefDigest: item.approvedBriefDigest, contractDigest: item.contractDigest,
          ownerPrincipal: item.ownerPrincipal, approvedAt: item.approvedAt,
          approvalSource: item.approvalSource ?? "/team-enqueue" as const,
          completionPolicy: item.completionPolicy,
        };
        const existing = snapshot.entries.find((entry) => entry.taskId === item.taskId);
        if (existing) {
          const immutable = {
            taskId: existing.taskId, dependsOn: existing.dependsOn, baselineCommit: existing.baselineCommit,
            expectedHead: existing.expectedHead, approvedBriefDigest: existing.approvedBriefDigest, contractDigest: existing.contractDigest,
            ownerPrincipal: existing.ownerPrincipal, approvedAt: existing.approvedAt,
            approvalSource: existing.approvalSource, completionPolicy: existing.completionPolicy,
          };
          if (!same(immutable, proposed)) throw new Error(`Conflicting immutable enrollment for ${item.taskId}`);
          continue;
        }
        newProposals.push({ index: i, proposed });
      }

      // All entries exist and match → verify postimage, then no-op.
      if (newProposals.length === 0) {
        if (snapshot.expectedHead !== input.newExpectedHead) {
          throw new Error(
            `Postimage expected head mismatch: expected ${input.newExpectedHead}, got ${snapshot.expectedHead}`,
          );
        }
        return { changed: false, snapshot: clone(snapshot) };
      }

      // Build new entries with correct sequences
      const newEntries: QueueEntry[] = [];
      for (const { index: i, proposed } of newProposals) {
        const item = input.entries[i];
        const entry = parseEntry({
          ...proposed,
          sequence: snapshot.nextSequence + newEntries.length,
          state: "QUEUED" as const,
          baselineCommit: item.baselineCommit,
          authorizationHead: null,
          completionCommit: null,
          attempts: [],
          recoveryApproval: null,
        }, paths.uid, `new entry ${item.taskId}`);
        newEntries.push(entry);
      }

      // Start a new epoch: compact any prior COMPLETED/DEQUEUED entries.
      // They're historical — the journal holds the audit record. Keeping them
      // forces a broken authorization chain between the old completion commits
      // and the new import-commit baseline.
      snapshot.entries = snapshot.entries.filter(isNonterminal);
      snapshot.nextSequence += newEntries.length;
      snapshot.expectedHead = input.newExpectedHead;
      snapshot.entries.push(...newEntries);
      return { changed: true, snapshot: await persist(snapshot, lock) };
    }
    if (input.type === "dequeue") {
      const entry = snapshot.entries.find((candidate) => candidate.taskId === input.taskId);
      if (!entry) throw new Error(`Task ${input.taskId} is not enrolled`);
      if (entry.state === "DEQUEUED") return { changed: false, snapshot: clone(snapshot) };
      if (entry.state !== "QUEUED" || entry.attempts.length) throw new Error(`Task ${input.taskId} cannot be dequeued after dispatch`);
      if (snapshot.entries.some((candidate) => candidate.state !== "DEQUEUED" && candidate.dependsOn.includes(input.taskId))) {
        throw new Error(`Task ${input.taskId} has non-dequeued dependents`);
      }
      assertRevision(snapshot, input.expectedRevision);
      entry.state = "DEQUEUED";
      // A queue containing only dequeue tombstones has no live head chain. The
      // next clean enrollment starts a new epoch from its exact observed HEAD;
      // subsequent enrollments in that epoch must match it.
      if (snapshot.entries.every((candidate) => candidate.state === "DEQUEUED")) snapshot.expectedHead = null;
      return { changed: true, snapshot: await persist(snapshot, lock) };
    }
    const entry = snapshot.entries.find((candidate) => candidate.taskId === input.taskId);
    if (!entry || entry.state !== "BLOCKED") throw new Error(`Task ${input.taskId} is not a blocked queue barrier`);
    const failed = entry.attempts.at(-1);
    if (!failed || failed.attemptId !== input.failedAttemptId || currentPhase(failed) !== "BLOCKED") throw new Error("Recovery approval does not match the failed attempt");
    const approvedBy = string(input.approvedBy, "recover.approvedBy");
    if (approvedBy !== entry.ownerPrincipal) throw new Error(`Recovery owner ${approvedBy} does not match enrollment owner ${entry.ownerPrincipal}`);
    const proposed: RecoveryApproval = {
      failedAttemptId: input.failedAttemptId,
      approvedBy,
      approvedAt: timestamp(input.approvedAt, "recover.approvedAt"),
      queueRevision: input.expectedRevision,
    };
    if (entry.recoveryApproval) {
      // Recovery already approved — idempotent. Don't fail on minor differences
      // (auto-recovery from /team-continue vs manual /team-unblock).
      return { changed: false, snapshot: clone(snapshot) };
    }
    assertRevision(snapshot, input.expectedRevision);
    entry.recoveryApproval = proposed;
    return { changed: true, snapshot: await persist(snapshot, lock) };
  });

  const withDispatcher = async <T>(callback: (session: DispatcherSession) => Promise<T>, dispatcherOptions: DispatcherOptions = {}): Promise<T> => {
    const lockOwner = await createLockOwner("queue dispatcher", dispatcherOptions.owner);
    const owner: QueueOwnerIdentity = {
      uid: lockOwner.uid, hostname: lockOwner.hostname, pid: lockOwner.pid,
      processStart: lockOwner.processStart, ownerId: lockOwner.ownerId,
    };
    const ttl = dispatcherOptions.leaseTtlMs ?? leaseTtlMs;
    const fencingToken = await transaction("acquire dispatcher lease", async (snapshot, lock) => {
      const instant = now();
      if (snapshot.dispatcherLease && leaseAlive(snapshot.dispatcherLease, instant)) {
        throw new Error(`Dispatcher lease held by ${snapshot.dispatcherLease.owner.hostname}:${snapshot.dispatcherLease.owner.pid} until ${snapshot.dispatcherLease.expiresAt}`);
      }
      const token = snapshot.nextFencingToken++;
      const at = instant.toISOString();
      snapshot.dispatcherLease = { owner, fencingToken: token, acquiredAt: at, heartbeatAt: at, expiresAt: new Date(instant.getTime() + ttl).toISOString() };
      await persist(snapshot, lock);
      return token;
    });

    const mutate = <TResult>(purpose: string, expectedRevision: number | undefined, callback: (snapshot: QueueSnapshot, lock: AdvisoryLock) => TResult | Promise<TResult>) =>
      transaction(purpose, async (snapshot, lock) => {
        const lease = snapshot.dispatcherLease;
        if (!lease || lease.fencingToken !== fencingToken || !ownerEquals(lease.owner, owner)) throw new Error(`Stale dispatcher fencing token ${fencingToken}`);
        if (!leaseAlive(lease, now())) throw new Error(`Dispatcher lease ${fencingToken} has expired`);
        assertRevision(snapshot, expectedRevision);
        return callback(snapshot, lock);
      });
    const findAttempt = (snapshot: QueueSnapshot, id: string, attemptId: string) => {
      const entry = snapshot.entries.find((candidate) => candidate.taskId === id);
      if (!entry) throw new Error(`Unknown queued task ${id}`);
      const attempt = entry.attempts.at(-1);
      if (!attempt || attempt.attemptId !== attemptId || attempt.fencingToken !== fencingToken || !ownerEquals(attempt.owner, owner)) {
        throw new Error(`Stale or non-current dispatch attempt ${attemptId}`);
      }
      return { entry, attempt };
    };
    // Shared by complete/reconcileComplete: both resolve an attempt (with
    // different strictness — see their own attempt lookups) and then agree
    // on identical completion mechanics. detail is the only thing that
    // should differ between callers; it's what the durable journal uses to
    // distinguish a normal completion from a fenced reconciliation.
    const finishAttempt = async (
      snapshot: QueueSnapshot,
      lock: AdvisoryLock,
      entry: QueueEntry,
      attempt: DispatchAttempt,
      commit: string,
      detail: string | null,
    ): Promise<QueueSnapshot> => {
      const existing = attempt.events.at(-1);
      if (existing?.phase === "COMPLETED") {
        if (entry.completionCommit !== commit || existing.completionCommit !== commit) throw new Error(`Conflicting completion replay for ${entry.taskId}`);
        return clone(snapshot);
      }
      if (entry.state !== "RUNNING" || existing?.phase !== "COMMITTING") throw new Error(`${entry.taskId} must be COMMITTING before completion`);
      if (entry.authorizationHead !== snapshot.expectedHead) throw new Error(`Head-chain break for ${entry.taskId}`);
      attempt.events.push({ phase: "COMPLETED", at: now().toISOString(), detail, completionCommit: commit });
      entry.state = "COMPLETED";
      entry.completionCommit = commit;
      snapshot.expectedHead = commit;
      return persist(snapshot, lock);
    };
    const session: DispatcherSession = Object.freeze({
      owner: clone(owner),
      fencingToken,
      heartbeat: (expectedRevision?: number) => mutate("dispatcher heartbeat", expectedRevision, async (snapshot, lock) => {
        const instant = now();
        const lease = snapshot.dispatcherLease!;
        lease.heartbeatAt = instant.toISOString();
        lease.expiresAt = new Date(instant.getTime() + ttl).toISOString();
        return persist(snapshot, lock);
      }),
      assertCurrent: () => mutate("assert dispatcher fence", undefined, (snapshot) => clone(snapshot)),
      claimNext: (expectedRevision?: number) => mutate("claim FIFO head", expectedRevision, async (snapshot, lock) => {
        if (snapshot.paused) return undefined;
        const first = barrier(snapshot);
        if (!first) return undefined;
        if (first.state === "RUNNING") return undefined;
        let kind: AttemptKind = "INITIAL";
        if (first.state === "BLOCKED") {
          const failed = first.attempts.at(-1);
          if (!first.recoveryApproval || first.recoveryApproval.failedAttemptId !== failed?.attemptId) return undefined;
          kind = "RECOVERY";
        }
        if (first.state !== "QUEUED" && first.state !== "BLOCKED") return undefined;
        if (first.dependsOn.some((id) => snapshot.entries.find((entry) => entry.taskId === id)?.state !== "COMPLETED")) return undefined;
        if (!snapshot.expectedHead) throw new Error("Queue expectedHead is missing");
        const instant = now().toISOString();
        const attempt: DispatchAttempt = {
          attemptId: randomUUID(), kind, fencingToken, owner: clone(owner), startedAt: instant,
          processes: [],
          events: [{ phase: "CLAIMED", at: instant, detail: null, completionCommit: null }],
        };
        first.state = "RUNNING";
        first.authorizationHead ??= snapshot.expectedHead;
        first.attempts.push(attempt);
        first.recoveryApproval = null;
        const saved = await persist(snapshot, lock);
        return { entry: clone(saved.entries.find((entry) => entry.taskId === first.taskId)!), attempt: clone(attempt), snapshot: saved };
      }),
      advance: (id: string, attemptId: string, phase: Exclude<DispatchPhase, "CLAIMED" | "BLOCKED" | "COMPLETED">, detail = "", expectedRevision?: number) =>
        mutate(`advance ${id} to ${phase}`, expectedRevision, async (snapshot, lock) => {
          const { entry, attempt } = findAttempt(snapshot, id, attemptId);
          if (entry.state !== "RUNNING") throw new Error(`${id} is not RUNNING`);
          const existing = attempt.events.find((event) => event.phase === phase);
          if (existing) {
            if (existing.detail !== (detail || null)) throw new Error(`Conflicting replay for ${id} ${phase}`);
            return clone(snapshot);
          }
          const current = currentPhase(attempt);
          const expected = LINEAR_PHASES[LINEAR_PHASES.indexOf(current) + 1];
          if (phase !== expected) throw new Error(`Illegal dispatch phase transition ${current} -> ${phase}`);
          attempt.events.push({ phase, at: now().toISOString(), detail: detail || null, completionCommit: null });
          return persist(snapshot, lock);
        }),
      recordProcess: (id: string, attemptId: string, process: Omit<DispatchProcessIdentity, "recordedAt">, expectedRevision?: number) =>
        mutate(`record ${id} child process`, expectedRevision, async (snapshot, lock) => {
          const { entry, attempt } = findAttempt(snapshot, id, attemptId);
          if (entry.state !== "RUNNING" || currentPhase(attempt) !== "EXECUTING") {
            throw new Error(`${id} must be EXECUTING before recording a child process`);
          }
          if ((process.role !== "builder" && process.role !== "reviewer") || !Number.isSafeInteger(process.pid) || process.pid < 1 || !Number.isSafeInteger(process.pgid) || process.pgid < 1 || !process.processStart) {
            throw new Error("Invalid dispatch child process identity");
          }
          const existing = attempt.processes.find((item) => item.pid === process.pid && item.processStart === process.processStart);
          if (existing) {
            if (existing.role !== process.role) throw new Error(`Conflicting child process replay for ${id}`);
            return clone(snapshot);
          }
          attempt.processes.push({ ...process, recordedAt: now().toISOString() });
          return persist(snapshot, lock);
        }),
      block: (id: string, attemptId: string, reason: string, expectedRevision?: number) =>
        mutate(`block ${id}`, expectedRevision, async (snapshot, lock) => {
          const entry = snapshot.entries.find((candidate) => candidate.taskId === id);
          const attempt = entry?.attempts.at(-1);
          if (!entry || !attempt || attempt.attemptId !== attemptId) throw new Error(`Unknown or non-current dispatch attempt ${attemptId}`);
          // A newly fenced dispatcher may conservatively terminate a stale attempt.
          // The current lease/token gates this write; it never grants permission to
          // advance or repeat the stale attempt's repository side effects.
          const existing = attempt.events.at(-1);
          if (existing?.phase === "BLOCKED") {
            if (existing.detail !== reason) throw new Error(`Conflicting block replay for ${id}`);
            return clone(snapshot);
          }
          if (entry.state !== "RUNNING" || existing?.phase === "COMPLETED") throw new Error(`${id} cannot be blocked`);
          if (!reason.trim()) throw new Error("Blocked reason must be non-empty");
          attempt.events.push({ phase: "BLOCKED", at: now().toISOString(), detail: reason, completionCommit: null });
          entry.state = "BLOCKED";
          return persist(snapshot, lock);
        }),
      complete: (id: string, attemptId: string, completionCommit: string, expectedRevision?: number) =>
        mutate(`complete ${id}`, expectedRevision, async (snapshot, lock) => {
          const commit = sha(completionCommit, isSha1, "completionCommit");
          const { entry, attempt } = findAttempt(snapshot, id, attemptId);
          return finishAttempt(snapshot, lock, entry, attempt, commit, null);
        }),
      // Crash recovery: a replacement dispatcher session (new fencing token)
      // completing an attempt claimed under a prior one. This attempt lookup
      // is deliberately looser than findAttempt's — it must NOT require the
      // current fencing token/owner to match, or reconciliation could never
      // complete a stale attempt from before the takeover.
      reconcileComplete: (id: string, attemptId: string, completionCommit: string, expectedRevision?: number) =>
        mutate(`reconcile exact completion ${id}`, expectedRevision, async (snapshot, lock) => {
          const commit = sha(completionCommit, isSha1, "completionCommit");
          const entry = snapshot.entries.find((candidate) => candidate.taskId === id);
          const attempt = entry?.attempts.at(-1);
          if (!entry || !attempt || attempt.attemptId !== attemptId) throw new Error(`Unknown or non-current dispatch attempt ${attemptId}`);
          return finishAttempt(snapshot, lock, entry, attempt, commit, `exact COMMITTING journal reconciled under replacement fence ${fencingToken}`);
        }),
    });

    try {
      return await callback(session);
    } finally {
      await transaction("release dispatcher lease", async (snapshot, lock) => {
        const lease = snapshot.dispatcherLease;
        if (!lease || lease.fencingToken !== fencingToken || !ownerEquals(lease.owner, owner)) return;
        snapshot.dispatcherLease = null;
        await persist(snapshot, lock);
      }).catch(() => undefined);
    }
  };

  return Object.freeze({ snapshot: read, command, withDispatcher });
}

export function formatQueueSnapshot(snapshot: QueueSnapshot): string {
  const lease = snapshot.dispatcherLease
    ? `dispatcher=${snapshot.dispatcherLease.owner.hostname}:${snapshot.dispatcherLease.owner.pid} fence=${snapshot.dispatcherLease.fencingToken} expires=${snapshot.dispatcherLease.expiresAt}`
    : "dispatcher=idle";
  const header = `queue revision=${snapshot.revision} ${snapshot.paused ? "PAUSED" : "CONTINUING"} expectedHead=${snapshot.expectedHead ?? "unset"} ${lease}`;
  if (!snapshot.entries.length) return `${header}\n(empty)`;
  return [header, ...snapshot.entries.map((entry) => {
    const attempt = entry.attempts.at(-1);
    const phase = attempt ? ` phase=${currentPhase(attempt)} fence=${attempt.fencingToken}` : "";
    const dependencies = entry.dependsOn.length ? ` after=${entry.dependsOn.join(",")}` : "";
    return `${entry.sequence}. ${entry.taskId} ${entry.state}${dependencies}${phase}`;
  })].join("\n");
}
