/**
 * Atomic amendment of already-enqueued, unclaimed task contracts.
 *
 * Enrolled tasks freeze their approved-brief and contract digests in the
 * durable queue. Correcting a mistake across an imported batch would otherwise
 * mean dequeuing every task in reverse dependency order and re-importing,
 * losing the queue epoch. This applies the edits, commits them exactly, and
 * advances the queue to a new epoch with the new digests — as one journaled,
 * crash-resumable transaction.
 *
 * Digest/bytes divergence is not re-verified here: the dispatcher's
 * revalidateQueuedHead recomputes both digests from the committed brief before
 * authorizing anything and fails closed on drift, so a redundant pass would
 * only duplicate that check at N× the cost.
 */

import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isTaskId, relativeTaskPath } from "./core.ts";
import { gitText } from "./git.ts";
import { buildAuthorizedBrief } from "./goal-contract.ts";
import {
  durableReplaceJson,
  ensureSecureDirectory,
  readSecureJson,
  repositoryStatePaths,
  type SideEffectCapability,
} from "./durable-state.ts";
import {
  assertStrictCleanRepository,
  atomicRepositoryWrite,
  createExactWorktreeCommit,
  installExactCommit,
  runValidator,
  type ExactCommit,
} from "./queue-repository.ts";
import { openDurableQueue, type AmendQueuedContractsCommand } from "./queue.ts";

export interface QueuedContractTextEdit {
  path: string;
  oldText: string;
  newText: string;
}

export interface QueuedContractAmendmentSpec {
  amendmentId: string;
  taskIds: string[];
  edits: QueuedContractTextEdit[];
  subject: string;
}

interface AmendmentJournal {
  version: 1;
  amendmentId: string;
  phase: "PREPARED" | "GIT_INSTALLED" | "COMPLETED";
  exact: ExactCommit;
  command: AmendQueuedContractsCommand;
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function head(repo: string): Promise<string> {
  return gitText(repo, ["rev-parse", "HEAD"], "Queued amendment cannot resolve HEAD");
}

function parseJournal(value: unknown, amendmentId: string): AmendmentJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Queued amendment journal is invalid");
  const journal = value as AmendmentJournal;
  if (journal.version !== 1 || journal.amendmentId !== amendmentId || !["PREPARED", "GIT_INSTALLED", "COMPLETED"].includes(journal.phase)) {
    throw new Error("Queued amendment journal identity or phase is invalid");
  }
  return journal;
}

async function settleJournal(
  repo: string,
  journalPath: string,
  journal: AmendmentJournal,
  capability: SideEffectCapability,
  stateRoot?: string,
): Promise<{ commit: string; changed: boolean }> {
  capability.assertHeld();
  const currentHead = await head(repo);
  if (currentHead === journal.exact.parent) {
    await installExactCommit(repo, journal.exact, capability);
  } else if (currentHead !== journal.exact.commitSha) {
    throw new Error(`Queued amendment refuses unrelated HEAD ${currentHead}`);
  }
  if (journal.phase === "PREPARED") {
    journal = { ...journal, phase: "GIT_INSTALLED" };
    await durableReplaceJson(journalPath, journal, capability);
  }

  const queue = await openDurableQueue(repo, { stateRoot });
  const snapshot = await queue.snapshot();
  for (const amendment of journal.command.amendments) {
    if (!snapshot.entries.some((candidate) => candidate.taskId === amendment.taskId)) {
      throw new Error(`Queued amendment lost task ${amendment.taskId}`);
    }
  }
  const result = await queue.command(journal.command);
  journal = { ...journal, phase: "COMPLETED" };
  await durableReplaceJson(journalPath, journal, capability);
  return { commit: journal.exact.commitSha, changed: result.changed };
}

export async function applyQueuedContractAmendment(
  repo: string,
  spec: QueuedContractAmendmentSpec,
  capability: SideEffectCapability,
  stateRoot?: string,
): Promise<{ commit: string; changed: boolean }> {
  capability.assertHeld();
  if (!isTaskId(spec.amendmentId) || !spec.taskIds.length || new Set(spec.taskIds).size !== spec.taskIds.length) {
    throw new Error("Queued amendment identity or task list is invalid");
  }
  if (!spec.edits.length) throw new Error("Queued amendment requires text edits");
  const paths = await repositoryStatePaths(repo, stateRoot);
  const journalDir = resolve(paths.stateRoot, "queued-contract-amendments", paths.repositoryKey);
  await ensureSecureDirectory(journalDir);
  const journalPath = resolve(journalDir, `${spec.amendmentId}.json`);
  try {
    await access(journalPath);
    return await settleJournal(repo, journalPath, parseJournal(await readSecureJson(journalPath), spec.amendmentId), capability, stateRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const queue = await openDurableQueue(repo, { stateRoot });
  const snapshot = await queue.snapshot();
  const expectedHead = snapshot.expectedHead;
  if (!expectedHead || await head(repo) !== expectedHead) throw new Error("Queued amendment requires repository HEAD to equal queue expectedHead");
  if (await assertStrictCleanRepository(repo) !== expectedHead) throw new Error("Queued amendment requires an exact clean queue head");
  if (snapshot.dispatcherLease) throw new Error("Queued amendment requires an idle dispatcher");

  const taskSet = new Set(spec.taskIds);
  const entries = spec.taskIds.map((taskId) => {
    const entry = snapshot.entries.find((candidate) => candidate.taskId === taskId);
    if (!entry || entry.state !== "QUEUED" || entry.attempts.length || entry.authorizationHead) {
      throw new Error(`Queued amendment requires an unclaimed unauthorized task: ${taskId}`);
    }
    return entry;
  });

  const byPath = new Map<string, string>();
  for (const edit of spec.edits) {
    if (edit.path.startsWith("/") || edit.path.split("/").includes("..")) throw new Error(`Unsafe queued amendment path: ${edit.path}`);
    let text = byPath.get(edit.path) ?? await readFile(resolve(repo, edit.path), "utf8");
    const count = text.split(edit.oldText).length - 1;
    if (count === 1) text = text.replace(edit.oldText, edit.newText);
    else if (count === 0 && text.includes(edit.newText)) { /* idempotent worktree replay */ }
    else throw new Error(`Queued amendment edit must match exactly once: ${edit.path}`);
    byPath.set(edit.path, text);
  }
  for (const [path, text] of byPath) await atomicRepositoryWrite(resolve(repo, path), text, capability);

  for (const taskId of spec.taskIds) await runValidator(repo, taskId, undefined, "pre-go");
  for (const entry of snapshot.entries) {
    if (entry.state === "QUEUED" && !taskSet.has(entry.taskId)) await runValidator(repo, entry.taskId, undefined, "pre-go");
  }

  const exact = await createExactWorktreeCommit(repo, expectedHead, spec.subject, capability);
  const amendments = entries.map((entry) => {
    const brief = byPath.get(relativeTaskPath(entry.taskId, "brief.md"));
    if (brief === undefined) throw new Error(`Queued amendment did not edit brief.md for ${entry.taskId}`);
    return {
      taskId: entry.taskId,
      expectedApprovedBriefDigest: entry.approvedBriefDigest,
      expectedContractDigest: entry.contractDigest,
      approvedBriefDigest: digest(brief),
      contractDigest: digest(buildAuthorizedBrief(brief, entry.approvedAt)),
    };
  });
  const command: AmendQueuedContractsCommand = {
    type: "amendQueuedContracts",
    expectedHead,
    newExpectedHead: exact.commitSha,
    amendments,
    expectedRevision: snapshot.revision,
  };
  const journal: AmendmentJournal = { version: 1, amendmentId: spec.amendmentId, phase: "PREPARED", exact, command };
  await durableReplaceJson(journalPath, journal, capability);
  return await settleJournal(repo, journalPath, journal, capability, stateRoot);
}
