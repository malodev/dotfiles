/**
 * End-to-end /team-go test: drives the real command handler through a
 * faked Builder and Reviewer role session, exercising executeWorkflow's
 * APPROVED branch (completion-seal.ts wiring) exactly as production would.
 *
 * executeWorkflow is an unexported closure reachable only through the
 * extension's registered commands, so there is no narrower seam to test
 * through — this is the smallest test that reaches it. See CONTEXT.md.
 *
 * Authorization records are written to the real, non-redirectable
 * ~/.local/state/pi-three-agent-team (by design: "Environment variables
 * cannot redirect this trust root", README.md). This test removes exactly
 * the repository-keyed subtree it creates in a `finally` block.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { defaultDurableStateRoot, identifyRepository } from "./durable-state.ts";
import { readStatus } from "./core.ts";
import threeAgentTeamExtension from "./index.ts";

function run(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(args[0], args.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk) => { err += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveRun(out.trim()) : reject(new Error(`${args.join(" ")} failed: ${err}`)));
  });
}

function fakePi() {
  const commands: Record<string, { handler: (args: string, ctx: any) => Promise<void> }> = {};
  const sentMessages: unknown[] = [];
  return {
    commands,
    sentMessages,
    registerCommand(name: string, opts: { handler: (args: string, ctx: any) => Promise<void> }) {
      commands[name] = opts;
    },
    on() {},
    sendMessage(message: unknown) {
      sentMessages.push(message);
    },
  };
}

function fakeCtx(cwd: string) {
  const notifications: Array<{ message: string; level: string }> = [];
  return {
    cwd,
    notifications,
    ui: {
      notify(message: string, level: string) { notifications.push({ message, level }); },
      setStatus() {},
      setWidget() {},
    },
    abort() { throw new Error("unexpected abort() call"); },
  };
}

// status.yaml flips to COMPLETED inside writeCompletionEvidence, before
// sealCompletion installs the commit and before pi.sendMessage fires — so
// polling status.yaml alone would race the seal's own tail. Wait for
// sendMessage (COMPLETED's last step) or BLOCKED, whichever is definitive.
async function waitForWorkflowSettled(taskDir: string, sentMessages: unknown[], timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastState = "";
  while (Date.now() < deadline) {
    const { status } = await readStatus(taskDir);
    lastState = status.state;
    if (status.state === "BLOCKED") return status.state;
    if (status.state === "COMPLETED" && sentMessages.length > 0) return status.state;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`timed out waiting for the workflow to settle; last observed state: ${lastState}, sent messages: ${sentMessages.length}`);
}

test("/team-go drives a real Builder/Reviewer cycle through the completion seal and installs an exact commit", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "three-agent-team-go-"));
  const repo = resolve(root, "repo");
  await mkdir(repo, { recursive: true });
  await run(repo, "git", "init", "-q");
  await run(repo, "git", "config", "user.name", "Test");
  await run(repo, "git", "config", "user.email", "test@test");
  await writeFile(resolve(repo, "AGENTS.md"), "# Commands\n\n- Test: `test -f implementation.txt`\n");
  await run(repo, "git", "add", "AGENTS.md");
  await run(repo, "git", "commit", "-qm", "chore: baseline");
  const baseline = await run(repo, "git", "rev-parse", "HEAD");

  const taskDir = resolve(repo, "team/tasks/sample");
  await mkdir(taskDir, { recursive: true });
  await writeFile(resolve(taskDir, "brief.md"), `# Goal Contract: sample

## Goal
Verify the completion seal end to end through the real /team-go path.

## Current behavior
No implementation exists.

## Agreed approach
Create implementation.txt and verify its presence.

## Success tests
### ST-01: implementation exists
- Command: \`test -f implementation.txt\`
- Expected exit code: \`0\`
- Expected evidence: implementation.txt exists
- Writes hardware/system state: \`no\`
- Prerequisites: \`none\`

## Non-goals
No deployment.

## Relevant files
implementation.txt

## Architectural constraints
Fail closed on drift.

## Verification commands
1. \`test -f implementation.txt\`

## Baseline commit
${baseline}

## Execution authority
- Repository edits: allowed
- Non-destructive development commands: allowed
- Routine technical decisions inside this contract: allowed
- Hardware/system writes: prohibited
- Allowed hardware/system operations: none
- Commit on success: true
- Push on success: false
- Deploy on success: false

## Open decisions
NONE

## Execution authorization
PENDING
`);
  await writeFile(resolve(taskDir, "status.yaml"), `task_id: sample
state: DISCUSSING
baseline_commit: ${baseline}
authorization_head: null
contract_digest: null
execution_authorized_at: null
continue_until_complete: true
review_cycle: 0
max_review_cycles: 5
latest_build_report: null
latest_review: null
blocked_reason: null
verified_at: null
completed_at: null
completion_policy:
  commit_on_success: true
  push_on_success: false
  deploy_on_success: false
commit_sha: null
pushed_at: null
deployed_at: null
`);
  await run(repo, "git", "add", "team/tasks/sample");
  await run(repo, "git", "commit", "-qm", "chore: commit contract");

  const fakePiBin = resolve(root, "pi-fake");
  await writeFile(fakePiBin, `#!/bin/sh
case "$*" in
  *builder.md*)
    printf 'implementation\\n' > implementation.txt
    git add -N implementation.txt
    printf '# Build Report: sample\\n\\n## Summary\\nCreated implementation.txt.\\n' > team/tasks/sample/build-report.md
    printf '%s\\n' '{"type":"tool_execution_start","toolName":"write"}'
    printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","provider":"pi-llama","model":"pi/qwen","stopReason":"stop","content":[{"type":"text","text":"Implementation complete."}]}}'
    ;;
  *reviewer.md*)
    printf '%s\\n' '{"type":"tool_execution_start","toolName":"read"}'
    review=$(printf '%s\\n' '# Review: sample' '' '## Findings' 'No issues found. Success tests pass.' '' '## Verdict' 'APPROVED')
    review_json=$(printf '%s' "$review" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
    printf '{"type":"message_end","message":{"role":"assistant","provider":"pi-llama","model":"pi/gemma","stopReason":"stop","content":[{"type":"text","text":%s}]}}\\n' "$review_json"
    ;;
esac
`);
  await chmod(fakePiBin, 0o700);

  const configPath = resolve(root, "config.json");
  await writeFile(configPath, JSON.stringify({
    version: 1,
    providers: {
      "pi-llama": {
        name: "test router", baseUrl: "http://127.0.0.1:46757/v1", api: "openai-completions",
        apiKey: "test-key", authHeader: true,
      },
    },
    roles: {
      architect: { provider: "pi-llama", model: "pi/gemma", name: "Gemma", reasoning: true, input: ["text"], contextWindow: 110000, maxTokens: 32768, thinking: "high" },
      builder: { provider: "pi-llama", model: "pi/qwen", name: "Qwen", reasoning: true, input: ["text"], contextWindow: 120000, maxTokens: 32768, thinking: "high" },
      reviewer: { provider: "pi-llama", model: "pi/gemma", name: "Gemma", reasoning: true, input: ["text"], contextWindow: 110000, maxTokens: 32768, thinking: "high" },
    },
    limits: { builderAttempts: 16, reviewerAttempts: 4, roleTimeoutSeconds: 7200, idleTimeoutSeconds: 300 },
    lifecycle: {
      managedProviders: ["pi-llama"],
      enterTeamCommand: "true",
      leaseTtlSeconds: 300,
      leaseRenewIntervalSeconds: 100,
      restoreStudioAfterRun: false,
    },
  }));

  const previousConfig = process.env.PI_THREE_AGENT_CONFIG;
  const previousPiBin = process.env.PI_THREE_AGENT_PI_BIN;
  process.env.PI_THREE_AGENT_CONFIG = configPath;
  process.env.PI_THREE_AGENT_PI_BIN = fakePiBin;

  const identity = await identifyRepository(repo);
  const authorizationDir = resolve(defaultDurableStateRoot(), "authorizations", identity.repositoryKey);

  try {
    const pi = fakePi();
    await threeAgentTeamExtension(pi as any);
    const ctx = fakeCtx(repo);

    await pi.commands["team-go"].handler("sample", ctx);

    const preAuthorizationNotification = ctx.notifications.find((n) => n.level === "error");
    assert.equal(preAuthorizationNotification, undefined, `unexpected early error: ${JSON.stringify(preAuthorizationNotification)}`);

    const terminal = await waitForWorkflowSettled(taskDir, pi.sentMessages, 60_000);
    assert.equal(terminal, "COMPLETED", `expected COMPLETED, notifications: ${JSON.stringify(ctx.notifications)}`);

    const { status } = await readStatus(taskDir);
    assert.equal(status.state, "COMPLETED");
    assert.ok(status.completionPolicy.commitOnSuccess);

    const head = await run(repo, "git", "rev-parse", "HEAD");
    assert.notEqual(head, baseline, "a completion commit must have been created");
    const subject = await run(repo, "git", "log", "-1", "--format=%s", head);
    assert.match(subject, /^feat: complete sample$/);

    assert.equal(await run(repo, "git", "status", "--porcelain=v2", "--untracked-files=all"), "");
    assert.equal(await readFile(resolve(repo, "implementation.txt"), "utf8"), "implementation\n");
    assert.match(await readFile(resolve(taskDir, "completion-report.md"), "utf8"), /# Completion Report: sample/);
    assert.match(await readFile(resolve(taskDir, "verification.log"), "utf8"), /Verification started/);

    assert.equal(pi.sentMessages.length, 1);

    const completedNotification = ctx.notifications.find((n) => /completed\. Report:/.test(n.message));
    assert.ok(completedNotification, "expected a completion notification");
  } finally {
    if (previousConfig === undefined) delete process.env.PI_THREE_AGENT_CONFIG;
    else process.env.PI_THREE_AGENT_CONFIG = previousConfig;
    if (previousPiBin === undefined) delete process.env.PI_THREE_AGENT_PI_BIN;
    else process.env.PI_THREE_AGENT_PI_BIN = previousPiBin;
    await rm(authorizationDir, { recursive: true, force: true });
  }
});
