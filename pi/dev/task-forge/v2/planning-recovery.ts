import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { V2StorageLayout } from "./storage.ts";
import type { RunPhase, RunSnapshot } from "./types.ts";

export type PlanningResumability = "resumable" | "restart_required";

const ROUTING_FILE = "00-routing.json";

function artifactPath(layout: V2StorageLayout, file: string) {
  return isAbsolute(file) ? file : resolve(layout.baseDir, file);
}

async function readArtifact(layout: V2StorageLayout, file: string): Promise<string | null> {
  try {
    return await readFile(artifactPath(layout, file), "utf-8");
  } catch {
    return null;
  }
}

async function hasValidJsonArtifact(layout: V2StorageLayout, file: string | undefined): Promise<boolean> {
  if (!file) return false;
  const raw = await readArtifact(layout, file);
  if (raw == null || raw.trim().length === 0) return false;

  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

async function hasValidMarkdownArtifact(layout: V2StorageLayout, file: string | undefined): Promise<boolean> {
  if (!file) return false;
  const raw = await readArtifact(layout, file);
  return raw != null && raw.trim().length > 0;
}

async function hasCompletedPhase0(snapshot: RunSnapshot, layout: V2StorageLayout): Promise<boolean> {
  if (!snapshot.orchestrationMode) return false;
  return await hasValidJsonArtifact(layout, ROUTING_FILE);
}

async function hasCompletedPhase1(snapshot: RunSnapshot, layout: V2StorageLayout): Promise<boolean> {
  if (snapshot.orchestrationMode === "micro") return true;
  return await hasValidMarkdownArtifact(layout, snapshot.requirementsFile);
}

async function classifyPhase2State(snapshot: RunSnapshot, layout: V2StorageLayout): Promise<PlanningResumability | "phase_complete"> {
  const planRaw = snapshot.planFile ? await readArtifact(layout, snapshot.planFile) : null;
  const tasksRaw = snapshot.tasksFile ? await readArtifact(layout, snapshot.tasksFile) : null;

  const hasPlan = planRaw != null;
  const hasTasks = tasksRaw != null;

  if (!hasPlan && !hasTasks) {
    return "resumable";
  }

  const planValid = planRaw != null && planRaw.trim().length > 0;
  const tasksValid = snapshot.tasksFile != null && tasksRaw != null && tasksRaw.trim().length > 0 && await hasValidJsonArtifact(layout, snapshot.tasksFile);

  if (hasPlan && !planValid) return "resumable";
  if (hasTasks && !tasksValid) return "restart_required";
  if (!hasPlan || !hasTasks) return "resumable";
  return "phase_complete";
}

async function hasCompletedPhase2(snapshot: RunSnapshot, layout: V2StorageLayout): Promise<boolean> {
  return (await classifyPhase2State(snapshot, layout)) === "phase_complete";
}

async function classifyPhase3State(snapshot: RunSnapshot, layout: V2StorageLayout): Promise<PlanningResumability | "phase_complete"> {
  if (snapshot.orchestrationMode === "micro") {
    return "phase_complete";
  }

  const raw = snapshot.testSpecFile ? await readArtifact(layout, snapshot.testSpecFile) : null;
  if (raw == null) return "resumable";
  if (raw.trim().length === 0) return "resumable";
  return await hasValidJsonArtifact(layout, snapshot.testSpecFile) ? "phase_complete" : "restart_required";
}

async function hasCompletedPrerequisites(snapshot: RunSnapshot, layout: V2StorageLayout, phase: RunPhase): Promise<boolean> {
  if (phase >= 1 && !(await hasCompletedPhase0(snapshot, layout))) return false;
  if (phase >= 2 && !(await hasCompletedPhase1(snapshot, layout))) return false;
  if (phase >= 3 && !(await hasCompletedPhase2(snapshot, layout))) return false;
  if (phase >= 4 && snapshot.orchestrationMode !== "micro" && (await classifyPhase3State(snapshot, layout)) !== "phase_complete") return false;
  return true;
}

export async function classifyPlanningResumability(
  snapshot: RunSnapshot,
  layout: V2StorageLayout,
): Promise<PlanningResumability> {
  switch (snapshot.currentPhase) {
    case 0:
      return await hasCompletedPhase0(snapshot, layout) ? "resumable" : "restart_required";
    case 1:
      if (!(await hasCompletedPrerequisites(snapshot, layout, 1))) return "restart_required";
      if (snapshot.orchestrationMode === "micro") return "resumable";
      return await hasCompletedPhase1(snapshot, layout) ? "resumable" : "restart_required";
    case 2:
      if (!(await hasCompletedPrerequisites(snapshot, layout, 2))) return "restart_required";
      return (await classifyPhase2State(snapshot, layout)) === "restart_required" ? "restart_required" : "resumable";
    case 3:
      if (snapshot.orchestrationMode === "micro") return await hasCompletedPrerequisites(snapshot, layout, 2)
        ? "resumable"
        : "restart_required";
      if (!(await hasCompletedPrerequisites(snapshot, layout, 3))) return "restart_required";
      return (await classifyPhase3State(snapshot, layout)) === "restart_required" ? "restart_required" : "resumable";
    case 4:
      return await hasCompletedPrerequisites(snapshot, layout, 4) ? "resumable" : "restart_required";
    default:
      return "resumable";
  }
}

export interface ResumablePlanningResult {
  kind: "resumable";
  phase: RunPhase;
  nextAction: "continuePlanning";
}

export interface RestartRequiredPlanningResult {
  kind: "restart_required";
  reason: string;
}

export type InterruptedPlanningResult = ResumablePlanningResult | RestartRequiredPlanningResult;

/**
 * Detects if planning was interrupted and classifies whether it can be resumed
 * or requires a full restart.
 *
 * @param snapshot - The current run snapshot
 * @param layout - The V2 storage layout for checking artifacts
 * @returns null if no interruption detected, otherwise a result object describing
 *          the interruption and whether it's resumable or restart-required
 */
export async function describeInterruptedPlanning(
  snapshot: RunSnapshot,
  layout: V2StorageLayout,
): Promise<InterruptedPlanningResult | null> {
  // Check if planning is interrupted via the explicit flag
  const hasInterruptedFlag = snapshot.planningRuntime?.interrupted === true;

  // Legacy case: planning status with phase < 5 but no planningRuntime
  const isLegacyInterrupted =
    snapshot.status === "planning" &&
    snapshot.currentPhase < 5 &&
    !snapshot.planningRuntime;

  // Not interrupted if neither condition is met
  if (!hasInterruptedFlag && !isLegacyInterrupted) {
    return null;
  }

  // Use classifyPlanningResumability to determine resumability
  const resumability = await classifyPlanningResumability(snapshot, layout);

  if (resumability === "resumable") {
    return {
      kind: "resumable",
      phase: snapshot.currentPhase,
      nextAction: "continuePlanning",
    };
  }

  // Build reason based on phase and legacy status
  let reason: string;
  if (isLegacyInterrupted) {
    reason = `Legacy planning snapshot detected at phase ${snapshot.currentPhase} without planning runtime metadata; cannot safely resume`;
  } else {
    reason = `Planning interrupted at phase ${snapshot.currentPhase}; required artifacts are missing or corrupt`;
  }

  return {
    kind: "restart_required",
    reason,
  };
}

/**
 * Determines which phase to resume planning from based on artifact existence.
 *
 * Logic:
 * - If 01-requirements.md missing -> phase 1
 * - Else if 02-plan.md or 03-tasks.json missing -> phase 2
 * - Else if 03-test-spec.json missing -> phase 3
 * - Else -> phase 4
 *
 * For micro mode: skips phases 1 and 3, so:
 * - Check routing file exists (phase 0), if not -> null (restart required)
 * - If plan/tasks missing -> phase 2
 * - Else -> phase 4
 *
 * @param snapshot - The current run snapshot
 * @param layout - The V2 storage layout for checking artifacts
 * @returns The phase to resume from (1-4), or null if restart is required
 */
export async function determineResumptionPhase(
  snapshot: RunSnapshot,
  layout: V2StorageLayout,
): Promise<RunPhase | null> {
  // Phase 0 must be complete for any resumption - routing file must exist
  if (!(await hasCompletedPhase0(snapshot, layout))) {
    return null;
  }

  // Micro mode: skip phases 1 and 3
  if (snapshot.orchestrationMode === "micro") {
    // Check if phase 2 artifacts exist
    const phase2State = await classifyPhase2State(snapshot, layout);
    if (phase2State !== "phase_complete") {
      // If phase 2 is not complete, resume from phase 2
      // If phase 2 artifacts are corrupt, restart required
      if (phase2State === "restart_required") {
        return null;
      }
      return 2;
    }
    // Phase 2 complete, go to phase 4 (skip phase 3)
    return 4;
  }

  // Standard/Complex mode: check all phases

  // Phase 1: Check requirements file
  if (!(await hasCompletedPhase1(snapshot, layout))) {
    return 1;
  }

  // Phase 2: Check plan and tasks files
  const phase2State = await classifyPhase2State(snapshot, layout);
  if (phase2State !== "phase_complete") {
    // If phase 2 artifacts are corrupt, restart required
    if (phase2State === "restart_required") {
      return null;
    }
    return 2;
  }

  // Phase 3: Check test spec file
  const phase3State = await classifyPhase3State(snapshot, layout);
  if (phase3State !== "phase_complete") {
    // If phase 3 artifacts are corrupt, restart required
    if (phase3State === "restart_required") {
      return null;
    }
    return 3;
  }

  // All phases complete, resume from phase 4 (approval gate)
  return 4;
}
