import assert from "node:assert/strict";
import test from "node:test";
import { parseAmendmentManifest } from "./amendment-manifest.ts";

const VALID = `version: 1
amendment_id: fix-success-test-commands
subject: "fix: correct success-test commands for queued tasks"
tasks:
  - 2026-08-02-first-task
edits:
  - path: team/tasks/2026-08-02-first-task/brief.md
    old_text: "- Command: \`pytset -q\`"
    new_text: "- Command: \`pytest -q\`"
`;

test("parses a valid amendment manifest", () => {
  const manifest = parseAmendmentManifest(VALID);
  assert.equal(manifest.amendmentId, "fix-success-test-commands");
  assert.equal(manifest.subject, "fix: correct success-test commands for queued tasks");
  assert.deepEqual(manifest.taskIds, ["2026-08-02-first-task"]);
  assert.equal(manifest.edits.length, 1);
  assert.equal(manifest.edits[0].path, "team/tasks/2026-08-02-first-task/brief.md");
  assert.equal(manifest.edits[0].oldText, "- Command: `pytset -q`");
  assert.equal(manifest.edits[0].newText, "- Command: `pytest -q`");
});

test("rejects YAML anchors and aliases", () => {
  assert.throws(() => parseAmendmentManifest(VALID.replace("tasks:", "anchor: &a x\ntasks:")), /anchors are not allowed/);
});

test("rejects a wrong or missing version", () => {
  assert.throws(() => parseAmendmentManifest(VALID.replace("version: 1", "version: 2")), /'version' must be 1/);
  assert.throws(() => parseAmendmentManifest(VALID.replace("version: 1\n", "")), /'version' must be 1/);
});

test("rejects unknown fields at the top level and inside an edit", () => {
  assert.throws(() => parseAmendmentManifest(`${VALID}extra: nope\n`), /Unknown field in 'amendment manifest': 'extra'/);
  assert.throws(
    () => parseAmendmentManifest(VALID.replace("    new_text:", "    surprise: 1\n    new_text:")),
    /Unknown field in 'edits\[0\]': 'surprise'/,
  );
});

test("rejects an invalid amendment_id or a multi-line subject", () => {
  assert.throws(() => parseAmendmentManifest(VALID.replace("fix-success-test-commands", "Fix_Bad_ID")), /'amendment_id' must match/);
  assert.throws(() => parseAmendmentManifest(VALID.replace('subject: "fix: correct success-test commands for queued tasks"', 'subject: "one\\ntwo"')), /'subject' must be a single line/);
});

test("rejects an empty or duplicated task list", () => {
  assert.throws(() => parseAmendmentManifest(VALID.replace("  - 2026-08-02-first-task\n", "")), /'tasks' must be a non-empty list/);
  assert.throws(
    () => parseAmendmentManifest(VALID.replace("  - 2026-08-02-first-task\n", "  - 2026-08-02-first-task\n  - 2026-08-02-first-task\n")),
    /duplicates task/,
  );
});

test("rejects an edit path outside team/tasks, non-canonical, or absolute", () => {
  const withPath = (p: string) => VALID.replace("team/tasks/2026-08-02-first-task/brief.md", p);
  assert.throws(() => parseAmendmentManifest(withPath("README.md")), /must be under team\/tasks\/<task-id>\//);
  assert.throws(() => parseAmendmentManifest(withPath("/etc/passwd")), /must be a relative POSIX path/);
  assert.throws(() => parseAmendmentManifest(withPath("team/tasks/../../escape/brief.md")), /must be canonical/);
});

test("rejects editing a task that is not listed in 'tasks'", () => {
  assert.throws(
    () => parseAmendmentManifest(VALID.replace("team/tasks/2026-08-02-first-task/brief.md", "team/tasks/2026-08-02-other-task/brief.md")),
    /edits task '2026-08-02-other-task', which is not listed in 'tasks'/,
  );
});

test("rejects amending anything but brief.md", () => {
  assert.throws(
    () => parseAmendmentManifest(VALID.replace("/brief.md", "/status.yaml")),
    /may only amend brief\.md/,
  );
});

test("rejects a listed task with no edit to its brief", () => {
  const twoTasks = VALID.replace(
    "  - 2026-08-02-first-task\n",
    "  - 2026-08-02-first-task\n  - 2026-08-02-second-task\n",
  );
  assert.throws(
    () => parseAmendmentManifest(twoTasks),
    /Task '2026-08-02-second-task' is listed in 'tasks' but has no edit to its brief\.md/,
  );
});

test("rejects a no-op edit and duplicate edits to the same text", () => {
  assert.throws(
    () => parseAmendmentManifest(VALID.replace('new_text: "- Command: \`pytest -q\`"', 'new_text: "- Command: \`pytset -q\`"')),
    /identical old_text and new_text/,
  );
  const duplicated = VALID + `  - path: team/tasks/2026-08-02-first-task/brief.md
    old_text: "- Command: \`pytset -q\`"
    new_text: "- Command: \`something-else\`"
`;
  assert.throws(() => parseAmendmentManifest(duplicated), /duplicates an earlier edit/);
});

test("accepts an empty new_text (deleting a line) but not an empty old_text", () => {
  assert.doesNotThrow(() => parseAmendmentManifest(VALID.replace('new_text: "- Command: \`pytest -q\`"', 'new_text: ""')));
  assert.throws(() => parseAmendmentManifest(VALID.replace('old_text: "- Command: \`pytset -q\`"', 'old_text: ""')), /old_text must be a non-empty string/);
});
