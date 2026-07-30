/**
 * Crash-matrix worker process.
 *
 * Usage: node --import tsx plan-import-crash-worker.ts <mode> <repo> <state> <manifest> <digest> <owner> [head]
 *
 * Modes:
 *   <crash-phase>  — run applyPlanImport; stall at probe for that phase
 *   recover        — run applyPlanImport for recovery (no probe env set)
 *   apply          — run applyPlanImport (for conflict testing, no probe)
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { acquireRepositoryExecutionLock } from "../queue-repository.ts";
import { applyPlanImport } from "../plan-import.ts";
import { currentUid } from "../durable-state.ts";

const args = process.argv.slice(2);
if (args.length < 6) {
  console.error("usage: worker <mode> <repo> <stateRoot> <manifestPath> <digest> <owner> [head]");
  process.exit(2);
}

const [mode, repo, stateRoot, manifestPath, digest, owner] = args;
const previewedHead = args[6] || execSync("git rev-parse HEAD", {
  cwd: repo, encoding: "utf8",
}).trim();

async function main() {
  if (mode === "recover") {
    // Recovery: no crash probe, just apply
    const lock = await acquireRepositoryExecutionLock(repo, 30_000, stateRoot);
    try {
      const result = await applyPlanImport({
        repo, manifestPath, approvedDigest: digest,
        approvedDigestWithPrefix: `sha256:${digest}`,
        previewedHead, ownerPrincipal: owner,
        stateRoot, repositoryLock: lock,
      }, {
        assertHeld: () => { if (lock.signal.aborted) throw new Error("lock lost"); },
        signal: lock.signal,
      });

      if (result.kind === "BLOCKED") {
        console.log(`BLOCKED ${result.journalId} ${result.reason}`);
      } else {
        console.log(`COMPLETED ${result.result.journalId} ${result.result.importCommitSha} ${result.kind}`);
      }
    } catch (error) {
      console.log(`FAILED ${(error as Error).message}`);
      process.exit(1);
    } finally {
      await lock.release();
    }
    return;
  }

  // Crash mode or apply mode
  const lock = await acquireRepositoryExecutionLock(repo, 30_000, stateRoot);
  try {
    const result = await applyPlanImport({
      repo, manifestPath, approvedDigest: digest,
      approvedDigestWithPrefix: `sha256:${digest}`,
      previewedHead, ownerPrincipal: owner,
      stateRoot, repositoryLock: lock,
    }, {
      assertHeld: () => { if (lock.signal.aborted) throw new Error("lock lost"); },
      signal: lock.signal,
    });

    if (result.kind === "BLOCKED") {
      console.log(`BLOCKED ${result.journalId} ${result.reason}`);
    } else {
      console.log(`COMPLETED ${result.result.journalId} ${result.result.importCommitSha} ${result.kind}`);
    }
  } catch (error) {
    console.log(`FAILED ${(error as Error).message}`);
    process.exit(1);
  } finally {
    await lock.release();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
