/**
 * Canonical Goal Contract rendering.
 *
 * This module generates brief.md and status.yaml from a TaskSpec.
 * All rendering uses a single template to ensure consistency.
 */

import { createHash } from "node:crypto";
import type { TaskSpec, SuccessTest } from "./plan-manifest.ts";

export interface RenderedContract {
  brief: string;
  status: string;
  briefDigest: string;
  statusDigest: string;
}

/**
 * Render a complete Goal Contract (brief.md + status.yaml) from a TaskSpec.
 */
export function renderContract(task: TaskSpec, baselineCommit: string): RenderedContract {
  const brief = renderBrief(task, baselineCommit);
  const status = renderStatus(task, baselineCommit);

  const briefDigest = createHash("sha256").update(brief).digest("hex");
  const statusDigest = createHash("sha256").update(status).digest("hex");

  return {
    brief,
    status,
    briefDigest,
    statusDigest,
  };
}

function renderBrief(task: TaskSpec, baselineCommit: string): string {
  const successTests = task.successTests.map(renderSuccessTest).join("\n\n");
  const verificationCommands = task.successTests.map(t => `\`${t.command}\``).join("\n");

  return `# Goal Contract: ${task.id}

## Goal
${task.goal}

## Current behavior
${task.currentBehavior}

## Agreed approach
${task.agreedApproach}

## Success tests

${successTests}

## Non-goals
${task.nonGoals.map(g => `- ${g}`).join("\n")}

## Relevant files
${task.relevantFiles.map(f => `- ${f}`).join("\n")}

## Architectural constraints
${task.architecturalConstraints.map(c => `- ${c}`).join("\n")}

## Verification commands
${verificationCommands}

## Baseline commit
${baselineCommit}

## Execution authority
- Repository edits: ${task.executionAuthority.repositoryEdits ? "allowed" : "prohibited"}
- Non-destructive development commands: ${task.executionAuthority.nonDestructiveDevelopmentCommands ? "allowed" : "prohibited"}
- Routine technical decisions inside this contract: ${task.executionAuthority.routineTechnicalDecisions ? "allowed" : "prohibited"}
- Hardware/system writes: ${task.executionAuthority.hardwareSystemWrites ? "allowed" : "prohibited"}
- Allowed hardware/system operations: ${task.executionAuthority.allowedHardwareSystemOperations.length > 0 ? task.executionAuthority.allowedHardwareSystemOperations.join(", ") : "none"}
- Commit on success: ${task.completionPolicy.commitOnSuccess ? "true" : "false"}
- Push on success: ${task.completionPolicy.pushOnSuccess ? "true" : "false"}
- Deploy on success: ${task.completionPolicy.deployOnSuccess ? "true" : "false"}

## Open decisions
NONE

## Execution authorization
PENDING
`;
}

function renderSuccessTest(test: SuccessTest): string {
  const prerequisites = test.prerequisites.length > 0
    ? test.prerequisites.join(", ")
    : "none";

  return `### ${test.id}: ${test.title}
- Command: \`${test.command}\`
- Expected exit code: \`${test.expectedExitCode}\`
- Expected evidence: ${test.expectedEvidence}
- Writes hardware/system state: \`${test.writesHardwareOrSystemState ? "yes" : "no"}\`
- Prerequisites: \`${prerequisites}\``;
}

function renderStatus(task: TaskSpec, baselineCommit: string): string {
  return `task_id: ${task.id}
state: DISCUSSING
review_cycle: 0
builder_attempts: 0
reviewer_attempts: 0
latest_build_report: "null"
latest_review: "null"
baseline_commit: ${baselineCommit}
authorization_head: "null"
contract_digest: "null"
execution_authorized_at: "null"
blocked_reason: "null"
verified_at: "null"
commit_sha: "null"
max_review_cycles: 3
completion_policy:
  commit_on_success: ${task.completionPolicy.commitOnSuccess}
  push_on_success: ${task.completionPolicy.pushOnSuccess}
  deploy_on_success: ${task.completionPolicy.deployOnSuccess}
`;
}

/**
 * Build the authorized brief by replacing the PENDING marker with the authorization timestamp.
 */
export function buildAuthorizedBrief(brief: string, approvedAt: string): string {
  const marker = "## Execution authorization\nPENDING";
  const replacement = `## Execution authorization\nAUTHORIZED at ${approvedAt} by owner command \`/team-enqueue\``;

  const authorizedBrief = brief.replace(marker, replacement);

  // Verify exactly one replacement occurred
  const pendingCount = (brief.match(/## Execution authorization\nPENDING/g) || []).length;
  if (pendingCount !== 1) {
    throw new Error(`Expected exactly 1 PENDING marker, found ${pendingCount}`);
  }

  return authorizedBrief;
}

/**
 * Build the enrollment snapshot with computed digests.
 */
export function buildEnrollmentSnapshot(
  brief: string,
  authorizedBrief: string,
  approvedAt: string,
) {
  const approvedBriefDigest = createHash("sha256").update(brief).digest("hex");
  const contractDigest = createHash("sha256").update(authorizedBrief).digest("hex");

  return {
    approvedBriefDigest,
    contractDigest,
    approvedAt,
  };
}
