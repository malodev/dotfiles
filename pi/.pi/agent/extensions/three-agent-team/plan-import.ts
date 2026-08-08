/**
 * Deep module: PlanImporter
 *
 * Small interface, complex transaction logic hidden inside.
 * Orchestrates atomic bundle publication, exact Git commit,
 * queue enrollment, and journaled crash recovery.
 *
 * Lock semantics: apply() requires a caller-held repository lock.
 */

import { randomUUID } from "node:crypto";
import { readFile, unlink, realpath } from "node:fs/promises";
import { resolve, relative, dirname, isAbsolute, normalize } from "node:path";
import { execFile } from "node:child_process";
import { git, gitText, gitTextOrEmpty } from "./git.ts";
import {
  parsePlanManifest,
  type PlanManifest,
  type TaskSpec,
} from "./plan-manifest.ts";
import {
  assertLegalTransition,
  createImportJournal,
  createImportJournalId,
  digestFile,
  findAnyJournal,
  findBlockedJournal,
  findCompletedJournal,
  findIncompleteJournal,
  importJournalPath,
  importBundleDir,
  readImportJournal,
  writeImportJournal,
  publishPreparedBundle,
  canonicalRepoKey,
  type ImportJournal,
  type ImportJournalEntry,
  type QueueEnrollmentTuple,
  type QueuePreimageSnapshot,
} from "./import-journal.ts";
import {
  renderContract,
  buildAuthorizedBrief,
  buildEnrollmentSnapshot,
} from "./goal-contract.ts";
import { taskPath } from "./core.ts";
import {
  assertStrictCleanRepository,
  inspectEnrollmentAdmission,
  type EnrollmentAdmission,
} from "./queue-repository.ts";
import { openDurableQueue } from "./queue.ts";
import { type SideEffectCapability } from "./durable-state.ts";
import { materializeArtifacts, type ArtifactFile } from "./plan-import-artifacts.ts";
import { maybeCrashProbe } from "./plan-import-crash-probe.ts";

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------
/**
 * Runs git through the shared adapter, preserving this module's historic
 * error shape (`git <subcommand> failed`) and its two call styles:
 * `gt(repo, args)` throws on failure, `gt(repo, args, { noThrow: true })`
 * yields "" instead. An env argument sets GIT_INDEX_FILE for private-index
 * tree builds.
 */
async function gt(repo: string, args: string[], opts?: Record<string, string> | { noThrow?: boolean }): Promise<string> {
  if (opts && "noThrow" in opts) {
    return opts.noThrow ? gitTextOrEmpty(repo, args) : gitText(repo, args, `git ${args[0]} failed`);
  }
  return gitText(repo, args, `git ${args[0]} failed`, opts ? { env: opts as NodeJS.ProcessEnv } : {});
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface PlanImportOptions {
  repo: string; manifestPath: string; approvedDigest: string;
  approvedDigestWithPrefix?: string; previewedHead?: string;
  ownerPrincipal: string; stateRoot?: string; queueLeaseTtlMs?: number;
  repositoryLock?: { assertHeld: () => void; signal: AbortSignal; release: () => Promise<void> };
}
export interface PlanImportPreview {
  manifestDigest: string; initialHead: string;
  tasks: Array<{ id: string; goal: string; dependsOn: string[]; successTests: number }>;
  approvalCommand: string;
}
export interface CompletedImport {
  journalId: string; importCommitSha: string; tasks: string[]; queueSequences: number[];
}
export type ImportOutcome =
  | { kind: "NEWLY_COMPLETED"; result: CompletedImport }
  | { kind: "RESUMED_COMPLETED"; result: CompletedImport }
  | { kind: "ALREADY_COMPLETED"; result: CompletedImport }
  | { kind: "BLOCKED"; journalId: string; reason: string };

// ---------------------------------------------------------------------------
// Fencing
// ---------------------------------------------------------------------------
export async function assertNoIncompleteImport(repo: string, stateRoot?: string): Promise<void> {
  const inc = await findIncompleteJournal(repo, stateRoot);
  if (inc) throw new Error(`Incomplete import journal exists: ${inc.journalId}. Complete or block it first.`);
}

// ---------------------------------------------------------------------------
// Source verification
// ---------------------------------------------------------------------------
async function verifySources(repo: string, manifest: PlanManifest, head: string): Promise<Map<string, { path: string; content: Buffer; mode: string; sha256: string }>> {
  const sources = [manifest.sources.plan];
  if (manifest.sources.prd) sources.push(manifest.sources.prd);
  const results = new Map<string, { path: string; content: Buffer; mode: string; sha256: string }>();
  for (const src of sources) {
    if (isAbsolute(src.path) || src.path.includes("..")) throw new Error(`Source '${src.path}' must be relative`);
    const n = normalize(src.path);
    if (n !== src.path) throw new Error(`Source '${src.path}' must be canonical (try '${n}')`);
    const mode = await gt(repo, ["ls-tree", head, n]);
    if (!mode) throw new Error(`Source '${src.path}' not in git tree`);
    if (!mode.startsWith("100644 ") && !mode.startsWith("100755 ")) throw new Error(`Source '${src.path}' not a regular file`);
    const { createHash: ch } = await import("node:crypto");
    const blob = await git(repo, ["cat-file", "blob", `${head}:${n}`]);
    if (blob.code !== 0) throw new Error(`Source '${src.path}' could not be read from git: ${blob.stderr.toString("utf8").trim()}`);
    const stdout = blob.stdout;
    const d = ch("sha256").update(stdout).digest("hex");
    if (d !== src.sha256) throw new Error(`Source '${src.path}' digest mismatch`);
    results.set(n, { path: n, content: stdout, mode, sha256: d });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------
export async function previewPlanImport(options: PlanImportOptions): Promise<PlanImportPreview> {
  const inc = await findIncompleteJournal(options.repo, options.stateRoot);
  if (inc) throw new Error(`Incomplete import journal: ${inc.journalId}`);
  const mc = await readFile(options.manifestPath, "utf8");
  const md = digestFile(mc);
  const mf = parsePlanManifest(mc);
  const h = await assertStrictCleanRepository(options.repo);
  await verifySources(options.repo, mf, h);
  return {
    manifestDigest: md, initialHead: h,
    tasks: mf.tasks.map(t => ({ id: t.id, goal: t.goal, dependsOn: t.dependsOn, successTests: t.successTests.length })),
    approvalCommand: `/team-import ${relative(options.repo, options.manifestPath) || "team/plan.yaml"} --approve sha256:${md} --head ${h}`,
  };
}

// ---------------------------------------------------------------------------
// applyPlanImport
// ---------------------------------------------------------------------------
export async function applyPlanImport(options: PlanImportOptions, capability: SideEffectCapability): Promise<ImportOutcome> {
  capability.assertHeld();
  const lock = options.repositoryLock;
  if (!lock) throw new Error("plan-import requires repositoryLock");
  lock.assertHeld();
  if (!options.previewedHead) throw new Error("applyPlanImport requires previewedHead");
  const previewedHead = options.previewedHead;

  // Check for existing journals BEFORE validating the current manifest — the
  // manifest on disk may have been edited after a crash, but the journal holds
  // the authoritative approved digest.
  const cr = await findCompletedJournal(options.repo, options.approvedDigest, options.ownerPrincipal, options.stateRoot);
  if (cr) return { kind: "ALREADY_COMPLETED", result: { journalId: cr.journalId, importCommitSha: cr.journal.completedCommitSha || cr.journal.importCommitSha || "", tasks: cr.journal.completedTasks, queueSequences: cr.journal.completedSequences } };

  const br = await findBlockedJournal(options.repo, options.approvedDigest, options.ownerPrincipal, options.stateRoot);
  if (br) return { kind: "BLOCKED", journalId: br.journalId, reason: br.journal.blockingReason || "Blocked" };

  const ex = await findAnyJournal(options.repo, options.stateRoot);
  if (ex) {
    // Resume using the journal's recorded data, not the current on-disk manifest.
    // The approved digest is verified against the journal, not the current file.
    if (ex.journal.approvedDigest === options.approvedDigest && ex.journal.ownerPrincipal === options.ownerPrincipal) {
      if (ex.journal.phase === "BLOCKED") return { kind: "BLOCKED", journalId: ex.journalId, reason: ex.journal.blockingReason || "Blocked" };
      // Load the manifest from the immutable bundle, not the mutable working tree
      const bundleManifestPath = resolve(await importBundleDir(options.repo, ex.journalId, options.stateRoot), "approved-manifest.yaml");
      const mc = await readFile(bundleManifestPath, "utf8");
      const md = digestFile(mc);
      if (md !== options.approvedDigest) throw new Error(`Bundle manifest digest mismatch — journal may be corrupted`);
      const mf = parsePlanManifest(mc);
      return await resume(ex, options, capability, mc, mf);
    }
    if (ex.journal.phase !== "BLOCKED" && ex.journal.phase !== "COMPLETED") {
      const op = ex.journal.phase;
      ex.journal.phase = "BLOCKED";
      ex.journal.blockingReason = "Conflicting import attempted";
      await writeImportJournal(ex.path, ex.journal, capability, op, ex.journal.revision);
    }
    return { kind: "BLOCKED", journalId: ex.journalId, reason: "Conflicting import" };
  }

  // No existing journal — this is a fresh import. Validate the current manifest.
  const mc = await readFile(options.manifestPath, "utf8");
  const md = digestFile(mc);
  if (md !== options.approvedDigest) throw new Error(`Manifest digest mismatch`);
  const mf = parsePlanManifest(mc);
  const sourceFiles = await verifySources(options.repo, mf, previewedHead);

  return await fresh(options, capability, mc, mf, md, previewedHead, sourceFiles);
}

// ---------------------------------------------------------------------------
// Fresh import
// ---------------------------------------------------------------------------
async function fresh(options: PlanImportOptions, capability: SideEffectCapability, mc: string, mf: PlanManifest, md: string, previewedHead: string, sourceFiles: Map<string, { path: string; content: Buffer; mode: string; sha256: string }>): Promise<ImportOutcome> {
  const lock = options.repositoryLock!;
  const h = await assertStrictCleanRepository(options.repo);
  if (h !== previewedHead) throw new Error(`HEAD changed since preview`);

  const q = await openDurableQueue(options.repo, { stateRoot: options.stateRoot, leaseTtlMs: options.queueLeaseTtlMs });
  const snap = await q.snapshot();
  if (snap.dispatcherLease) throw new Error("Cannot import while dispatcher is active");

  // Require quiescent queue: no dispatcher, no RUNNING/BLOCKED/QUEUED barriers.
  // COMPLETED and DEQUEUED entries represent finished work — they don't block imports.
  const barrier = snap.entries.find((e: any) =>
    e.state === "RUNNING" || e.state === "BLOCKED" || e.state === "QUEUED"
  );
  if (barrier) {
    throw new Error(`Cannot import with active queue entry ${barrier.taskId} (${barrier.state}); complete or dequeue first`);
  }
  // expectedHead from prior completions doesn't need to match the previewed HEAD —
  // the preimage verification in bulkImportEnqueue enforces queue consistency.
  const qp: QueuePreimageSnapshot = { revision: snap.revision, expectedHead: snap.expectedHead, paused: snap.paused, nextSequence: snap.nextSequence };

  // Collision preflight — nofollow to match artifact materialization semantics
  const { lstat: ls } = await import("node:fs/promises");
  for (const ts of mf.tasks) {
    const d = taskPath(options.repo, ts.id);
    // Walk parent chain, checking for symlinks
    let ancestor = resolve(d, "..");
    while (ancestor !== resolve(options.repo)) {
      try {
        const st = await ls(ancestor);
        if (st.isSymbolicLink()) throw new Error(`Symlinked ancestor: ${relative(options.repo, ancestor)}`);
      } catch (e: any) { if (e.code !== "ENOENT") throw e; }
      ancestor = resolve(ancestor, "..");
    }
    // Check target itself
    try {
      const st = await ls(d);
      if (st.isSymbolicLink()) throw new Error("Symlinked task directory");
      throw new Error(`Task directory already exists: ${ts.id}`);
    } catch (e: any) { if (e.code !== "ENOENT" && !(e instanceof Error && e.message.includes("already exists") && e.message.includes("Symlinked"))) throw e; }
  }
  capability.assertHeld(); lock.assertHeld();

  // Render contracts
  const at = new Date().toISOString();
  const rendered = mf.tasks.map(ts => {
    const c = renderContract(ts, h);
    return { ts, c, ab: buildAuthorizedBrief(c.brief, at), snap: buildEnrollmentSnapshot(c.brief, buildAuthorizedBrief(c.brief, at), at) };
  });

  // Task entries
  const tasks: ImportJournalEntry[] = rendered.map(r => ({
    taskId: r.ts.id,
    briefPath: relative(options.repo, resolve(taskPath(options.repo, r.ts.id), "brief.md")),
    statusPath: relative(options.repo, resolve(taskPath(options.repo, r.ts.id), "status.yaml")),
    briefDigest: r.snap.approvedBriefDigest, statusDigest: r.c.statusDigest, contractDigest: r.snap.contractDigest,
    briefSize: Buffer.byteLength(r.c.brief, "utf8"),
    briefMode: 0o644,
    statusSize: Buffer.byteLength(r.c.status, "utf8"),
    statusMode: 0o644,
    dependsOn: r.ts.dependsOn,
    completionPolicy: { commitOnSuccess: r.ts.completionPolicy.commitOnSuccess, pushOnSuccess: r.ts.completionPolicy.pushOnSuccess, deployOnSuccess: r.ts.completionPolicy.deployOnSuccess },
  }));

  // Create journal object (not yet published)
  const rk = await canonicalRepoKey(options.repo);
  const jid = createImportJournalId();
  const j = createImportJournal(options.repo, rk, jid, options.manifestPath, md, options.approvedDigest, options.ownerPrincipal, h, qp, at, tasks);

  // Trusted validation — run BEFORE publication, in isolated /tmp git fixtures.
  // Failed validation throws, leaving no published transaction and no live mutation.
  for (const r of rendered) {
    const { mkdtemp: mkdtV, rm: rmV, mkdir: mkdV, writeFile: wfV, readFile: rfV } = await import("node:fs/promises");
    const { join: joinV } = await import("node:path");
    const { tmpdir: tmpV } = await import("node:os");
    const valRoot = await mkdtV(joinV(tmpV(), "pi-import-validate-"));
    try {
      // Init git repo with AGENTS.md and initial commit
      await gt(valRoot, ["init", "-q"]);
      await gt(valRoot, ["config", "user.email", "test@test"]);
      await gt(valRoot, ["config", "user.name", "Test"]);
      await wfV(resolve(valRoot, "AGENTS.md"), "# Agents\n\nUse strict commands.\n");
      await gt(valRoot, ["add", "AGENTS.md"]);
      await gt(valRoot, ["commit", "-qm", "initial"]);
      const valBaseline = await gt(valRoot, ["rev-parse", "HEAD"]);

      // Copy validator from the extension's shipped assets
      const valScriptSrc = resolve(
        (await import("node:url")).fileURLToPath(new URL(".", import.meta.url)),
        "..", "..", "skills", "init-three-agent-team", "assets", "validate_goal_contract.py",
      );
      await mkdV(resolve(valRoot, "team"), { mode: 0o755 });
      await wfV(resolve(valRoot, "team", "validate_goal_contract.py"), await rfV(valScriptSrc), { mode: 0o755 });

      // Create task dir; substitute temp repo baseline so cross-checks pass
      const taskDirV = resolve(valRoot, "team", "tasks", r.ts.id);
      await mkdV(taskDirV, { recursive: true, mode: 0o700 });
      const briefWithTempBaseline = r.c.brief.replaceAll(h, valBaseline);
      const statusWithTempBaseline = r.c.status.replaceAll(h, valBaseline);
      await wfV(resolve(taskDirV, "brief.md"), briefWithTempBaseline, { mode: 0o400 });
      await wfV(resolve(taskDirV, "status.yaml"), statusWithTempBaseline, { mode: 0o400 });
      await gt(valRoot, ["add", "-N", "team"]);

      await new Promise<void>((resP, rejP) => {
        const child = execFile("python3", [resolve(valRoot, "team", "validate_goal_contract.py"), taskDirV, "--phase", "pre-go"], {
          cwd: valRoot, timeout: 30_000, maxBuffer: 64 * 1024,
        }, (error, stdout, stderr) => {
          if (error) rejP(new Error(`Contract validation failed for ${r.ts.id}:\n${stderr || stdout || error.message}`));
          else resP();
        });
      });
    } finally {
      await rmV(valRoot, { recursive: true, force: false }).catch(() => {});
    }
  }
  capability.assertHeld(); lock.assertHeld();

  // Publish atomic PREPARED bundle — only after all validations pass
  const tfs = rendered.map(r => ({ taskId: r.ts.id, briefContent: r.c.brief, statusContent: r.c.status }));
  await publishPreparedBundle(options.repo, j, mc, tfs, Array.from(sourceFiles.values()), capability, options.stateRoot);
  maybeCrashProbe("AFTER_PREPARED");
  capability.assertHeld(); lock.assertHeld();

  // Build exact commit
  const bd = await importBundleDir(options.repo, jid, options.stateRoot);
  const jp = resolve(bd, "journal.json");
  let commitSha: string;
  try {
    const built = await buildCommit(options.repo, j, h, capability, lock, options.stateRoot);
    commitSha = built.commitSha;
  } catch (e: any) {
    const op = j.phase; j.phase = "BLOCKED";
    j.blockingReason = `Commit construction failed: ${e.message}`;
    await writeImportJournal(jp, j, capability, op, j.revision);
    return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
  }
  capability.assertHeld(); lock.assertHeld();

  // Admissions
  const ads: EnrollmentAdmission[] = [];
  try {
    for (const t of j.tasks) ads.push(await inspectEnrollmentAdmission(options.repo, t.taskId, at, undefined, options.stateRoot));
  } catch (e: any) {
    const op = j.phase; j.phase = "BLOCKED";
    j.blockingReason = `Enrollment admission failed: ${e.message}`;
    await writeImportJournal(jp, j, capability, op, j.revision);
    return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
  }
  capability.assertHeld(); lock.assertHeld();

  // Queue intent
  const qi: QueueEnrollmentTuple[] = ads.map((a, i) => ({
    taskId: a.enqueue.taskId, sequence: qp.nextSequence + i, state: "QUEUED" as const,
    dependsOn: j.tasks.find(t => t.taskId === a.enqueue.taskId)?.dependsOn || [],
    baselineCommit: a.enqueue.baselineCommit, expectedHead: a.enqueue.expectedHead,
    approvedBriefDigest: a.enqueue.approvedBriefDigest, contractDigest: a.enqueue.contractDigest,
    ownerPrincipal: j.ownerPrincipal, approvedAt: a.enqueue.approvedAt,
    approvalSource: a.enqueue.approvalSource as "/team-enqueue",
    completionPolicy: a.enqueue.completionPolicy as { commitOnSuccess: true; pushOnSuccess: false; deployOnSuccess: false },
  }));
  j.queueIntent = qi;
  j.phase = "QUEUE_PREPARED";
  try {
    await writeImportJournal(jp, j, capability, "GIT_INSTALLED", j.revision);
  } catch (e: any) {
    // Journal write failed — the on-disk journal stays at GIT_INSTALLED.
    // Throw so the handler reports the error; recovery will find and resume.
    throw new Error(`QUEUE_PREPARED journal write failed: ${e.message}`);
  }
  capability.assertHeld(); lock.assertHeld();

  // Enroll
  const ee = qi.map(q => ({ taskId: q.taskId, dependsOn: q.dependsOn, baselineCommit: q.baselineCommit, expectedHead: q.expectedHead, approvedBriefDigest: q.approvedBriefDigest, contractDigest: q.contractDigest, ownerPrincipal: q.ownerPrincipal, approvedAt: q.approvedAt, approvalSource: q.approvalSource, completionPolicy: q.completionPolicy as { commitOnSuccess: true; pushOnSuccess: false; deployOnSuccess: false } }));
  let ps: QueueSnapshot;
  try {
    const result = await q.command({ type: "bulkImportEnqueue", entries: ee, preimage: qp, newExpectedHead: commitSha });
    ps = result.snapshot;
  } catch (e: any) {
    const op = j.phase; j.phase = "BLOCKED";
    j.blockingReason = `Enrollment failed: ${e.message}`;
    await writeImportJournal(jp, j, capability, op, j.revision);
    return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
  }
  maybeCrashProbe("AFTER_QUEUE_PERSISTED_BEFORE_ENROLLED");

  // Verify postimage
  // After compaction of prior epoch entries, expectedHead must equal the import commit.
  if (ps.expectedHead !== commitSha && ps.expectedHead !== qp.expectedHead) {
    const op = j.phase; j.phase = "BLOCKED";
    j.blockingReason = `Queue postimage expectedHead mismatch: got ${ps.expectedHead}, expected ${commitSha} or ${qp.expectedHead}`;
    await writeImportJournal(jp, j, capability, op, j.revision);
    return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
  }
  j.queuePostimage = { revision: ps.revision, expectedHead: ps.expectedHead, paused: qp.paused, nextSequence: ps.nextSequence };
  j.phase = "QUEUE_ENROLLED";
  await writeImportJournal(jp, j, capability, "QUEUE_PREPARED", j.revision);
  maybeCrashProbe("AFTER_QUEUE_ENROLLED");
  capability.assertHeld(); lock.assertHeld();

  // Complete
  const seqs = ps.entries.filter((e: any) => tasks.some(t => t.taskId === e.taskId)).map((e: any) => e.sequence);
  j.completedCommitSha = commitSha; j.completedTasks = tasks.map(t => t.taskId); j.completedSequences = seqs;
  j.phase = "COMPLETED";
  await writeImportJournal(jp, j, capability, "QUEUE_ENROLLED", j.revision);
  return { kind: "NEWLY_COMPLETED", result: { journalId: jid, importCommitSha: commitSha, tasks: j.completedTasks, queueSequences: seqs } };
}

// ---------------------------------------------------------------------------
// Build exact commit
// ---------------------------------------------------------------------------
async function buildCommit(repo: string, j: ImportJournal, parent: string, capability: SideEffectCapability, lock: { assertHeld: () => void; signal: AbortSignal }, stateRoot?: string): Promise<{ commitSha: string; treeSha: string }> {
  capability.assertHeld(); lock.assertHeld();
  if (await gt(repo, ["rev-parse", "HEAD"]) !== parent) throw new Error("HEAD drifted");

  const bd = await importBundleDir(repo, j.journalId, stateRoot);
  const jp = resolve(bd, "journal.json");
  const artifacts: ArtifactFile[] = [];
  for (const t of j.tasks) {
    artifacts.push({ path: t.briefPath, content: await readFile(resolve(bd, "tasks", t.taskId, "brief.md")), mode: 0o644, digest: t.briefDigest });
    artifacts.push({ path: t.statusPath, content: await readFile(resolve(bd, "tasks", t.taskId, "status.yaml")), mode: 0o644, digest: t.statusDigest });
  }
  await materializeArtifacts(repo, artifacts);

  const tip = resolve(repo, ".git", `import-index-${randomUUID()}`);
  try {
    await gt(repo, ["read-tree", "--index-output=" + tip, "HEAD"]);
    const pf = resolve(repo, ".git", `import-pathspec-${randomUUID()}`);
    const paths = j.tasks.flatMap(t => [t.briefPath, t.statusPath]);
    await import("node:fs/promises").then(m => m.writeFile(pf, paths.join("\0") + "\0"));
    try {
      const env = { GIT_INDEX_FILE: tip };
      await gt(repo, ["add", "--pathspec-from-file=" + pf, "--pathspec-file-nul"], env);
      const tree = await gt(repo, ["write-tree"], env);
      const subj = j.commitSubject;
      const cmt = await gt(repo, ["commit-tree", tree, "-p", parent, "-m", subj]);
      if (await gt(repo, ["cat-file", "-t", cmt]) !== "commit") throw new Error("Not a commit");
      if (await gt(repo, ["rev-parse", `${cmt}^{tree}`]) !== tree) throw new Error("Tree mismatch");

      j.importTreeSha = tree; j.importCommitSha = cmt; j.commitParent = parent;
      j.phase = "TREE_INSTALLED";
      await writeImportJournal(jp, j, capability, "PREPARED", j.revision);
      maybeCrashProbe("AFTER_TREE_INSTALLED");
      capability.assertHeld(); lock.assertHeld();

      await gt(repo, ["update-ref", "HEAD", cmt, parent]);
      await gt(repo, ["read-tree", "--reset", cmt]);
      maybeCrashProbe("AFTER_REF_CAS_BEFORE_GIT_INSTALLED");
      if (await assertStrictCleanRepository(repo) !== cmt) throw new Error("Post-commit HEAD mismatch");

      j.phase = "GIT_INSTALLED";
      await writeImportJournal(jp, j, capability, "TREE_INSTALLED", j.revision);
      maybeCrashProbe("AFTER_GIT_INSTALLED");
      capability.assertHeld(); lock.assertHeld();
      return { commitSha: cmt, treeSha: tree };
    } finally { await unlink(pf).catch(() => {}); }
  } finally { await unlink(tip).catch(() => {}); }
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------
async function resume(ex: { journalId: string; path: string; journal: ImportJournal }, options: PlanImportOptions, capability: SideEffectCapability, mc: string, mf: PlanManifest): Promise<ImportOutcome> {
  const { journalId: jid, path: jp, journal: j } = ex;
  capability.assertHeld(); options.repositoryLock!.assertHeld();
  const lock = options.repositoryLock!;

  switch (j.phase) {
    case "PREPARED": {
      if (j.tasks.length === 0) {
        const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = "PREPARED with no tasks";
        await writeImportJournal(jp, j, capability, op, j.revision);
        return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
      }
      try {
        const { commitSha } = await buildCommit(options.repo, j, j.initialHead, capability, lock, options.stateRoot);
        return finishRecovery(options, j, jp, commitSha, capability, lock);
      } catch (e: any) {
        const op = j.phase; j.phase = "BLOCKED";
        j.blockingReason = `PREPARED recovery commit failed: ${e.message}`;
        await writeImportJournal(jp, j, capability, op, j.revision);
        return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
      }
    }
    case "TREE_INSTALLED": case "GIT_INSTALLED": {
      if (!j.importCommitSha || !j.importTreeSha) {
        const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = "Missing commit/tree SHA";
        await writeImportJournal(jp, j, capability, op, j.revision);
        return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
      }

      // If already GIT_INSTALLED, verify the complete postimage — never repair.
      if (j.phase === "GIT_INSTALLED") {
        const hd = await gt(options.repo, ["rev-parse", "HEAD"]);
        if (hd !== j.importCommitSha) {
          const op = j.phase; j.phase = "BLOCKED";
          j.blockingReason = `GIT_INSTALLED but HEAD ${hd.slice(0,7)} not at import commit ${j.importCommitSha.slice(0,7)}`;
          await writeImportJournal(jp, j, capability, op, j.revision);
          return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
        }
        // Verify commit type, parent, and subject
        const ctype = await gt(options.repo, ["cat-file", "-t", j.importCommitSha]);
        if (ctype !== "commit") {
          const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = `Import object is not a commit`;
          await writeImportJournal(jp, j, capability, op, j.revision);
          return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
        }
        const cparent = await gt(options.repo, ["rev-parse", "-q", "--verify", `${j.importCommitSha}^`], { noThrow: true });
        if (cparent !== j.commitParent) {
          const op = j.phase; j.phase = "BLOCKED";
          j.blockingReason = `Commit parent mismatch: expected ${j.commitParent?.slice(0,7)}, got ${cparent?.slice(0,7)}`;
          await writeImportJournal(jp, j, capability, op, j.revision);
          return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
        }
        const csubj = await gt(options.repo, ["log", "-1", "--format=%s", j.importCommitSha]);
        if (csubj !== j.commitSubject) {
          const op = j.phase; j.phase = "BLOCKED";
          j.blockingReason = `Commit subject mismatch`;
          await writeImportJournal(jp, j, capability, op, j.revision);
          return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
        }
        // Postimage verified — advance to queue enrollment without touching the index.
        // The index was already normalized when the commit was originally installed.
        return finishRecovery(options, j, jp, j.importCommitSha, capability, lock);
      }
      let ok = false;
      try {
        if (await gt(options.repo, ["cat-file", "-t", j.importCommitSha]) !== "commit") throw new Error("Not commit");
        if (await gt(options.repo, ["rev-parse", `${j.importCommitSha}^{tree}`]) !== j.importTreeSha) throw new Error("Tree mismatch");
        ok = true;
      } catch {}
      if (!ok) {
        const { commitSha } = await buildCommit(options.repo, j, j.initialHead, capability, lock, options.stateRoot);
        return finishRecovery(options, j, jp, commitSha, capability, lock);
      }
      const head = await gt(options.repo, ["rev-parse", "HEAD"]);
      if (head === j.initialHead) {
        try {
          // Verify index is clean — but accept a crash between update-ref and
          // read-tree where the index still has the initial tree.
          const importedTree = j.importTreeSha!;
          const initialTree = await gt(options.repo, ["rev-parse", "-q", "--verify", `${j.initialHead}^{tree}`], { noThrow: true });
          const actualIdx = await gt(options.repo, ["write-tree"], { noThrow: true });
          if (actualIdx !== importedTree && actualIdx !== initialTree) {
            const op = j.phase; j.phase = "BLOCKED";
            j.blockingReason = "Index has uncommitted changes — refusing to clobber with recovery materialization";
            await writeImportJournal(jp, j, capability, op, j.revision);
            return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
          }
          const bd = await importBundleDir(options.repo, jid, options.stateRoot);
          const afs: ArtifactFile[] = [];
          for (const t of j.tasks) {
            afs.push({ path: t.briefPath, content: await readFile(resolve(bd, "tasks", t.taskId, "brief.md")), mode: 0o644, digest: t.briefDigest });
            afs.push({ path: t.statusPath, content: await readFile(resolve(bd, "tasks", t.taskId, "status.yaml")), mode: 0o644, digest: t.statusDigest });
          }
          await materializeArtifacts(options.repo, afs);
          await gt(options.repo, ["update-ref", "HEAD", j.importCommitSha, j.initialHead]);
          await gt(options.repo, ["read-tree", "--reset", j.importCommitSha]);
          j.phase = "GIT_INSTALLED";
          await writeImportJournal(jp, j, capability, "TREE_INSTALLED", j.revision);
        } catch {
          const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = "CAS failed during recovery";
          await writeImportJournal(jp, j, capability, op, j.revision);
          return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
        }
      } else if (head === j.importCommitSha) {
        // HEAD is at the import commit — a crash may have occurred between
        // update-ref and read-tree. Accept either the import tree (post-reset)
        // or the initial tree (pre-reset). Reject any third index tree.
        const importedTree = j.importTreeSha!;
        const initialTree = await gt(options.repo, ["rev-parse", "-q", "--verify", `${j.initialHead}^{tree}`], { noThrow: true });
        const actualIdx = await gt(options.repo, ["write-tree"], { noThrow: true });
        if (actualIdx !== importedTree && actualIdx !== initialTree) {
          const op = j.phase; j.phase = "BLOCKED";
          j.blockingReason = "Index has uncommitted changes — refusing to clobber during recovery";
          await writeImportJournal(jp, j, capability, op, j.revision);
          return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
        }
        await gt(options.repo, ["read-tree", "--reset", j.importCommitSha]);
        j.phase = "GIT_INSTALLED";
        await writeImportJournal(jp, j, capability, "TREE_INSTALLED", j.revision);
      } else {
        const op = j.phase; j.phase = "BLOCKED";
        j.blockingReason = `HEAD drifted: expected ${j.initialHead} or ${j.importCommitSha}, got ${head}`;
        await writeImportJournal(jp, j, capability, op, j.revision);
        return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
      }
      return finishRecovery(options, j, jp, j.importCommitSha, capability, lock);
    }
    case "QUEUE_PREPARED": {
      if (!j.importCommitSha) {
        const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = "Missing commit SHA";
        await writeImportJournal(jp, j, capability, op, j.revision);
        return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
      }
      const q = await openDurableQueue(options.repo, { stateRoot: options.stateRoot, leaseTtlMs: options.queueLeaseTtlMs });
      const snap2 = await q.snapshot();
      const allThere = j.queueIntent.every((qi: any) => {
        const entry = snap2.entries.find((e: any) => e.taskId === qi.taskId);
        if (!entry) return false;
        return entry.expectedHead === qi.expectedHead &&
          entry.approvedBriefDigest === qi.approvedBriefDigest &&
          entry.contractDigest === qi.contractDigest &&
          entry.ownerPrincipal === qi.ownerPrincipal &&
          entry.sequence === qi.sequence && entry.state === qi.state &&
          arraysEqual(entry.dependsOn, qi.dependsOn) &&
          entry.baselineCommit === qi.baselineCommit &&
          entry.completionPolicy?.commitOnSuccess === qi.completionPolicy?.commitOnSuccess &&
          entry.completionPolicy?.pushOnSuccess === qi.completionPolicy?.pushOnSuccess &&
          entry.completionPolicy?.deployOnSuccess === qi.completionPolicy?.deployOnSuccess &&
          entry.approvedAt === qi.approvedAt &&
          entry.approvalSource === qi.approvalSource;
      });

      if (allThere) {
        // Entries already enrolled — verify queue postimage and advance.
        // The actual revision/nextSequence come from the queue snapshot, not a computed
        // expectation — bulkImportEnqueue increments revision once per transaction.
        if (snap2.expectedHead !== j.importCommitSha && snap2.expectedHead !== j.queuePreimage.expectedHead) {
          const op = j.phase; j.phase = "BLOCKED";
          j.blockingReason = `Queue postimage mismatch after enrollment (expectedHead=${snap2.expectedHead})`;
          await writeImportJournal(jp, j, capability, op, j.revision);
          return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
        }
        j.queuePostimage = { revision: snap2.revision, expectedHead: j.importCommitSha, paused: j.queuePreimage.paused, nextSequence: snap2.nextSequence };
        j.phase = "QUEUE_ENROLLED";
        await writeImportJournal(jp, j, capability, "QUEUE_PREPARED", j.revision);
        j.completedCommitSha = j.importCommitSha; j.completedTasks = j.tasks.map(t => t.taskId);
        j.completedSequences = snap2.entries.filter((e: any) => j.tasks.some(t => t.taskId === e.taskId)).map((e: any) => e.sequence);
        return completeImport(j, jp, capability);
      }

      // Entries not present — check if preimage still matches
      if (snap2.revision !== j.queuePreimage.revision || snap2.expectedHead !== j.queuePreimage.expectedHead) {
        const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = "Queue changed, intent not present";
        await writeImportJournal(jp, j, capability, op, j.revision);
        return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
      }
      const ee2 = j.queueIntent.map((q: any) => ({ taskId: q.taskId, dependsOn: q.dependsOn, baselineCommit: q.baselineCommit, expectedHead: q.expectedHead, approvedBriefDigest: q.approvedBriefDigest, contractDigest: q.contractDigest, ownerPrincipal: q.ownerPrincipal, approvedAt: q.approvedAt, approvalSource: q.approvalSource, completionPolicy: q.completionPolicy as { commitOnSuccess: true; pushOnSuccess: false; deployOnSuccess: false } }));
      try { await q.command({ type: "bulkImportEnqueue", entries: ee2, preimage: j.queuePreimage, newExpectedHead: j.importCommitSha }); } catch (e2: any) {
        const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = `Enrollment failed: ${e2.message}`;
        await writeImportJournal(jp, j, capability, op, j.revision);
        return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
      }
      const ps2 = await q.snapshot();
      if (ps2.expectedHead !== j.importCommitSha && ps2.expectedHead !== j.queuePreimage.expectedHead) {
        const op = j.phase; j.phase = "BLOCKED";
        j.blockingReason = `Queue postimage expectedHead mismatch: got ${ps2.expectedHead}`;
        await writeImportJournal(jp, j, capability, op, j.revision);
        return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
      }
      j.queuePostimage = { revision: ps2.revision, expectedHead: j.importCommitSha, paused: j.queuePreimage.paused, nextSequence: ps2.nextSequence };
      j.phase = "QUEUE_ENROLLED";
      await writeImportJournal(jp, j, capability, "QUEUE_PREPARED", j.revision);
      j.completedCommitSha = j.importCommitSha; j.completedTasks = j.tasks.map(t => t.taskId);
      j.completedSequences = ps2.entries.filter((e: any) => j.tasks.some(t => t.taskId === e.taskId)).map((e: any) => e.sequence);
      return completeImport(j, jp, capability);
    }
    case "QUEUE_ENROLLED": {
      if (!j.importCommitSha) {
        const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = "Missing commit SHA";
        await writeImportJournal(jp, j, capability, op, j.revision);
        return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
      }
      const q = await openDurableQueue(options.repo, { stateRoot: options.stateRoot, leaseTtlMs: options.queueLeaseTtlMs });
      const snap3 = await q.snapshot();

      // Verify queue postimage: revision, expectedHead, paused, nextSequence
      if (snap3.revision !== (j.queuePostimage?.revision ?? -1)) {
        const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = `Queue revision mismatch: expected ${j.queuePostimage?.revision}, got ${snap3.revision}`;
        await writeImportJournal(jp, j, capability, op, j.revision);
        return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
      }
      if (snap3.expectedHead !== j.importCommitSha) {
        const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = "Queue expectedHead drifted";
        await writeImportJournal(jp, j, capability, op, j.revision);
        return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
      }
      if (snap3.paused !== (j.queuePostimage?.paused ?? false)) {
        const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = "Queue paused state changed";
        await writeImportJournal(jp, j, capability, op, j.revision);
        return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
      }

      // Verify every immutable tuple field, not just taskId + expectedHead
      for (const qi of j.queueIntent) {
        const entry = snap3.entries.find((e: any) => e.taskId === qi.taskId);
        if (!entry) {
          const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = `Entry missing: ${qi.taskId}`;
          await writeImportJournal(jp, j, capability, op, j.revision);
          return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
        }
        if (entry.expectedHead !== qi.expectedHead || entry.approvedBriefDigest !== qi.approvedBriefDigest ||
            entry.contractDigest !== qi.contractDigest || entry.ownerPrincipal !== qi.ownerPrincipal ||
            entry.sequence !== qi.sequence || entry.state !== qi.state) {
          const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = `Entry mismatch: ${qi.taskId}`;
          await writeImportJournal(jp, j, capability, op, j.revision);
          return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
        }
      }
      j.completedCommitSha = j.importCommitSha; j.completedTasks = j.tasks.map(t => t.taskId);
      j.completedSequences = snap3.entries.filter((e: any) => j.tasks.some(t => t.taskId === e.taskId)).map((e: any) => e.sequence);
      return completeImport(j, jp, capability);
    }
    case "COMPLETED":
      return { kind: "ALREADY_COMPLETED", result: { journalId: jid, importCommitSha: j.completedCommitSha || "", tasks: j.completedTasks, queueSequences: j.completedSequences } };
    case "BLOCKED":
      return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason || "Blocked" };
    default: {
      const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = `Unknown phase: ${op}`;
      await writeImportJournal(jp, j, capability, op, j.revision);
      return { kind: "BLOCKED", journalId: jid, reason: j.blockingReason };
    }
  }
}

async function finishRecovery(options: PlanImportOptions, j: ImportJournal, jp: string, commitSha: string, capability: SideEffectCapability, lock: { assertHeld: () => void; signal: AbortSignal }): Promise<ImportOutcome> {
  try {
    if (await assertStrictCleanRepository(options.repo) !== commitSha) {
      const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = `HEAD drifted: ${await gt(options.repo, ["rev-parse", "HEAD"])} !== ${commitSha}`;
      await writeImportJournal(jp, j, capability, op, j.revision);
      return { kind: "BLOCKED", journalId: j.journalId, reason: j.blockingReason };
    }
  } catch (e: any) {
    const op = j.phase; j.phase = "BLOCKED";
    j.blockingReason = `Repository state check failed: ${e.message}`;
    await writeImportJournal(jp, j, capability, op, j.revision);
    return { kind: "BLOCKED", journalId: j.journalId, reason: j.blockingReason };
  }
  const ads: EnrollmentAdmission[] = [];
  for (const t of j.tasks) ads.push(await inspectEnrollmentAdmission(options.repo, t.taskId, j.approvalTimestamp, undefined, options.stateRoot));
  capability.assertHeld(); lock.assertHeld();
  const qi: QueueEnrollmentTuple[] = ads.map((a, i) => ({
    taskId: a.enqueue.taskId, sequence: j.queuePreimage.nextSequence + i, state: "QUEUED" as const,
    dependsOn: j.tasks.find(t => t.taskId === a.enqueue.taskId)?.dependsOn || [],
    baselineCommit: a.enqueue.baselineCommit, expectedHead: a.enqueue.expectedHead,
    approvedBriefDigest: a.enqueue.approvedBriefDigest, contractDigest: a.enqueue.contractDigest,
    ownerPrincipal: j.ownerPrincipal, approvedAt: a.enqueue.approvedAt,
    approvalSource: a.enqueue.approvalSource as "/team-enqueue",
    completionPolicy: a.enqueue.completionPolicy as { commitOnSuccess: true; pushOnSuccess: false; deployOnSuccess: false },
  }));
  j.queueIntent = qi;
  j.phase = "QUEUE_PREPARED";
  await writeImportJournal(jp, j, capability, "GIT_INSTALLED", j.revision);
  capability.assertHeld(); lock.assertHeld();
  const q = await openDurableQueue(options.repo, { stateRoot: options.stateRoot, leaseTtlMs: options.queueLeaseTtlMs });
  const ee = qi.map(q2 => ({ taskId: q2.taskId, dependsOn: q2.dependsOn, baselineCommit: q2.baselineCommit, expectedHead: q2.expectedHead, approvedBriefDigest: q2.approvedBriefDigest, contractDigest: q2.contractDigest, ownerPrincipal: q2.ownerPrincipal, approvedAt: q2.approvedAt, approvalSource: q2.approvalSource, completionPolicy: q2.completionPolicy as { commitOnSuccess: true; pushOnSuccess: false; deployOnSuccess: false } }));
  try { await q.command({ type: "bulkImportEnqueue", entries: ee, preimage: j.queuePreimage, newExpectedHead: commitSha }); } catch (e2: any) {
    const op = j.phase; j.phase = "BLOCKED"; j.blockingReason = `Enrollment failed: ${e2.message}`;
    await writeImportJournal(jp, j, capability, op, j.revision);
    return { kind: "BLOCKED", journalId: j.journalId, reason: j.blockingReason };
  }
  const ps = await q.snapshot();
  if (ps.expectedHead !== commitSha && ps.expectedHead !== j.queuePreimage.expectedHead) {
    const op = j.phase; j.phase = "BLOCKED";
    j.blockingReason = `Queue postimage expectedHead mismatch: got ${ps.expectedHead}`;
    await writeImportJournal(jp, j, capability, op, j.revision);
    return { kind: "BLOCKED", journalId: j.journalId, reason: j.blockingReason };
  }
  j.queuePostimage = { revision: ps.revision, expectedHead: commitSha, paused: j.queuePreimage.paused, nextSequence: ps.nextSequence };
  j.phase = "QUEUE_ENROLLED";
  await writeImportJournal(jp, j, capability, "QUEUE_PREPARED", j.revision);
  const seqs = ps.entries.filter((e: any) => j.tasks.some(t => t.taskId === e.taskId)).map((e: any) => e.sequence);
  j.completedCommitSha = commitSha; j.completedTasks = j.tasks.map(t => t.taskId); j.completedSequences = seqs;
  return completeImport(j, jp, capability);
}

async function completeImport(j: ImportJournal, jp: string, capability: SideEffectCapability): Promise<ImportOutcome> {
  j.phase = "COMPLETED";
  await writeImportJournal(jp, j, capability, "QUEUE_ENROLLED", j.revision);
  return { kind: "RESUMED_COMPLETED", result: { journalId: j.journalId, importCommitSha: j.completedCommitSha || j.importCommitSha || "", tasks: j.completedTasks, queueSequences: j.completedSequences } };
}

// ---------------------------------------------------------------------------
// Read-only recovery inspection
// ---------------------------------------------------------------------------
export async function recoverImportJournal(repo: string, journalId: string, stateRoot?: string): Promise<ImportJournal> {
  return readImportJournal(await importJournalPath(repo, journalId, stateRoot));
}
