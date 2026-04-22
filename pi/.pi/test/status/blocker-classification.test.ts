const nodeTestModulePath = "node:test";
const { describe, it } = await import(nodeTestModulePath);

const blockerClassificationModulePath = "../../agent/extensions/task-forge/src/status/blocker-classification.ts";
const { classifyStatusBlockedTask, parseDependencyBlockedReason } = await import(blockerClassificationModulePath);

export {};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

describe("status blocker classification", () => {
  it("classifies blocked-task inputs into explicit categories", () => {
    const humanIntervention = classifyStatusBlockedTask({
      taskId: "TF-01",
      pendingHumanInterventionTaskId: "TF-01",
      blocker: {
        category: "validation_contract",
        reason: "Acceptance command is prose, not executable",
      },
    });

    const directBlocker = classifyStatusBlockedTask({
      taskId: "TF-02",
      blocker: {
        category: "runtime",
        reason: "Test runner crashed with segfault",
      },
    });

    const dependencyBlocked = classifyStatusBlockedTask({
      taskId: "TF-03",
      blocker: {
        category: "dependency",
        reason: "Blocked by failed dependency: TF-02",
      },
    });

    const unknown = classifyStatusBlockedTask({
      taskId: "TF-04",
      blocker: {
        category: "unknown",
        reason: "",
      },
    });

    assert(humanIntervention === "human_intervention", "expected pending human intervention to classify as human_intervention");
    assert(directBlocker === "direct_blocker", "expected runtime blocker to classify as direct_blocker");
    assert(dependencyBlocked === "dependency_blocked", "expected dependency category to classify as dependency_blocked");
    assert(unknown === "unknown", "expected missing/malformed reason to remain unknown");
  });

  it("parses dependency-reason variants and extracts upstream task ids", () => {
    const canonical = parseDependencyBlockedReason("Blocked by failed dependency: TF-05");
    const lowercase = parseDependencyBlockedReason("blocked by failed dependency: tf-06");
    const plural = parseDependencyBlockedReason("Blocked by failed dependencies: TF-07, TF-08");
    const noColon = parseDependencyBlockedReason("Dependency failed TF-09");

    assert(canonical.isDependencyBlocked, "expected canonical dependency phrase to match");
    assert(canonical.upstreamTaskIds.join(",") === "TF-05", "expected canonical parser to extract TF-05");

    assert(lowercase.isDependencyBlocked, "expected case-insensitive dependency phrase to match");
    assert(lowercase.upstreamTaskIds.join(",") === "TF-06", "expected upstream task id extraction to normalize case");

    assert(plural.isDependencyBlocked, "expected plural dependency phrase to match");
    assert(plural.upstreamTaskIds.join(",") === "TF-07,TF-08", "expected parser to extract multiple upstream task ids");

    assert(noColon.isDependencyBlocked, "expected colon-free dependency wording variant to match");
    assert(noColon.upstreamTaskIds.join(",") === "TF-09", "expected parser to extract task ids from colon-free variant");

    const mixedCaseDuplicates = parseDependencyBlockedReason("Blocked by failed dependencies: tf-10, TF-10");
    assert(mixedCaseDuplicates.upstreamTaskIds.join(",") === "TF-10", "expected case-insensitive dedupe for upstream task ids");
  });

  it("does not downgrade direct blockers to dependency-blocked when reason text overlaps", () => {
    const classified = classifyStatusBlockedTask({
      taskId: "TF-09",
      blocker: {
        category: "plan_contract",
        reason: "Blocked by failed dependency: TF-99 but this task has direct contract mismatch and must be replanned",
      },
    });

    assert(classified === "direct_blocker", "expected explicit direct blocker category to outrank dependency reason heuristics");
  });

  it("returns non-dependency classification when dependency phrase is malformed", () => {
    const parsed = parseDependencyBlockedReason("Blocked due upstream issue");

    assert(!parsed.isDependencyBlocked, "expected malformed reason not to be treated as dependency-blocked");
    assert(parsed.upstreamTaskIds.length === 0, "expected no upstream task ids for malformed reason");
  });
});
