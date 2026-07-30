/**
 * Durable import transaction journal — schema version 2.
 *
 * Tracks phases of a plan-import transaction for crash recovery.
 * All journal files and immutable artifacts live below the passwd-rooted,
 * repository-keyed external state directory.
 *
 * Phases:
 *   PREPARED        → immutable bundle published; no live mutation yet
 *   TREE_INSTALLED  → exact commit object metadata durable; HEAD unchanged
 *   GIT_INSTALLED   → live files, HEAD, index, and worktree match commit
 *   QUEUE_PREPARED  → exact queue enrollment intent durable; queue may be unchanged
 *   QUEUE_ENROLLED  → exact queue postimage is present
 *   COMPLETED       → transaction finished; original result is durable
 *   BLOCKED         → transaction failed; reason is durable; no automatic mutation
 */

import { createHash } from "node:crypto";
import {
  mkdir, readFile, writeFile, rename, unlink,
  readdir, realpath, open as fsOpen, stat,
} from "node:fs/promises";
import { constants } from "node:fs";
import { userInfo } from "node:os";
import { dirname, resolve, isAbsolute, relative } from "node:path";
import {
  defaultDurableStateRoot,
  ensureSecureDirectory,
  verifySecureStateObject,
  type AdvisoryLock,
  type SideEffectCapability,
} from "./durable-state.ts";
import type { TaskSpec } from "./plan-manifest.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportPhase =
  | "PREPARED"
  | "TREE_INSTALLED"
  | "GIT_INSTALLED"
  | "QUEUE_PREPARED"
  | "QUEUE_ENROLLED"
  | "COMPLETED"
  | "BLOCKED";

export interface ImportJournalEntry {
  taskId: string;
  briefPath: string;
  statusPath: string;
  briefDigest: string;
  statusDigest: string;
  contractDigest: string;
  briefSize: number;
  briefMode: number;
  statusSize: number;
  statusMode: number;
  dependsOn: string[];
  completionPolicy: {
    commitOnSuccess: boolean;
    pushOnSuccess: boolean;
    deployOnSuccess: boolean;
  };
}

export interface QueueEnrollmentTuple {
  taskId: string;
  sequence: number;
  state: "QUEUED";
  dependsOn: string[];
  baselineCommit: string;
  expectedHead: string;
  approvedBriefDigest: string;
  contractDigest: string;
  ownerPrincipal: string;
  approvedAt: string;
  approvalSource: "/team-enqueue";
  completionPolicy: {
    commitOnSuccess: boolean;
    pushOnSuccess: boolean;
    deployOnSuccess: boolean;
  };
}

export interface QueuePreimageSnapshot {
  revision: number;
  expectedHead: string | null;
  paused: boolean;
  nextSequence: number;
}

export interface ImportJournal {
  version: 2;
  revision: number;
  repository: string;
  repositoryKey: string;
  uid: number;
  journalId: string;
  manifestPath: string;
  manifestDigest: string;
  approvedDigest: string;
  ownerPrincipal: string;
  initialHead: string;
  queuePreimage: QueuePreimageSnapshot;
  approvalTimestamp: string;
  importCommitSha: string | null;
  importTreeSha: string | null;
  commitParent: string | null;
  commitSubject: string;
  tasks: ImportJournalEntry[];
  /** Exact intended queue enrollment tuples */
  queueIntent: QueueEnrollmentTuple[];
  /** Actual queue postimage after enrollment */
  queuePostimage: QueuePreimageSnapshot | null;
  phase: ImportPhase;
  blockingReason: string | null;
  /** Completed result fields */
  completedCommitSha: string | null;
  completedTasks: string[];
  completedSequences: number[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const LEGAL_TRANSITIONS: Record<ImportPhase, ImportPhase[]> = {
  PREPARED: ["PREPARED", "TREE_INSTALLED", "BLOCKED"],
  TREE_INSTALLED: ["TREE_INSTALLED", "GIT_INSTALLED", "BLOCKED"],
  GIT_INSTALLED: ["GIT_INSTALLED", "QUEUE_PREPARED", "BLOCKED"],
  QUEUE_PREPARED: ["QUEUE_PREPARED", "QUEUE_ENROLLED", "BLOCKED"],
  QUEUE_ENROLLED: ["QUEUE_ENROLLED", "COMPLETED", "BLOCKED"],
  COMPLETED: ["COMPLETED"],
  BLOCKED: ["BLOCKED"],
};

function validateJournalPhase(phase: string): phase is ImportPhase {
  return Object.keys(LEGAL_TRANSITIONS).includes(phase);
}

export function assertLegalTransition(from: ImportPhase, to: ImportPhase): void {
  const allowed = LEGAL_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Illegal journal transition: ${from} → ${to}`);
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export async function importJournalPath(
  repo: string,
  journalId: string,
  stateRoot?: string,
): Promise<string> {
  const root = stateRoot ?? defaultDurableStateRoot();
  const repoKey = await getRepoKey(repo);
  const importsDir = resolve(root, "imports", repoKey);
  await ensureSecureDirectory(importsDir);
  if (journalId.includes("/") || journalId.includes("..")) {
    throw new Error(`Journal ID contains invalid characters: ${journalId}`);
  }
  return resolve(importsDir, `${journalId}.json`);
}

export async function importBundleDir(
  repo: string,
  journalId: string,
  stateRoot?: string,
): Promise<string> {
  const root = stateRoot ?? defaultDurableStateRoot();
  const repoKey = await getRepoKey(repo);
  return resolve(root, "imports", repoKey, journalId);
}

export async function canonicalRepoKey(repo: string): Promise<string> {
  return getRepoKey(repo);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createImportJournal(
  repo: string,
  repoKey: string,
  journalId: string,
  manifestPath: string,
  manifestDigest: string,
  approvedDigest: string,
  ownerPrincipal: string,
  initialHead: string,
  queuePreimage: QueuePreimageSnapshot,
  approvalTimestamp: string,
  tasks: ImportJournalEntry[],
): ImportJournal {
  const now = new Date().toISOString();
  return {
    version: 2,
    revision: 0, // First write will increment to 1
    repository: repo,
    repositoryKey: repoKey,
    uid: userInfo().uid,
    journalId,
    manifestPath,
    manifestDigest,
    approvedDigest,
    ownerPrincipal,
    initialHead,
    queuePreimage,
    approvalTimestamp,
    importCommitSha: null,
    importTreeSha: null,
    commitParent: null,
    commitSubject: "feat(team): import tasks from plan manifest",
    tasks,
    queueIntent: [],
    queuePostimage: null,
    phase: "PREPARED",
    blockingReason: null,
    completedCommitSha: null,
    completedTasks: [],
    completedSequences: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Read with strict validation
// ---------------------------------------------------------------------------

const SHA256_RE = /^[a-f0-9]{64}$/;
const SHA1_RE = /^[a-f0-9]{40}$/;

export async function readImportJournal(path: string): Promise<ImportJournal> {
  await verifySecureStateObject(path, "file");
  const text = await readFile(path, "utf8");

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Journal file is not valid JSON");
  }

  // Known keys for version 2
  const knownKeys = new Set([
    "version", "revision", "repository", "repositoryKey", "uid",
    "journalId", "manifestPath", "manifestDigest", "approvedDigest",
    "ownerPrincipal", "initialHead", "queuePreimage",
    "approvalTimestamp", "importCommitSha", "importTreeSha",
    "commitParent", "commitSubject", "tasks", "queueIntent",
    "queuePostimage", "phase", "blockingReason",
    "completedCommitSha", "completedTasks", "completedSequences",
    "createdAt", "updatedAt",
  ]);
  for (const key of Object.keys(raw)) {
    if (!knownKeys.has(key)) {
      throw new Error(`Unknown journal field: '${key}'`);
    }
  }

  const j = raw as unknown as ImportJournal;

  // --- Version ---
  if (j.version !== 2) {
    throw new Error(
      j.version === 1
        ? "Journal schema version 1 is not supported. Resolve blocked imports manually."
        : `Unsupported journal version: ${j.version}`,
    );
  }

  // --- Revision ---
  if (typeof j.revision !== "number" || j.revision < 0 || !Number.isSafeInteger(j.revision)) {
    throw new Error("Journal missing or invalid revision");
  }

  // --- Repository identity ---
  if (!j.repository || typeof j.repository !== "string" || !isAbsolute(j.repository)) {
    throw new Error("Journal missing or invalid repository path");
  }
  if (!j.repositoryKey || typeof j.repositoryKey !== "string" || j.repositoryKey.length !== 64) {
    throw new Error("Journal missing or invalid repositoryKey");
  }
  if (typeof j.uid !== "number" || j.uid < 0) {
    throw new Error("Journal missing or invalid uid");
  }

  // --- Journal ID ---
  if (!j.journalId || typeof j.journalId !== "string" || j.journalId.includes("/") || j.journalId.includes("..")) {
    throw new Error("Journal missing or invalid journalId");
  }

  // --- Manifest ---
  if (!j.manifestPath || typeof j.manifestPath !== "string") {
    throw new Error("Journal missing manifestPath");
  }
  if (!j.manifestDigest || !SHA256_RE.test(j.manifestDigest)) {
    throw new Error("Journal missing or invalid manifestDigest");
  }
  if (!j.approvedDigest || !SHA256_RE.test(j.approvedDigest)) {
    throw new Error("Journal missing or invalid approvedDigest");
  }

  // --- Owner ---
  if (!j.ownerPrincipal || typeof j.ownerPrincipal !== "string") {
    throw new Error("Journal missing ownerPrincipal");
  }

  // --- Git state ---
  if (!j.initialHead || !SHA1_RE.test(j.initialHead)) {
    throw new Error("Journal missing or invalid initialHead");
  }
  if (j.importCommitSha !== null && !SHA1_RE.test(j.importCommitSha)) {
    throw new Error("Journal invalid importCommitSha");
  }
  if (j.importTreeSha !== null && !SHA1_RE.test(j.importTreeSha)) {
    throw new Error("Journal invalid importTreeSha");
  }
  if (j.commitParent !== null && !SHA1_RE.test(j.commitParent)) {
    throw new Error("Journal invalid commitParent");
  }
  if (j.completedCommitSha !== null && !SHA1_RE.test(j.completedCommitSha)) {
    throw new Error("Journal invalid completedCommitSha");
  }

  // --- Commit subject ---
  if (!j.commitSubject || typeof j.commitSubject !== "string") {
    throw new Error("Journal missing commitSubject");
  }

  // --- Timestamps ---
  if (!j.approvalTimestamp || !Number.isFinite(Date.parse(j.approvalTimestamp))) {
    throw new Error("Journal missing or invalid approvalTimestamp");
  }
  if (!j.createdAt || !Number.isFinite(Date.parse(j.createdAt))) {
    throw new Error("Journal missing or invalid createdAt");
  }
  if (!j.updatedAt || !Number.isFinite(Date.parse(j.updatedAt))) {
    throw new Error("Journal missing or invalid updatedAt");
  }

  // --- Queue preimage ---
  validateQueuePreimage(j.queuePreimage, "queuePreimage");

  // --- Queue postimage (nullable) ---
  if (j.queuePostimage !== null) {
    validateQueuePreimage(j.queuePostimage, "queuePostimage");
  }

  // --- Tasks ---
  if (!Array.isArray(j.tasks)) {
    throw new Error("Journal tasks must be an array");
  }
  const taskIds = new Set<string>();
  for (const task of j.tasks) {
    if (!task || typeof task !== "object") {
      throw new Error(`Journal task entry is not an object`);
    }
    const t = task as unknown as Record<string, unknown>;
    if (!t.taskId || typeof t.taskId !== "string") {
      throw new Error("Journal task entry missing taskId");
    }
    if (!t.briefPath || typeof t.briefPath !== "string" || t.briefPath.includes("..") || isAbsolute(t.briefPath)) {
      throw new Error(`Journal task entry has invalid briefPath: ${t.taskId}`);
    }
    if (!t.statusPath || typeof t.statusPath !== "string" || t.statusPath.includes("..") || isAbsolute(t.statusPath)) {
      throw new Error(`Journal task entry has invalid statusPath: ${t.taskId}`);
    }
    if (!t.briefDigest || typeof t.briefDigest !== "string" || !SHA256_RE.test(t.briefDigest)) {
      throw new Error(`Journal task entry missing or invalid briefDigest: ${t.taskId}`);
    }
    if (!t.contractDigest || typeof t.contractDigest !== "string" || !SHA256_RE.test(t.contractDigest)) {
      throw new Error(`Journal task entry missing or invalid contractDigest: ${t.taskId}`);
    }
    if (typeof t.briefSize !== "number" || t.briefSize < 0) {
      throw new Error(`Journal task entry invalid briefSize: ${t.taskId}`);
    }
    if (typeof t.briefMode !== "number" || t.briefMode < 0o100 || t.briefMode > 0o777) {
      throw new Error(`Journal task entry invalid briefMode: ${t.taskId}`);
    }
    if (typeof t.statusSize !== "number" || t.statusSize < 0) {
      throw new Error(`Journal task entry invalid statusSize: ${t.taskId}`);
    }
    if (typeof t.statusMode !== "number" || t.statusMode < 0o100 || t.statusMode > 0o777) {
      throw new Error(`Journal task entry invalid statusMode: ${t.taskId}`);
    }
    if (taskIds.has(t.taskId as string)) {
      throw new Error(`Duplicate task ID in journal: ${t.taskId}`);
    }
    taskIds.add(t.taskId as string);
  }

  // --- Queue intent ---
  if (!Array.isArray(j.queueIntent)) {
    throw new Error("Journal queueIntent must be an array");
  }
  for (const qi of j.queueIntent) {
    if (!qi.taskId || typeof qi.taskId !== "string") {
      throw new Error("Journal queueIntent entry missing taskId");
    }
    if (typeof qi.sequence !== "number" || qi.sequence < 0) {
      throw new Error(`Journal queueIntent entry invalid sequence: ${qi.taskId}`);
    }
    if (!SHA1_RE.test(qi.expectedHead)) {
      throw new Error(`Journal queueIntent entry invalid expectedHead: ${qi.taskId}`);
    }
    if (!SHA256_RE.test(qi.approvedBriefDigest)) {
      throw new Error(`Journal queueIntent entry invalid approvedBriefDigest: ${qi.taskId}`);
    }
    if (!SHA256_RE.test(qi.contractDigest)) {
      throw new Error(`Journal queueIntent entry invalid contractDigest: ${qi.taskId}`);
    }
  }

  // --- Completed result ---
  if (!Array.isArray(j.completedTasks)) {
    throw new Error("Journal completedTasks must be an array");
  }
  if (!Array.isArray(j.completedSequences)) {
    throw new Error("Journal completedSequences must be an array");
  }

  // --- Phase ---
  if (!validateJournalPhase(j.phase)) {
    throw new Error(`Invalid journal phase: ${(j as any).phase}`);
  }

  // --- Phase-specific required fields ---
  if (j.phase === "BLOCKED" && (!j.blockingReason || typeof j.blockingReason !== "string")) {
    throw new Error("Blocked journal missing blockingReason");
  }
  if (j.phase === "COMPLETED" && !j.completedCommitSha) {
    throw new Error("Completed journal missing completedCommitSha");
  }
  if (j.phase === "GIT_INSTALLED" && !j.importCommitSha) {
    throw new Error("GIT_INSTALLED journal missing importCommitSha");
  }

  return j;
}

function validateQueuePreimage(
  value: unknown,
  label: string,
): asserts value is QueuePreimageSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error(`Journal ${label} must be an object`);
  }
  const q = value as Record<string, unknown>;
  if (typeof q.revision !== "number" || q.revision < 0 || !Number.isSafeInteger(q.revision)) {
    throw new Error(`Journal ${label}.revision is invalid`);
  }
  if (q.expectedHead !== null && (typeof q.expectedHead !== "string" || !SHA1_RE.test(q.expectedHead))) {
    throw new Error(`Journal ${label}.expectedHead is invalid`);
  }
  if (typeof q.paused !== "boolean") {
    throw new Error(`Journal ${label}.paused must be a boolean`);
  }
  if (typeof q.nextSequence !== "number" || q.nextSequence < 0 || !Number.isSafeInteger(q.nextSequence)) {
    throw new Error(`Journal ${label}.nextSequence is invalid`);
  }
}

// ---------------------------------------------------------------------------
// Write with phase CAS
// ---------------------------------------------------------------------------

/**
 * Atomically persist a journal, enforcing phase compare-and-swap.
 *
 * `expectedPhase` and `expectedRevision` must match the current persisted
 * journal on disk. The new journal phase must be a legal transition from
 * `expectedPhase`. On success the revision is incremented.
 */
export async function writeImportJournal(
  path: string,
  journal: ImportJournal,
  capability: SideEffectCapability,
  expectedPhase: ImportPhase,
  expectedRevision: number,
): Promise<void> {
  capability.assertHeld();

  // Read current journal from disk to verify CAS
  let currentPhase: ImportPhase;
  let currentRevision: number;
  try {
    const current = await readImportJournal(path);
    currentPhase = current.phase;
    currentRevision = current.revision;
  } catch (error) {
    // If file doesn't exist, treat as fresh write — accept any expectedPhase
    // and expectedRevision=0. The new journal's revision will be 1.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      currentPhase = expectedPhase;
      currentRevision = expectedRevision;
    } else {
      throw error;
    }
  }

  // Verify phase CAS
  if (currentPhase !== expectedPhase) {
    throw new Error(
      `Journal phase CAS failed: expected ${expectedPhase}, got ${currentPhase}`,
    );
  }

  // Verify revision CAS
  if (currentRevision !== expectedRevision) {
    throw new Error(
      `Journal revision CAS failed: expected ${expectedRevision}, got ${currentRevision}`,
    );
  }

  // Verify legal transition
  assertLegalTransition(expectedPhase, journal.phase);

  // Increment revision
  journal.revision = currentRevision + 1;
  journal.updatedAt = new Date().toISOString();

  // Atomic write
  const parent = dirname(path);
  await ensureSecureDirectory(parent);

  const tmp = `${path}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const content = JSON.stringify(journal, null, 2) + "\n";

  const handle = await fsOpen(
    tmp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  await verifySecureStateObject(tmp, "file");
  capability.assertHeld();

  await rename(tmp, path);
  await verifySecureStateObject(path, "file");

  const dirHandle = await fsOpen(
    parent,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
  );
  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
}

/**
 * Publish a complete PREPARED transaction bundle atomically.
 *
 * Creates the complete bundle in a private `.building-<id>` directory,
 * then atomically renames it. A crash before rename leaves no visible
 * journal and no live mutation.
 */
export async function publishPreparedBundle(
  repo: string,
  journal: ImportJournal,
  manifestContent: string,
  taskFiles: Array<{ taskId: string; briefContent: string; statusContent: string }>,
  sourceFiles: Array<{ path: string; content: Buffer; mode: string; sha256: string }>,
  capability: SideEffectCapability,
  stateRoot?: string,
): Promise<string> {
  capability.assertHeld();

  const root = stateRoot ?? defaultDurableStateRoot();
  const repoKey = journal.repositoryKey;
  const importsDir = resolve(root, "imports", repoKey);
  await ensureSecureDirectory(importsDir);

  const buildingDir = resolve(importsDir, `.building-${journal.journalId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  // Never delete existing directories — unique suffix guarantees no collision

  // Build the complete bundle
  await mkdir(buildingDir, { mode: 0o700 });

  // Write approved manifest
  await writeFile(
    resolve(buildingDir, "approved-manifest.yaml"),
    manifestContent,
    { mode: 0o400 },
  );

  // Create sources directory and write verified source blobs
  const sourcesDir = resolve(buildingDir, "sources");
  await mkdir(sourcesDir, { mode: 0o700 });
  for (const sf of sourceFiles) {
    // sf.path is relative; we write to the base name inside sources/
    const destName = sf.path.includes("/") ? sf.path.split("/").pop()! : sf.path;
    await writeFile(resolve(sourcesDir, destName), sf.content, { mode: 0o400 });
  }

  // Write task files
  const tasksDir = resolve(buildingDir, "tasks");
  for (const tf of taskFiles) {
    const td = resolve(tasksDir, tf.taskId);
    await mkdir(td, { recursive: true, mode: 0o700 });
    await writeFile(resolve(td, "brief.md"), tf.briefContent, { mode: 0o400 });
    await writeFile(resolve(td, "status.yaml"), tf.statusContent, { mode: 0o400 });
  }

  // Write journal
  const journalContent = JSON.stringify(journal, null, 2) + "\n";
  await writeFile(resolve(buildingDir, "journal.json"), journalContent, { mode: 0o400 });

  // Fsync the building directory and all contents
  await fsyncRecursive(buildingDir);

  // Atomically rename to published path.
  // Journal IDs are unique — if the destination exists something is wrong.
  const publishedDir = resolve(importsDir, journal.journalId);
  await rename(buildingDir, publishedDir);

  // Fsync the imports directory
  const importsHandle = await fsOpen(
    importsDir,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
  );
  try {
    await importsHandle.sync();
  } finally {
    await importsHandle.close();
  }

  return publishedDir;
}

/** Fsync a directory and all its contents recursively. */
async function fsyncRecursive(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      await fsyncRecursive(full);
    } else {
      const h = await fsOpen(full, constants.O_RDONLY);
      try {
        await h.sync();
      } finally {
        await h.close();
      }
    }
  }
  const dirHandle = await fsOpen(dir, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
}

export async function readBundleArtifact(
  repo: string,
  journalId: string,
  artifactPath: string,
  stateRoot?: string,
): Promise<Buffer> {
  const bundleDir = await importBundleDir(repo, journalId, stateRoot);
  const fullPath = resolve(bundleDir, artifactPath);
  if (artifactPath.includes("..") || !fullPath.startsWith(bundleDir)) {
    throw new Error(`Artifact path escapes bundle: ${artifactPath}`);
  }
  return readFile(fullPath);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

export function createImportJournalId(): string {
  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function digestFile(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Repository identity
// ---------------------------------------------------------------------------

const canonicalCache = new Map<string, string>();

async function getCanonicalRepo(repo: string): Promise<string> {
  const cached = canonicalCache.get(repo);
  if (cached) return cached;
  const canonical = await realpath(repo);
  canonicalCache.set(repo, canonical);
  return canonical;
}

async function getRepoKey(repo: string): Promise<string> {
  const canonical = await getCanonicalRepo(repo);
  return createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// Journal scanning
// ---------------------------------------------------------------------------

/**
 * Find any non-terminal import journal for this repository.
 * Returns BLOCKED journals too (they were previously excluded).
 * Rejects if multiple incomplete (non-COMPLETED, non-BLOCKED) journals exist.
 */
/**
 * Scan all journal files/dirs, returning parsed journals and any corrupt paths.
 * Corrupt evidence is never silently skipped.
 */
async function scanJournals(
  importsDir: string,
): Promise<{ parsed: Array<{ journalId: string; path: string; journal: ImportJournal }>; corrupt: string[] }> {
  let files: string[];
  try {
    files = await readdir(importsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { parsed: [], corrupt: [] };
    throw error;
  }

  const parsed: Array<{ journalId: string; path: string; journal: ImportJournal }> = [];
  const corrupt: string[] = [];

  for (const file of files) {
    let journalPath: string;
    let journalId: string;

    const dirPath = resolve(importsDir, file);
    try {
      const s = await stat(dirPath);
      if (s.isDirectory() && !file.startsWith(".building-")) {
        journalPath = resolve(dirPath, "journal.json");
        journalId = file;
      } else if (file.endsWith(".json") && !file.startsWith(".")) {
        journalPath = dirPath;
        journalId = file.replace(".json", "");
      } else {
        continue;
      }
    } catch {
      continue;
    }

    try {
      const journal = await readImportJournal(journalPath);
      parsed.push({ journalId, path: journalPath, journal });
    } catch (err) {
      corrupt.push(`${journalPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (corrupt.length > 0) {
    throw new Error(
      `Unreadable import evidence blocks new imports. Resolve manually:\n${corrupt.join("\n")}`,
    );
  }

  return { parsed, corrupt };
}

/**
 * Find any active (non-COMPLETED, non-BLOCKED) import journal.
 * BLOCKED journals are intentionally excluded — they are resolved evidence
 * that does not prevent new imports.
 */
export async function findAnyJournal(
  repo: string,
  stateRoot?: string,
): Promise<{ journalId: string; path: string; journal: ImportJournal } | null> {
  const root = stateRoot ?? defaultDurableStateRoot();
  const importsDir = await getImportsDir(repo, root);
  const { parsed } = await scanJournals(importsDir);

  const activeIncomplete = parsed.filter(
    j => j.journal.phase !== "COMPLETED" && j.journal.phase !== "BLOCKED",
  );
  if (activeIncomplete.length > 1) {
    throw new Error(
      `Multiple incomplete journals exist for this repository: ` +
        activeIncomplete.map(j => j.journalId).join(", "),
    );
  }

  return activeIncomplete[0] || null;
}

/**
 * Find a blocked journal matching the given import request.
 */
export async function findBlockedJournal(
  repo: string,
  approvedDigest: string,
  ownerPrincipal: string,
  stateRoot?: string,
): Promise<{ journalId: string; path: string; journal: ImportJournal } | null> {
  const root = stateRoot ?? defaultDurableStateRoot();
  const importsDir = await getImportsDir(repo, root);
  const { parsed } = await scanJournals(importsDir);

  for (const { journalId, path, journal } of parsed) {
    if (
      journal.phase === "BLOCKED" &&
      journal.approvedDigest === approvedDigest &&
      journal.ownerPrincipal === ownerPrincipal
    ) {
      return { journalId, path, journal };
    }
  }

  return null;
}

/**
 * Find a completed journal matching the given import request.
 */
export async function findCompletedJournal(
  repo: string,
  approvedDigest: string,
  ownerPrincipal: string,
  stateRoot?: string,
): Promise<{ journalId: string; path: string; journal: ImportJournal } | null> {
  const root = stateRoot ?? defaultDurableStateRoot();
  const importsDir = await getImportsDir(repo, root);
  const { parsed } = await scanJournals(importsDir);

  for (const { journalId, path, journal } of parsed) {
    if (
      journal.phase === "COMPLETED" &&
      journal.approvedDigest === approvedDigest &&
      journal.ownerPrincipal === ownerPrincipal
    ) {
      return { journalId, path, journal };
    }
  }

  return null;
}

/**
 * Find any incomplete (non-COMPLETED, non-BLOCKED) import journal.
 */
export async function findIncompleteJournal(
  repo: string,
  stateRoot?: string,
): Promise<{ journalId: string; path: string; journal: ImportJournal } | null> {
  const root = stateRoot ?? defaultDurableStateRoot();
  const importsDir = await getImportsDir(repo, root);
  const { parsed } = await scanJournals(importsDir);

  for (const { journalId, path, journal } of parsed) {
    if (journal.phase !== "COMPLETED" && journal.phase !== "BLOCKED") {
      return { journalId, path, journal };
    }
  }

  return null;
}

async function getImportsDir(repo: string, root: string): Promise<string> {
  const repoKey = await getRepoKey(repo);
  return resolve(root, "imports", repoKey);
}
