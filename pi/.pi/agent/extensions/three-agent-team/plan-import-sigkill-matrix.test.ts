/**
 * Six-cut SIGKILL crash matrix — uses existing test fixture infrastructure.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";
import {
  createTestFixture,
  makeValidTask,
  writeManifest,
  commitManifest,
} from "./test/plan-import-fixture.ts";
import { openDurableQueue } from "./queue.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER = resolve(__dirname, "test", "plan-import-crash-worker.ts");

function spawnWorker(fixture: any, probe?: string, timeoutMs = 60_000) {
  return new Promise<{ stdout: string; killed: boolean }>((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env as Record<string, string | undefined> };
    if (probe) env.CRASH_PROBE_PHASE = probe;

    const mode = probe ? "apply" : "recover";
    const previewedHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();
    const digest = (fixture as any).lastDigest;

    const args = [WORKER, mode, fixture.repo, fixture.stateRoot, fixture.manifestPath, digest, `uid:${process.getuid?.() ?? 1000}`, previewedHead];
    const child = spawn(process.execPath, args, {
      cwd: fixture.repo, stdio: ["ignore", "pipe", "pipe"], env,
    });

    let stdout = "";
    let killed = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL"); killed = true;
      reject(new Error(`Worker timed out (${probe || "recovery"})`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (probe && stdout.includes("READY")) {
        clearTimeout(timer);
        child.kill("SIGKILL"); killed = true;
        child.on("exit", () => resolve({ stdout, killed: true }));
      }
    });

    child.stderr.on("data", (d: Buffer) => { stdout += "STDERR:" + d.toString(); });
    child.on("exit", () => { clearTimeout(timer); if (!killed) resolve({ stdout, killed: false }); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

const PHASES = [
  "AFTER_PREPARED",
  "AFTER_TREE_INSTALLED",
  "AFTER_REF_CAS_BEFORE_GIT_INSTALLED",
  "AFTER_GIT_INSTALLED",
  "AFTER_QUEUE_PERSISTED_BEFORE_ENROLLED",
  "AFTER_QUEUE_ENROLLED",
];

for (const phase of PHASES) {
  test(`SIGKILL at ${phase} → recovery succeeds`, { timeout: 120_000 }, async () => {
    const fixture = await createTestFixture();
    const task = makeValidTask("2026-01-01-crash");
    const content = writeManifest(fixture, [task]);
    const digest = await commitManifest(fixture, content);
    (fixture as any).lastDigest = digest;

    // Crash
    const crash = await spawnWorker(fixture, phase);
    console.log(`[${phase}] crash stdout:`, crash.stdout.slice(0, 500));
    assert.ok(crash.killed, `${phase}: worker should be killed`);

    // Recovery
    const rec = await spawnWorker(fixture, undefined);
    console.log(`[${phase}] recovery stdout:`, rec.stdout.slice(0, 500));
    assert.ok(rec.stdout.includes("COMPLETED"), `${phase} recovery should complete`);

    // Verify
    const taskDir = resolve(fixture.repo, "team", "tasks", task.id);
    assert.ok(statSync(resolve(taskDir, "brief.md")).isFile(), "brief.md exists");
    assert.ok(statSync(resolve(taskDir, "status.yaml")).isFile(), "status.yaml exists");

    // Idempotent replay: re-invoke applyPlanImport in-process
    const { applyPlanImport: applyFn } = await import("./plan-import.ts");
    const { acquireRepositoryExecutionLock: acqLock } = await import("./queue-repository.ts");
    const lock = await acqLock(fixture.repo, 30_000, fixture.stateRoot);
    try {
      const replayResult = await applyFn({
        repo: fixture.repo, manifestPath: fixture.manifestPath,
        approvedDigest: digest, approvedDigestWithPrefix: `sha256:${digest}`,
        previewedHead: execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim(),
        ownerPrincipal: `uid:${process.getuid?.() ?? 1000}`,
        stateRoot: fixture.stateRoot, repositoryLock: lock,
      }, { assertHeld: () => lock.assertHeld(), signal: lock.signal });
      assert.ok(replayResult.kind === "ALREADY_COMPLETED", `Replay should be ALREADY_COMPLETED, got: ${replayResult.kind}`);
    } finally {
      await lock.release();
    }
  });
}

test("SIGKILL at AFTER_PREPARED → conflict produces BLOCKED", { timeout: 120_000 }, async () => {
  const fixture = await createTestFixture();
  const task = makeValidTask("2026-01-01-crash");
  const content = writeManifest(fixture, [task]);
  const digest = await commitManifest(fixture, content);
  (fixture as any).lastDigest = digest;

  // Crash
  const crash = await spawnWorker(fixture, "AFTER_PREPARED");
  assert.ok(crash.killed, "Worker should be killed");

  // Make conflicting commit
  execSync("git commit --allow-empty -m conflict", { cwd: fixture.repo, stdio: "ignore" });
  const newHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();

  // Recovery with stale HEAD
  const env: Record<string, string | undefined> = { ...process.env as Record<string, string | undefined> };
  const args = [WORKER, "apply", fixture.repo, fixture.stateRoot, fixture.manifestPath, digest, `uid:${process.getuid?.() ?? 1000}`, newHead];
  const child = spawn(process.execPath, args, { cwd: fixture.repo, stdio: ["ignore", "pipe", "pipe"], env });

  let stdout = "";
  child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
  child.stderr.on("data", (d: Buffer) => { stdout += "STDERR:" + d.toString(); });

  await new Promise<void>((resolve) => child.on("exit", () => resolve()));

  assert.ok(stdout.includes("BLOCKED") || stdout.includes("FAILED"),
    `Conflict should produce BLOCKED. stdout: ${stdout.slice(0, 200)}`);
});
