/**
 * The completion seal.
 *
 * Owns the completion window: the span between freezing the reviewed
 * worktree and installing the exact completion commit. Inside the window,
 * only the named completion-evidence files may change. The seal is the
 * only place that constructs or parses the COMMITTING journal detail, so
 * the forward path and crash-recovery path always agree on its shape.
 *
 * Verification runs between opening the window and sealing it, is owned by
 * the caller, and may fail and loop back to Builder — so the window has
 * three touchpoints rather than one call: {@link freezeCompletionWindow}
 * (policy precondition, then freeze), {@link writeCompletionEvidence}
 * (evidence bytes once rendered), and {@link sealCompletion} (the atomic
 * git tail: commit, journal, install).
 *
 * See CONTEXT.md for the domain terms (completion window, completion seal,
 * completion evidence, completion journal, reviewed tree, exact commit).
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SideEffectCapability } from "./durable-state.ts";
import {
  atomicRepositoryWrite,
  completeExactCommit,
  freezeReviewedTree,
  installExactCommit,
  reconcileJournaledExactCommit,
  type ExactCommit,
  type ReviewedTree,
} from "./queue-repository.ts";

export type { ReviewedTree } from "./queue-repository.ts";

/** The durable checkpoints the caller journals as it crosses the completion window. */
export interface CompletionJournal {
  markVerified(detail: string): Promise<void>;
  markCommitting(detail: string): Promise<void>;
  complete(commitSha: string): Promise<void>;
}

/** A completion-evidence file rendered by the caller, written inside the window as bytes. */
export interface CompletionEvidence {
  /** Repo-relative path, e.g. `team/tasks/<id>/status.yaml`. */
  path: string;
  bytes: string;
}

export interface CompletionPolicy {
  pushOnSuccess: boolean;
  deployOnSuccess: boolean;
}

export interface SealedCompletion {
  commitSha: string;
}

function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Opens the completion window: fails closed on unsupported completion
 * policy before anything is touched, then freezes the Reviewer-approved
 * worktree so later evidence writes can be diffed against it. Call before
 * verification runs — the reviewed tree must predate verification.log and
 * every other evidence write.
 */
export async function freezeCompletionWindow(
  repo: string,
  expectedParent: string,
  capability: SideEffectCapability,
  completionPolicy: CompletionPolicy,
): Promise<ReviewedTree> {
  if (completionPolicy.pushOnSuccess || completionPolicy.deployOnSuccess) {
    throw new Error("V1 extension refuses push/deploy; set both policies false or extend the implementation explicitly");
  }
  return freezeReviewedTree(repo, expectedParent, capability);
}

/** The VERIFIED journal payload. Audit only — crash recovery never parses it. */
export function verifiedJournalDetail(reviewedTree: ReviewedTree): string {
  return JSON.stringify({ reviewedTree });
}

/**
 * Writes rendered completion-evidence bytes and returns their digests,
 * computed from the same in-memory bytes that were written — never a
 * disk re-read. Call once verification has passed and evidence is
 * rendered; safe to call whether or not a commit will follow.
 */
export async function writeCompletionEvidence(
  repo: string,
  evidence: readonly CompletionEvidence[],
  capability: SideEffectCapability,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const item of evidence) {
    await atomicRepositoryWrite(resolve(repo, item.path), item.bytes, capability);
    result[item.path] = digest(item.bytes);
  }
  return result;
}

/**
 * Digests a completion-evidence file already on disk. The only evidence
 * file this applies to is `verification.log`: it is written incrementally
 * by the success-test runner across a long subprocess sequence, so its
 * bytes have no other home to be handed to {@link writeCompletionEvidence}
 * from.
 */
export async function digestExistingEvidence(repo: string, path: string): Promise<string> {
  return digest(await readFile(resolve(repo, path)));
}

interface CommittingJournalDetail {
  tree: string;
  parent: string;
  subject: string;
  commit: string;
  indexDigest: string;
}

/** Exported for the seal's own tests: proves the forward path's journal string is exactly what {@link resumeSealedCompletion} can parse. */
export function serializeCommittingDetail(exact: ExactCommit): string {
  const detail: CommittingJournalDetail = {
    tree: exact.treeSha,
    parent: exact.parent,
    subject: exact.subject,
    commit: exact.commitSha,
    indexDigest: exact.indexDigest,
  };
  return JSON.stringify(detail);
}

export interface SealCompletionRequest {
  repo: string;
  taskId: string;
  expectedParent: string;
  reviewedTree: ReviewedTree;
  capability: SideEffectCapability;
  /** Digests of every completion-evidence file, from {@link writeCompletionEvidence} plus {@link digestExistingEvidence} for verification.log. */
  expectedEvidence: Readonly<Record<string, string>>;
  /** Omitted for immediate (non-queued) completion. */
  journal?: CompletionJournal;
}

/**
 * Closes the completion window: creates and installs the exact completion
 * commit, journaling the COMMITTING checkpoint between commit-tree and
 * update-ref so crash recovery has something to reconcile against.
 */
export async function sealCompletion(request: SealCompletionRequest): Promise<SealedCompletion> {
  const { repo, taskId, expectedParent, reviewedTree, capability, expectedEvidence, journal } = request;

  const exact = await completeExactCommit(repo, taskId, expectedParent, reviewedTree, expectedEvidence, capability);
  await journal?.markCommitting(serializeCommittingDetail(exact));

  await installExactCommit(repo, exact, capability);
  await journal?.complete(exact.commitSha);

  return { commitSha: exact.commitSha };
}

/**
 * Crash-recovery path: reconcile a previously journaled COMMITTING detail
 * against the repository and install it if not already installed.
 */
export async function resumeSealedCompletion(
  repo: string,
  journaledDetail: string | null,
  expectedParent: string,
  capability: SideEffectCapability,
  onComplete: (commitSha: string) => Promise<void>,
): Promise<SealedCompletion> {
  const exact = await reconcileJournaledExactCommit(repo, journaledDetail, expectedParent, capability);
  await onComplete(exact.commitSha);
  return { commitSha: exact.commitSha };
}
