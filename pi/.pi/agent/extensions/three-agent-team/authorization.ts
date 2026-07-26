import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { resolve } from "node:path";

export interface AuthorizationRecord {
  version: 1;
  repository: string;
  taskId: string;
  authorizationHead: string;
  contractDigest: string;
  authorizedAt: string;
}

const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function defaultAuthorizationStateRoot(): string {
  return resolve(userInfo().homedir, ".local/state/pi-three-agent-team");
}

function assertTaskId(taskId: string): void {
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error(`Invalid task ID for authorization record: ${taskId}`);
}

async function repositoryIdentity(repo: string): Promise<{ repository: string; key: string }> {
  const repository = await realpath(repo);
  const key = createHash("sha256").update(repository, "utf8").digest("hex");
  return { repository, key };
}

export async function authorizationRecordPath(
  repo: string,
  taskId: string,
  stateRoot = defaultAuthorizationStateRoot(),
): Promise<string> {
  assertTaskId(taskId);
  const { key } = await repositoryIdentity(repo);
  return resolve(stateRoot, "authorizations", key, `${taskId}.json`);
}

export async function createAuthorizationRecord(
  repo: string,
  taskId: string,
  authorizationHead: string,
  contractDigest: string,
  authorizedAt: string,
): Promise<AuthorizationRecord> {
  assertTaskId(taskId);
  const { repository } = await repositoryIdentity(repo);
  return { version: 1, repository, taskId, authorizationHead, contractDigest, authorizedAt };
}

export async function writeAuthorizationRecord(
  repo: string,
  record: AuthorizationRecord,
  stateRoot = defaultAuthorizationStateRoot(),
): Promise<string> {
  const path = await authorizationRecordPath(repo, record.taskId, stateRoot);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return path;
}

export async function readAuthorizationRecord(
  repo: string,
  taskId: string,
  stateRoot = defaultAuthorizationStateRoot(),
): Promise<AuthorizationRecord> {
  const path = await authorizationRecordPath(repo, taskId, stateRoot);
  const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<AuthorizationRecord>;
  const expectedRepository = (await repositoryIdentity(repo)).repository;
  if (
    parsed.version !== 1
    || parsed.repository !== expectedRepository
    || parsed.taskId !== taskId
    || !/^[0-9a-f]{40}$/.test(parsed.authorizationHead ?? "")
    || !/^[0-9a-f]{64}$/.test(parsed.contractDigest ?? "")
    || typeof parsed.authorizedAt !== "string"
    || !parsed.authorizedAt
  ) {
    throw new Error(`Invalid authorization record: ${path}`);
  }
  return parsed as AuthorizationRecord;
}

export async function archiveAuthorizationRecord(
  repo: string,
  taskId: string,
  stamp: string,
  stateRoot = defaultAuthorizationStateRoot(),
): Promise<string | undefined> {
  const source = await authorizationRecordPath(repo, taskId, stateRoot);
  try {
    await readFile(source, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const { key } = await repositoryIdentity(repo);
  const destination = resolve(stateRoot, "authorizations", ".discarded", key, `${taskId}-${stamp}.json`);
  await mkdir(resolve(destination, ".."), { recursive: true });
  await rename(source, destination);
  return destination;
}
