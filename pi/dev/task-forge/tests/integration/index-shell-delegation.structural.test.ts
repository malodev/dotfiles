import { describe, it } from "node:test";
import * as assert from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const INDEX_PATH = resolve(process.cwd(), "index.ts");

describe("index.ts structural delegation", () => {
  let source: string;

  it("can read index.ts source", async () => {
    source = await readFile(INDEX_PATH, "utf-8");
    assert.ok(source.length > 0, "index.ts should be readable");
  });

  it("imports V2 command services", () => {
    assert.ok(
      source.includes('from "./src/commands/status"') || source.includes("from './src/commands/status'"),
      "index.ts should import status command service"
    );
    assert.ok(
      source.includes('from "./src/commands/execute"') || source.includes("from './src/commands/execute'"),
      "index.ts should import execute command service"
    );
    assert.ok(
      source.includes('from "./src/commands/resume"') || source.includes("from './src/commands/resume'"),
      "index.ts should import resume command service"
    );
    assert.ok(
      source.includes('from "./src/commands/blocker"') || source.includes("from './src/commands/blocker'"),
      "index.ts should import blocker command service"
    );
  });

  it("does not contain inline canExecute logic", () => {
    // After refactoring, transition logic should live in v2/transition-policy.ts only
    const handlerBody = extractHandlerBody(source, "execute");
    assert.ok(
      !handlerBody.includes("canExecute") || handlerBody.includes("src/commands/execute"),
      "index.ts execute handler should not inline canExecute logic"
    );
  });

  it("does not contain inline canResume logic", () => {
    const handlerBody = extractHandlerBody(source, "resume");
    assert.ok(
      !handlerBody.includes("canResume") || handlerBody.includes("src/commands/resume"),
      "index.ts resume handler should not inline canResume logic"
    );
  });

  it("appends events using V2 storage", () => {
    assert.ok(
      source.includes("appendV2Event") || source.includes("appendEvent"),
      "index.ts should use V2 event append"
    );
  });

  it("derives snapshot using V2 storage", () => {
    assert.ok(
      source.includes("deriveV2Snapshot") || source.includes("deriveSnapshot"),
      "index.ts should use V2 snapshot derivation"
    );
  });
});

function extractHandlerBody(source: string, command: string): string {
  // Naive extraction for structural checks only
  const marker = `if (!sub || sub === "${command}")`;
  const idx = source.indexOf(marker);
  if (idx === -1) return "";
  const nextIdx = source.indexOf("if (!sub || sub ===", idx + marker.length);
  return nextIdx === -1 ? source.slice(idx) : source.slice(idx, nextIdx);
}
