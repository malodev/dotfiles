import type { ForgeTask, TaskValidationContract, TestSpecEntry } from "./types.ts";
import { assertValidValidationContract, looksLikeValidationCommand, materializeLegacyValidationFields } from "./validation.ts";

export interface BlockerResolutionPatch {
  validation?: TaskValidationContract;
  [key: string]: unknown;
}

const TASK_CONTRACT_PATCH_ALLOWLIST = new Set(["validation"]);

function extractStructuredPatch(resolution: string): BlockerResolutionPatch | null {
  for (const match of resolution.matchAll(/```json\s*([\s\S]*?)```/gi)) {
    const payload = match[1]?.trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as BlockerResolutionPatch;
      }
    } catch {
      // ignore malformed JSON snippets and continue heuristics
    }
  }
  return null;
}

export function assertAllowlistedTaskContractPatch(patch: BlockerResolutionPatch): asserts patch is BlockerResolutionPatch & { validation: TaskValidationContract } {
  const keys = Object.keys(patch).filter((key) => patch[key] !== undefined);
  if (keys.length === 0) {
    throw new Error("Invalid task-contract patch: at least one mutable field is required");
  }

  const rejectedFields = keys.filter((key) => !TASK_CONTRACT_PATCH_ALLOWLIST.has(key));
  if (rejectedFields.length > 0) {
    throw new Error(`Invalid task-contract patch: rejected fields outside allowlist: ${rejectedFields.join(", ")}`);
  }

  if (!patch.validation) {
    throw new Error("Invalid task-contract patch: validation field is required");
  }

  patch.validation = assertValidValidationContract(patch.validation);
}

function extractCommandCandidates(resolution: string) {
  const candidates = new Set<string>();

  for (const match of resolution.matchAll(/`([^`]+)`/g)) {
    candidates.add(match[1].trim());
  }

  for (const line of resolution.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^(npm|pnpm|yarn|bun|node|npx|pytest|vitest|jest|go|cargo|make|just|bash|sh)\b/i.test(trimmed) && looksLikeValidationCommand(trimmed)) {
      candidates.add(trimmed);
    }
    const colon = trimmed.indexOf(":");
    if (colon >= 0) {
      const afterColon = trimmed.slice(colon + 1).trim();
      if (/^(npm|pnpm|yarn|bun|node|npx|pytest|vitest|jest|go|cargo|make|just|bash|sh)\b/i.test(afterColon) && looksLikeValidationCommand(afterColon)) {
        candidates.add(afterColon);
      }
    }
  }

  return [...candidates].filter(Boolean);
}

function inferManualValidationNotes(resolution: string): string | undefined {
  const normalized = resolution.trim();
  if (!normalized) return undefined;

  if (/manual validation|manual-review|manual review|no executable acceptance command|required manual|reviewer should inspect|validate by checking/i.test(normalized)) {
    return normalized;
  }

  return undefined;
}

export function deriveBlockerResolutionPatch(resolution: string): BlockerResolutionPatch | null {
  const structuredPatch = extractStructuredPatch(resolution);
  if (structuredPatch) {
    return structuredPatch;
  }

  const command = extractCommandCandidates(resolution)[0];
  if (command) {
    return {
      validation: {
        mode: "command",
        command,
      },
    };
  }

  const notes = inferManualValidationNotes(resolution);
  if (notes) {
    return {
      validation: {
        mode: "manual",
        notes,
      },
    };
  }

  return null;
}

export function applyTestSpecResolutionPatch<TSpec extends Pick<TestSpecEntry, "taskId" | "validation" | "acceptance_signal" | "coverage_threshold">>(
  taskId: string,
  testSpecs: TSpec[] | undefined,
  patch: BlockerResolutionPatch,
) {
  assertAllowlistedTaskContractPatch(patch);

  const legacy = materializeLegacyValidationFields(patch.validation);
  return (testSpecs ?? []).map((spec) => {
    if (spec.taskId !== taskId) return spec;
    return {
      ...spec,
      validation: patch.validation!,
      acceptance_signal: legacy.acceptanceSignal,
      coverage_threshold: legacy.coverageThreshold,
    };
  });
}

export function applyBlockerResolutionPatch<TTask extends Pick<ForgeTask, "validation" | "acceptanceSignal" | "testCommand" | "coverageThreshold">, TSpec extends Pick<TestSpecEntry, "taskId" | "validation" | "acceptance_signal" | "coverage_threshold">>(
  taskId: string,
  task: TTask,
  testSpecs: TSpec[] | undefined,
  patch: BlockerResolutionPatch,
) {
  assertAllowlistedTaskContractPatch(patch);

  const legacy = materializeLegacyValidationFields(patch.validation);
  task.validation = patch.validation;
  task.acceptanceSignal = legacy.acceptanceSignal;
  task.testCommand = legacy.testCommand;
  task.coverageThreshold = legacy.coverageThreshold;

  const nextSpecs = applyTestSpecResolutionPatch(taskId, testSpecs, patch);

  return {
    task,
    testSpecs: nextSpecs,
  };
}
