import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTasks, validateTasks, type Task } from "../tasks.ts";

const good = `
- id: t01-scaffold
  goal: Create the project skeleton.
  depends_on: []
  files: [package.json, src/index.ts]
  success_tests:
    - npm test
    - npx tsc --noEmit
- id: t02-feature
  goal: Add the feature.
  depends_on: [t01-scaffold]
  success_tests:
    - node --test
`;

function errorsFor(yaml: string): string[] {
  const parsed = parseTasks(yaml);
  return parsed.errors.length ? parsed.errors : validateTasks(parsed.tasks);
}

describe("parseTasks", () => {
  it("parses a valid plan", () => {
    const { tasks, errors } = parseTasks(good);
    assert.deepEqual(errors, []);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[1].dependsOn[0], "t01-scaffold");
    assert.deepEqual(tasks[0].files, ["package.json", "src/index.ts"]);
    assert.deepEqual(tasks[1].files, []);
  });

  it("reports malformed YAML", () => {
    assert.match(errorsFor("- id: [unterminated")[0], /YAML/);
  });

  it("requires a top-level list", () => {
    assert.match(errorsFor("id: x")[0], /list of tasks/);
    assert.match(errorsFor("[]")[0], /at least one task/);
  });

  it("reports missing and mistyped fields per task", () => {
    const errors = errorsFor("- id: a\n  success_tests: npm test\n");
    assert.ok(errors.some((e) => /a: goal/.test(e)));
    assert.ok(errors.some((e) => /a: success_tests must be a list/.test(e)));
  });

  it("rejects unknown keys so typos are not silently ignored", () => {
    const errors = errorsFor("- id: a\n  goal: g\n  success_test: [npm test]\n  success_tests: [npm test]\n");
    assert.ok(errors.some((e) => /unknown key "success_test"/.test(e)));
  });
});

describe("validateTasks", () => {
  const tasks = (): Task[] => parseTasks(good).tasks;

  it("accepts a valid plan", () => {
    assert.deepEqual(validateTasks(tasks()), []);
  });

  it("rejects invalid and duplicate ids", () => {
    assert.ok(errorsFor("- id: Bad Id\n  goal: g\n  success_tests: [npm test]\n").some((e) => /invalid id/.test(e)));
    const dup = "- id: a\n  goal: g\n  success_tests: [npm test]\n- id: a\n  goal: g\n  success_tests: [npm test]\n";
    assert.ok(errorsFor(dup).some((e) => /duplicate id "a"/.test(e)));
  });

  it("rejects unknown, self and forward dependencies", () => {
    const unknown = "- id: a\n  goal: g\n  depends_on: [zzz]\n  success_tests: [npm test]\n";
    assert.ok(errorsFor(unknown).some((e) => /unknown dependency "zzz"/.test(e)));
    const self = "- id: a\n  goal: g\n  depends_on: [a]\n  success_tests: [npm test]\n";
    assert.ok(errorsFor(self).some((e) => /depends on itself/.test(e)));
    const forward = "- id: a\n  goal: g\n  depends_on: [b]\n  success_tests: [npm test]\n- id: b\n  goal: g\n  success_tests: [npm test]\n";
    assert.ok(errorsFor(forward).some((e) => /listed after/.test(e)));
  });

  it("rejects empty success tests", () => {
    assert.ok(errorsFor("- id: a\n  goal: g\n  success_tests: []\n").some((e) => /at least one/.test(e)));
  });

  it("rejects placeholder commands", () => {
    for (const command of ["TODO", "npm run <script>", "REPLACE_ME", "tbd"]) {
      const errors = errorsFor(`- id: a\n  goal: g\n  success_tests: ["${command}"]\n`);
      assert.ok(errors.some((e) => /placeholder/.test(e)), command);
    }
  });

  it("rejects prose masquerading as a command", () => {
    const errors = errorsFor("- id: a\n  goal: g\n  success_tests: [verify the button works]\n");
    assert.ok(errors.some((e) => /prose/.test(e)));
  });

  it("rejects commands with broken quoting or only env assignments", () => {
    assert.ok(errorsFor(`- id: a\n  goal: g\n  success_tests: ["echo 'oops"]\n`).some((e) => /quoting/.test(e)));
    assert.ok(errorsFor("- id: a\n  goal: g\n  success_tests: [FOO=bar]\n").some((e) => /only environment/.test(e)));
  });

  it("accepts env prefixes, pipes, paths and quoted arguments", () => {
    const ok = `- id: a\n  goal: g\n  success_tests:\n    - CI=1 npm test\n    - ./scripts/check.sh --strict\n    - "grep -q 'hello world' out.txt"\n    - test -f dist/index.js && node dist/index.js\n`;
    assert.deepEqual(errorsFor(ok), []);
  });

  it("rejects duplicate commands within a task", () => {
    const errors = errorsFor("- id: a\n  goal: g\n  success_tests: [npm test, npm test]\n");
    assert.ok(errors.some((e) => /duplicate command/.test(e)));
  });

  it("rejects absolute or escaping file paths", () => {
    assert.ok(errorsFor("- id: a\n  goal: g\n  files: [/etc/passwd]\n  success_tests: [npm test]\n").some((e) => /relative path/.test(e)));
    assert.ok(errorsFor("- id: a\n  goal: g\n  files: [../x]\n  success_tests: [npm test]\n").some((e) => /relative path/.test(e)));
  });
});
