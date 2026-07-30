/**
 * Registered /team-import handler tests.
 *
 * Exercises the production command handler through a fake Pi adapter.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import {
  createTestFixture,
  makeValidTask,
  writeManifest,
  commitManifest,
} from "./test/plan-import-fixture.ts";
import threeAgentTeamExtension from "./index.ts";

// Minimal fake ExtensionAPI
function fakePi(): any {
  const commands: Record<string, { description: string; handler: Function }> = {};
  const notifications: Array<{ message: string; level: string }> = [];
  const eventHandlers: Record<string, Function[]> = {};

  return {
    commands,
    notifications,
    registerCommand(name: string, opts: { description: string; handler: Function; getArgumentCompletions?: Function }) {
      commands[name] = { description: opts.description, handler: opts.handler };
    },
    on(event: string, handler: Function) {
      if (!eventHandlers[event]) eventHandlers[event] = [];
      eventHandlers[event].push(handler);
    },
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
    setUi(_opts: any) {},
    clearUi() {},
  };
}

function fakeCtx(cwd: string, stateRoot?: string): any {
  const ctx: any = {
    cwd,
    stateRoot,
    ui: {
      notify(message: string, level: string) {
        ctx._notifications = ctx._notifications || [];
        ctx._notifications.push({ message, level });
      },
    },
    abort() { throw new Error("aborted"); },
    _notifications: [] as Array<{ message: string; level: string }>,
  };
  return ctx;
}

test("preview team/plan.yaml returns manifest digest and tasks", async () => {
  const fixture = await createTestFixture();
  const task = makeValidTask("2026-01-01-handler-test");
  const content = writeManifest(fixture, [task]);
  await commitManifest(fixture, content);

  const pi = fakePi();
  await threeAgentTeamExtension(pi);

  const handler = pi.commands["team-import"];
  assert.ok(handler, "team-import command registered");
  assert.equal(handler.description, "Import tasks from a strict YAML plan manifest (preview or approve)");

  // Preview
  const ctx = fakeCtx(fixture.repo, fixture.stateRoot);
  await handler.handler("team/plan.yaml", ctx);
  assert.ok(ctx._notifications.length >= 1);
  const previewMsg = ctx._notifications[0].message;
  assert.ok(previewMsg.includes("Manifest Preview"), `Expected preview, got: ${previewMsg}`);
  assert.ok(previewMsg.includes("sha256:"), "Should include manifest digest");
  assert.ok(previewMsg.includes("--approve sha256:"), "Should include approval command");
  assert.equal(ctx._notifications[0].level, "info");
});

test("preview rejects invalid manifest path", async () => {
  const fixture = await createTestFixture();
  const task = makeValidTask("2026-01-01-handler-test");
  const content = writeManifest(fixture, [task]);
  await commitManifest(fixture, content);

  const pi = fakePi();
  await threeAgentTeamExtension(pi);
  const handler = pi.commands["team-import"];

  const ctx = fakeCtx(fixture.repo, fixture.stateRoot);
  await handler.handler("wrong/path.yaml", ctx);
  assert.ok(ctx._notifications[0].message.includes("exactly 'team/plan.yaml'"));
  assert.equal(ctx._notifications[0].level, "error");
});

test("preview rejects empty args", async () => {
  const pi = fakePi();
  await threeAgentTeamExtension(pi);
  const handler = pi.commands["team-import"];

  const ctx = fakeCtx("/tmp/test");
  await handler.handler("", ctx);
  assert.ok(ctx._notifications[0].message.includes("Usage"));
  assert.equal(ctx._notifications[0].level, "error");
});

test("preview rejects malformed --approve digest", async () => {
  const fixture = await createTestFixture();
  const task = makeValidTask("2026-01-01-handler-test");
  const content = writeManifest(fixture, [task]);
  await commitManifest(fixture, content);

  const pi = fakePi();
  await threeAgentTeamExtension(pi);
  const handler = pi.commands["team-import"];

  const ctx = fakeCtx(fixture.repo, fixture.stateRoot);
  // Strict parser: approval requires exactly 5 tokens
  await handler.handler("team/plan.yaml --approve INVALID", ctx);
  assert.ok(ctx._notifications[0].message.includes("Expected") || ctx._notifications[0].message.includes("5 tokens"),
    `Expected token count error, got: ${ctx._notifications[0].message}`);
  assert.equal(ctx._notifications[0].level, "error");
});

test("preview rejects --approve without --head", async () => {
  const fixture = await createTestFixture();
  const task = makeValidTask("2026-01-01-handler-test");
  const content = writeManifest(fixture, [task]);
  await commitManifest(fixture, content);

  const pi = fakePi();
  await threeAgentTeamExtension(pi);
  const handler = pi.commands["team-import"];

  const ctx = fakeCtx(fixture.repo, fixture.stateRoot);
  const digest = "a".repeat(64);
  // Strict parser: approval requires exactly 5 tokens, 3 tokens is invalid
  await handler.handler(`team/plan.yaml --approve sha256:${digest}`, ctx);
  assert.ok(ctx._notifications[0].message.includes("Expected") || ctx._notifications[0].message.includes("5 tokens"),
    `Expected token count error, got: ${ctx._notifications[0].message}`);
  assert.equal(ctx._notifications[0].level, "error");
});

test("preview rejects --head without --approve", async () => {
  const fixture = await createTestFixture();
  const task = makeValidTask("2026-01-01-handler-test");
  const content = writeManifest(fixture, [task]);
  await commitManifest(fixture, content);

  const pi = fakePi();
  await threeAgentTeamExtension(pi);
  const handler = pi.commands["team-import"];

  const ctx = fakeCtx(fixture.repo, fixture.stateRoot);
  // Strict parser: 3 tokens is neither preview (1) nor approval (5)
  await handler.handler("team/plan.yaml --head aaaaaaaaabbbbbbbbbbccccccccccdddddddddd", ctx);
  assert.ok(ctx._notifications[0].message.includes("Expected") || ctx._notifications[0].message.includes("5 tokens"),
    `Expected token count error, got: ${ctx._notifications[0].message}`);
  assert.equal(ctx._notifications[0].level, "error");
});

test("preview rejects duplicate flags", async () => {
  const fixture = await createTestFixture();
  const task = makeValidTask("2026-01-01-handler-test");
  const content = writeManifest(fixture, [task]);
  await commitManifest(fixture, content);

  const pi = fakePi();
  await threeAgentTeamExtension(pi);
  const handler = pi.commands["team-import"];

  const ctx = fakeCtx(fixture.repo, fixture.stateRoot);
  const digest = "a".repeat(64);
  await handler.handler(`team/plan.yaml --approve sha256:${digest} --approve sha256:${digest}`, ctx);
  // Should reject — strict parser only accepts 1 or 5 tokens
  assert.equal(ctx._notifications[0].level, "error");
});

test("preview rejects reordered flags", async () => {
  const fixture = await createTestFixture();
  const task = makeValidTask("2026-01-01-handler-test");
  const content = writeManifest(fixture, [task]);
  await commitManifest(fixture, content);

  const pi = fakePi();
  await threeAgentTeamExtension(pi);
  const handler = pi.commands["team-import"];

  const ctx = fakeCtx(fixture.repo, fixture.stateRoot);
  const digest = "a".repeat(64);
  const head = "b".repeat(40);
  await handler.handler(`team/plan.yaml --head ${head} --approve sha256:${digest}`, ctx);
  // --head before --approve should be rejected (strict order)
  assert.equal(ctx._notifications[0].level, "error");
});

test("preview rejects missing manifest file", async () => {
  const fixture = await createTestFixture();

  const pi = fakePi();
  await threeAgentTeamExtension(pi);
  const handler = pi.commands["team-import"];

  const ctx = fakeCtx(fixture.repo, fixture.stateRoot);
  await handler.handler("team/plan.yaml", ctx);
  assert.ok(ctx._notifications[0].message.includes("not found"));
  assert.equal(ctx._notifications[0].level, "error");
});

test("approval with valid args completes import", async () => {
  const fixture = await createTestFixture();
  const task = makeValidTask("2026-01-01-approval-test");
  const content = writeManifest(fixture, [task]);
  const digest = await commitManifest(fixture, content);
  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();

  const pi = fakePi();
  await threeAgentTeamExtension(pi);
  const handler = pi.commands["team-import"];

  const ctx = fakeCtx(fixture.repo, fixture.stateRoot);
  await handler.handler(`team/plan.yaml --approve sha256:${digest} --head ${initialHead}`, ctx);

  const msgs = ctx._notifications.map((n: any) => n.message).join("\n");
  assert.ok(msgs.includes("Import Complete") || msgs.includes("Already Completed"),
    `Expected Import Complete, got: ${msgs}`);
  assert.ok(msgs.includes("Journal ID:"), "Should include journal ID");
  assert.ok(msgs.includes("Import Commit:"), "Should include commit SHA");
  assert.ok(msgs.includes(task.id), "Should include task ID");
});

test("completed import replay returns Already Completed", async () => {
  const fixture = await createTestFixture();
  const task = makeValidTask("2026-01-01-replay-test");
  const content = writeManifest(fixture, [task]);
  const digest = await commitManifest(fixture, content);
  const initialHead = execSync("git rev-parse HEAD", { cwd: fixture.repo, encoding: "utf8" }).trim();

  const pi = fakePi();
  await threeAgentTeamExtension(pi);
  const handler = pi.commands["team-import"];

  // First approval
  const ctx1 = fakeCtx(fixture.repo, fixture.stateRoot);
  await handler.handler(`team/plan.yaml --approve sha256:${digest} --head ${initialHead}`, ctx1);

  // Second approval (replay)
  const ctx2 = fakeCtx(fixture.repo, fixture.stateRoot);
  await handler.handler(`team/plan.yaml --approve sha256:${digest} --head ${initialHead}`, ctx2);

  const msg2 = ctx2._notifications[0].message;
  assert.ok(msg2.includes("Already Completed"),
    `Replay should say Already Completed, got: ${msg2}`);
});
