import { resolve } from "node:path";
import {
  canonicalJson,
  defaultDurableStateRoot,
  durableArchive,
  durableCreateOnce,
  ensureSecureDirectory,
  identifyRepository,
  readSecureJson,
  verifySecureStateObject,
  type SideEffectCapability,
} from "./durable-state.ts";

export interface AuthorizationRecord {
  version: 1;
  repository: string;
  taskId: string;
  authorizationHead: string;
  contractDigest: string;
  authorizedAt: string;
}

const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SHA1_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EXACT_FIELDS = ["version", "repository", "taskId", "authorizationHead", "contractDigest", "authorizedAt"];

/** Compatibility name retained for immediate /team-go callers. */
export function defaultAuthorizationStateRoot(): string {
  return defaultDurableStateRoot();
}

function assertTaskId(taskId: string): void {
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error(`Invalid task ID for authorization record: ${taskId}`);
}

function validateRecord(value: unknown, expectedRepository: string, expectedTaskId: string, path: string): AuthorizationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid authorization record: ${path}`);
  const parsed = value as Record<string, unknown>;
  const keys = Object.keys(parsed).sort();
  if (keys.length !== EXACT_FIELDS.length || keys.some((key, index) => key !== [...EXACT_FIELDS].sort()[index])) {
    throw new Error(`Invalid authorization record fields: ${path}`);
  }
  if (
    parsed.version !== 1
    || parsed.repository !== expectedRepository
    || parsed.taskId !== expectedTaskId
    || typeof parsed.authorizationHead !== "string"
    || !SHA1_PATTERN.test(parsed.authorizationHead)
    || typeof parsed.contractDigest !== "string"
    || !SHA256_PATTERN.test(parsed.contractDigest)
    || typeof parsed.authorizedAt !== "string"
    || !parsed.authorizedAt
    || !Number.isFinite(Date.parse(parsed.authorizedAt))
  ) {
    throw new Error(`Invalid authorization record: ${path}`);
  }
  return parsed as unknown as AuthorizationRecord;
}

function recordsEquivalent(existing: string, proposed: string): boolean {
  try {
    const left = JSON.parse(existing) as unknown;
    const right = JSON.parse(proposed) as unknown;
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

async function authorizationDirectories(
  repo: string,
  stateRoot: string,
  create: boolean,
): Promise<{ authorizations: string; repositoryDirectory: string }> {
  const { repositoryKey } = await identifyRepository(repo);
  const authorizations = resolve(stateRoot, "authorizations");
  const repositoryDirectory = resolve(authorizations, repositoryKey);
  for (const directory of [stateRoot, authorizations, repositoryDirectory]) {
    if (create) await ensureSecureDirectory(directory);
    else await verifySecureStateObject(directory, "directory");
  }
  return { authorizations, repositoryDirectory };
}

export async function authorizationRecordPath(
  repo: string,
  taskId: string,
  stateRoot = defaultAuthorizationStateRoot(),
): Promise<string> {
  assertTaskId(taskId);
  const { repositoryKey } = await identifyRepository(repo);
  return resolve(stateRoot, "authorizations", repositoryKey, `${taskId}.json`);
}

export async function createAuthorizationRecord(
  repo: string,
  taskId: string,
  authorizationHead: string,
  contractDigest: string,
  authorizedAt: string,
): Promise<AuthorizationRecord> {
  assertTaskId(taskId);
  const { repository } = await identifyRepository(repo);
  return validateRecord(
    { version: 1, repository, taskId, authorizationHead, contractDigest, authorizedAt },
    repository,
    taskId,
    "new authorization record",
  );
}

export async function assertAuthorizationRecordAbsent(
  repo: string,
  taskId: string,
  stateRoot = defaultAuthorizationStateRoot(),
): Promise<void> {
  assertTaskId(taskId);
  await authorizationDirectories(repo, stateRoot, true);
  const path = await authorizationRecordPath(repo, taskId, stateRoot);
  try {
    await verifySecureStateObject(path, "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Stale external authorization record exists: ${path}`);
}

/** Crash-safe create-once; an exact retry is successful, a conflict fails closed. */
export async function writeAuthorizationRecord(
  repo: string,
  record: AuthorizationRecord,
  capability: SideEffectCapability,
  stateRoot = defaultAuthorizationStateRoot(),
): Promise<string> {
  assertTaskId(record.taskId);
  const identity = await identifyRepository(repo);
  const path = await authorizationRecordPath(repo, record.taskId, stateRoot);
  const validated = validateRecord(record, identity.repository, record.taskId, path);
  await authorizationDirectories(repo, stateRoot, true);
  await durableCreateOnce(path, canonicalJson(validated), capability, recordsEquivalent);
  return path;
}

export async function readAuthorizationRecord(
  repo: string,
  taskId: string,
  stateRoot = defaultAuthorizationStateRoot(),
): Promise<AuthorizationRecord> {
  assertTaskId(taskId);
  const path = await authorizationRecordPath(repo, taskId, stateRoot);
  const { repository } = await identifyRepository(repo);
  await authorizationDirectories(repo, stateRoot, false);
  return validateRecord(await readSecureJson(path), repository, taskId, path);
}

export async function archiveAuthorizationRecord(
  repo: string,
  taskId: string,
  stamp: string,
  capability: SideEffectCapability,
  stateRoot = defaultAuthorizationStateRoot(),
): Promise<string | undefined> {
  assertTaskId(taskId);
  if (!/^[A-Za-z0-9._-]+$/.test(stamp)) throw new Error(`Invalid authorization archive stamp: ${stamp}`);
  const source = await authorizationRecordPath(repo, taskId, stateRoot);
  try {
    // Validate both the security metadata and record identity before moving it.
    await readAuthorizationRecord(repo, taskId, stateRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const { repositoryKey } = await identifyRepository(repo);
  const discarded = resolve(stateRoot, "authorizations", ".discarded");
  const discardedRepository = resolve(discarded, repositoryKey);
  await ensureSecureDirectory(discarded);
  await ensureSecureDirectory(discardedRepository);
  const destination = resolve(discardedRepository, `${taskId}-${stamp}.json`);
  await durableArchive(source, destination, capability);
  return destination;
}
