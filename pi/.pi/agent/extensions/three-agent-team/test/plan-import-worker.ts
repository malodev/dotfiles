/**
 * Subprocess worker for plan-import crash tests.
 *
 * Usage: node --test/plan-import-worker.ts <mode> <repo> <stateRoot> <manifestPath> <digest> <owner>
 *
 * Modes:
 *   apply          - Run full applyPlanImport
 *   apply-stalled  - Run applyPlanImport but stall indefinitely on "READY"
 *                    (parent sends SIGKILL at the right moment)
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { acquireRepositoryExecutionLock } from "../queue-repository.ts";
import { applyPlanImport, recoverImportJournal } from "../plan-import.ts";
import { currentUid } from "../durable-state.ts";
import { openDurableQueue } from "../queue.ts";

const [mode, repo, stateRoot, manifestPath, digest, owner] = process.argv.slice(2);

if (!mode || !repo || !stateRoot) {
  throw new Error(`usage: ${process.argv[1]} <mode> <repo> <stateRoot> [manifestPath digest owner]`);
}

function log(msg: string) {
  process.stdout.write(msg + "\n");
}

async function runApply() {
  const initialHead = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim();
  const lock = await acquireRepositoryExecutionLock(repo, 30_000, stateRoot);
  const capability = {
    assertHeld: () => {
      if (lock.signal.aborted) throw new Error("lock lost");
    },
    signal: lock.signal,
  };

  try {
    log("READY");
    const result = await applyPlanImport(
      {
        repo,
        manifestPath,
        approvedDigest: digest,
        approvedDigestWithPrefix: `sha256:${digest}`,
        previewedHead: initialHead,
        ownerPrincipal: owner,
        stateRoot,
        repositoryLock: lock,
      },
      capability,
    );
    const r = result.kind === "BLOCKED" ? { journalId: "", importCommitSha: "" } : result.result;
    log(`COMPLETED ${r.journalId} ${r.importCommitSha}`);
  } catch (error) {
    log(`FAILED ${(error as Error).message}`);
    process.exit(1);
  } finally {
    await lock.release();
  }
}

async function runRecover() {
  const journalId = process.argv[8];
  if (!journalId) throw new Error("recover mode requires journalId");
  const journal = await recoverImportJournal(repo, journalId, stateRoot);
  log(`RECOVERED ${journal.phase}`);
}

if (mode === "apply") {
  await runApply();
} else if (mode === "recover") {
  await runRecover();
} else {
  throw new Error(`unknown mode ${mode}`);
}
