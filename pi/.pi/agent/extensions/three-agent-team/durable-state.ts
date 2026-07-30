import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { userInfo, hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface RepositoryIdentity {
  repository: string;
  repositoryKey: string;
  uid: number;
}

export interface AdvisoryLockOwner {
  uid: number;
  hostname: string;
  pid: number;
  processStart: string;
  ownerId: string;
  purpose: string;
  acquiredAt: string;
}

export interface SideEffectCapability {
  readonly signal: AbortSignal;
  assertHeld(): void;
}

export interface AdvisoryLock extends SideEffectCapability {
  readonly path: string;
  readonly owner: AdvisoryLockOwner;
  readonly brokerPid: number;
  /** Aborts if the broker exits before an intentional release. */
  readonly signal: AbortSignal;
  release(): Promise<void>;
}

export function assertSideEffectCapability(capability: SideEffectCapability): void {
  if (capability.signal.aborted) {
    throw capability.signal.reason instanceof Error
      ? capability.signal.reason
      : new Error("Durable side-effect capability was aborted");
  }
  capability.assertHeld();
}

export interface LockOptions {
  timeoutMs?: number;
  owner?: Partial<Omit<AdvisoryLockOwner, "uid" | "acquiredAt">>;
  signal?: AbortSignal;
}

const BROKER = fileURLToPath(new URL("./advisory-lock.py", import.meta.url));
const SECURE_MASK = 0o077;

/** passwd-derived and intentionally independent of HOME/XDG/environment settings. */
export function defaultDurableStateRoot(): string {
  return resolve(userInfo().homedir, ".local/state/pi-three-agent-team");
}

export function currentUid(): number {
  const uid = typeof process.getuid === "function" ? process.getuid() : userInfo().uid;
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error("Cannot determine the current account UID");
  return uid;
}

export async function identifyRepository(repo: string): Promise<RepositoryIdentity> {
  const repository = await realpath(repo);
  return {
    repository,
    repositoryKey: createHash("sha256").update(repository, "utf8").digest("hex"),
    uid: currentUid(),
  };
}

function describeMode(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`;
}

export async function verifySecureStateObject(path: string, kind: "file" | "directory"): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Refusing symlinked durable-state ${kind}: ${path}`);
  if (kind === "file" ? !info.isFile() : !info.isDirectory()) {
    throw new Error(`Durable-state ${path} is not a ${kind}`);
  }
  if (info.uid !== currentUid()) throw new Error(`Durable-state ${kind} has wrong owner: ${path}`);
  if ((info.mode & SECURE_MASK) !== 0) {
    throw new Error(`Durable-state ${kind} is group/world accessible (${describeMode(info.mode)}): ${path}`);
  }
}

/** Create an extension-owned directory and reject insecure pre-existing objects. */
export async function ensureSecureDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new Error(`Cannot create durable-state directory ${path}: ${(error as Error).message}`, { cause: error });
  }
  await verifySecureStateObject(path, "directory");
}

async function secureOpenRead(path: string) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== currentUid() || (info.mode & SECURE_MASK) !== 0) {
      throw new Error(`Insecure durable-state file: ${path}`);
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function readSecureFile(path: string): Promise<string> {
  const handle = await secureOpenRead(path);
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export async function readSecureJson(path: string): Promise<unknown> {
  const text = await readSecureFile(path);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid durable JSON at ${path}: ${(error as Error).message}`, { cause: error });
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeSyncedTemporary(path: string, bytes: string, capability: SideEffectCapability): Promise<string> {
  const parent = dirname(path);
  assertSideEffectCapability(capability);
  await ensureSecureDirectory(parent);
  assertSideEffectCapability(capability);
  const temporary = resolve(parent, `.${randomUUID()}.tmp`);
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
  try {
    assertSideEffectCapability(capability);
    await handle.writeFile(bytes, "utf8");
    assertSideEffectCapability(capability);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();
  await verifySecureStateObject(temporary, "file");
  return temporary;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Durable atomic replacement: synced temp -> rename -> containing-directory fsync. */
export async function durableReplace(path: string, bytes: string, capability: SideEffectCapability): Promise<void> {
  const parent = dirname(path);
  const temporary = await writeSyncedTemporary(path, bytes, capability);
  try {
    assertSideEffectCapability(capability);
    try {
      await verifySecureStateObject(path, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    assertSideEffectCapability(capability);
    await rename(temporary, path);
    assertSideEffectCapability(capability);
    await chmod(path, 0o600);
    await verifySecureStateObject(path, "file");
    assertSideEffectCapability(capability);
    await syncDirectory(parent);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function durableReplaceJson(path: string, value: unknown, capability: SideEffectCapability): Promise<void> {
  await durableReplace(path, canonicalJson(value), capability);
}

/**
 * Durable create-once.  A retry succeeds only when the existing bytes are
 * identical or the supplied equivalence predicate validates both complete files.
 */
export async function durableCreateOnce(
  path: string,
  bytes: string,
  capability: SideEffectCapability,
  equivalent?: (existing: string, proposed: string) => boolean,
): Promise<"created" | "identical"> {
  const parent = dirname(path);
  const temporary = await writeSyncedTemporary(path, bytes, capability);
  try {
    assertSideEffectCapability(capability);
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      assertSideEffectCapability(capability);
      const existing = await readSecureFile(path);
      if (existing !== bytes && !equivalent?.(existing, bytes)) {
        const conflict = new Error(`Conflicting create-once durable state: ${path}`) as NodeJS.ErrnoException;
        conflict.code = "EEXIST";
        throw conflict;
      }
      return "identical";
    }
    assertSideEffectCapability(capability);
    await verifySecureStateObject(path, "file");
    await syncDirectory(parent);
    return "created";
  } finally {
    await unlink(temporary).catch(() => undefined);
    // The temporary name is itself directory state. Sync its removal as well.
    await syncDirectory(parent);
  }
}

/**
 * Durable no-replace archive. Hard-link creation is the atomic destination
 * claim; a pre-existing destination can never be overwritten. The source is
 * unlinked only after the destination name and file contents are synced.
 */
export async function durableArchive(source: string, destination: string, capability: SideEffectCapability): Promise<void> {
  assertSideEffectCapability(capability);
  await verifySecureStateObject(source, "file");
  const sourceInfo = await lstat(source);
  const sourceDirectory = dirname(source);
  const destinationDirectory = dirname(destination);
  await ensureSecureDirectory(destinationDirectory);
  assertSideEffectCapability(capability);
  const sourceHandle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { await sourceHandle.sync(); } finally { await sourceHandle.close(); }
  assertSideEffectCapability(capability);
  try {
    await link(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new Error(`Archive destination cannot be claimed without replacement: ${destination}`, { cause: error });
    }
    const destinationInfo = await lstat(destination);
    if (!destinationInfo.isFile() || destinationInfo.dev !== sourceInfo.dev || destinationInfo.ino !== sourceInfo.ino) {
      throw new Error(`Archive destination already exists: ${destination}`);
    }
    // Idempotent recovery after a crash between link and unlink.
  }
  assertSideEffectCapability(capability);
  await verifySecureStateObject(destination, "file");
  await syncDirectory(destinationDirectory);
  assertSideEffectCapability(capability);
  await unlink(source);
  await syncDirectory(sourceDirectory);
}

async function processStartIdentity(): Promise<string> {
  try {
    const stat = await import("node:fs/promises").then(({ readFile }) => readFile("/proc/self/stat", "utf8"));
    // Everything after the final ')' starts at field 3; starttime is field 22.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    if (fields[19]) return `proc:${fields[19]}`;
  } catch {
    // macOS and other Unix hosts have no /proc.  This still distinguishes a PID
    // incarnation without trusting mutable environment state.
  }
  return `epoch:${Math.round(Date.now() - process.uptime() * 1000)}`;
}

export async function createLockOwner(
  purpose: string,
  overrides: Partial<Omit<AdvisoryLockOwner, "uid" | "acquiredAt">> = {},
): Promise<AdvisoryLockOwner> {
  return {
    uid: currentUid(),
    hostname: overrides.hostname ?? hostname(),
    pid: overrides.pid ?? process.pid,
    processStart: overrides.processStart ?? await processStartIdentity(),
    ownerId: overrides.ownerId ?? randomUUID(),
    purpose: overrides.purpose ?? purpose,
    acquiredAt: new Date().toISOString(),
  };
}

function waitForBroker(child: ChildProcessWithoutNullStreams, path: string, signal?: AbortSignal): Promise<number> {
  return new Promise((resolveReady, rejectReady) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectReady(error);
    };
    const onAbort = () => {
      child.stdin.end();
      child.kill("SIGTERM");
      finishError(signal?.reason instanceof Error ? signal.reason : new Error(`Advisory lock acquisition aborted: ${path}`));
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const newline = stdout.indexOf("\n");
      if (newline < 0 || settled) return;
      try {
        const message = JSON.parse(stdout.slice(0, newline)) as { status?: unknown; pid?: unknown };
        if (message.status !== "locked" || !Number.isInteger(message.pid)) throw new Error("invalid broker response");
        settled = true;
        cleanup();
        resolveReady(message.pid as number);
      } catch (error) {
        finishError(new Error(`Invalid advisory-lock broker response for ${path}: ${(error as Error).message}`));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => finishError(new Error(`Cannot start advisory-lock broker: ${error.message}`, { cause: error })));
    child.once("exit", (code, terminationSignal) => {
      if (!settled) {
        let detail = stderr.trim();
        try { detail = (JSON.parse(detail) as { message?: string }).message ?? detail; } catch { /* plain stderr */ }
        finishError(new Error(detail || `Advisory-lock broker exited (${code ?? terminationSignal}) for ${path}`));
      }
    });
  });
}

export async function acquireAdvisoryLock(path: string, purpose: string, options: LockOptions = {}): Promise<AdvisoryLock> {
  const parent = dirname(path);
  await ensureSecureDirectory(parent);
  try {
    await verifySecureStateObject(path, "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const owner = await createLockOwner(purpose, options.owner);
  const child = spawn("python3", [
    BROKER,
    "--path", path,
    "--timeout-ms", String(options.timeoutMs ?? 10_000),
    "--owner", JSON.stringify(owner),
  ], { stdio: ["pipe", "pipe", "pipe"] });
  const brokerPid = await waitForBroker(child, path, options.signal);
  const lostController = new AbortController();
  let releaseRequested = false;
  let unexpectedExit: Error | undefined;
  let releasePromise: Promise<void> | undefined;
  child.once("exit", (code, terminationSignal) => {
    if (releaseRequested) return;
    unexpectedExit = new Error(`Advisory-lock broker exited unexpectedly (${code ?? terminationSignal}): ${path}`);
    lostController.abort(unexpectedExit);
  });
  const assertHeld = () => {
    if (unexpectedExit || lostController.signal.aborted || child.exitCode !== null || child.signalCode !== null) {
      throw unexpectedExit ?? new Error(`Advisory lock is no longer held: ${path}`);
    }
  };
  return {
    path,
    owner,
    brokerPid,
    signal: lostController.signal,
    assertHeld,
    release() {
      if (releasePromise) return releasePromise;
      if (unexpectedExit || (!releaseRequested && (child.exitCode !== null || child.signalCode !== null))) {
        return Promise.reject(unexpectedExit ?? new Error(`Advisory-lock broker already exited: ${path}`));
      }
      releaseRequested = true;
      releasePromise = new Promise<void>((resolveRelease, rejectRelease) => {
        const finish = (code: number | null, signal: NodeJS.Signals | null) => {
          if (code === 0) resolveRelease();
          else rejectRelease(new Error(`Advisory-lock broker exited during release (${code ?? signal}): ${path}`));
        };
        child.once("error", rejectRelease);
        if (child.exitCode !== null || child.signalCode !== null) finish(child.exitCode, child.signalCode);
        else {
          child.once("exit", finish);
          child.stdin.end();
        }
      });
      return releasePromise;
    },
  };
}

export async function withAdvisoryLock<T>(
  path: string,
  purpose: string,
  callback: (lock: AdvisoryLock) => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const lock = await acquireAdvisoryLock(path, purpose, options);
  try {
    lock.assertHeld();
    // Cancellation is cooperative: callbacks receive the lock's abort signal
    // and every durable side effect must assert the capability. Promise.race
    // would only abandon observation of a still-running JavaScript callback.
    const result = await callback(lock);
    lock.assertHeld();
    return result;
  } finally {
    await lock.release();
  }
}

export async function repositoryStatePaths(repo: string, stateRoot = defaultDurableStateRoot()) {
  const identity = await identifyRepository(repo);
  await ensureSecureDirectory(stateRoot);
  const queues = resolve(stateRoot, "queues");
  const lockRoot = resolve(stateRoot, "locks");
  const locks = resolve(lockRoot, identity.repositoryKey);
  await ensureSecureDirectory(queues);
  await ensureSecureDirectory(lockRoot);
  await ensureSecureDirectory(locks);
  return {
    ...identity,
    stateRoot,
    queue: resolve(queues, `${identity.repositoryKey}.json`),
    queueTransactionLock: resolve(locks, "queue-transaction.lock"),
    repositoryExecutionLock: resolve(locks, "repository-execution.lock"),
  };
}
