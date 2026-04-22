import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyPlanningResumability } from "./planning-recovery.ts";
import type { V2StorageLayout } from "./storage.ts";
import type { RunSnapshot } from "./types.ts";

async function createLayoutFixture(): Promise<V2StorageLayout> {
  const baseDir = await mkdtemp(join(tmpdir(), "planning-recovery-"));
  return {
    baseDir,
    eventsFile: join(baseDir, "events.jsonl"),
    snapshotFile: join(baseDir, "state.json"),
  };
}

async function writeArtifact(layout: V2StorageLayout, file: string, content: string) {
  await writeFile(join(layout.baseDir, file), content, "utf-8");
}

function snapshotFixture(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    schemaVersion: 4,
    orchestrationId: "orch-1",
    status: "planning",
    currentPhase: 0,
    phaseLabel: "Scope Classification",
    orchestrationMode: "standard",
    requirementsFile: "01-requirements.md",
    planFile: "02-plan.md",
    tasksFile: "03-tasks.json",
    testSpecFile: "03-test-spec.json",
    resolvedModels: {},
    cost: {},
    tasks: [],
    taskState: {},
    blockers: [],
    supervisors: {},
    timestamps: {
      started: "2026-04-19T00:00:00.000Z",
      lastUpdated: "2026-04-19T00:00:00.000Z",
    },
    ...overrides,
  };
}

async function completePhase0(layout: V2StorageLayout, mode: "micro" | "standard" | "complex" = "standard") {
  await writeArtifact(layout, "00-routing.json", JSON.stringify({ orchestrationMode: mode }, null, 2));
}

async function completePhase1(layout: V2StorageLayout) {
  await writeArtifact(layout, "01-requirements.md", "# Requirements\n\nNon-empty.");
}

async function completePhase2(layout: V2StorageLayout) {
  await writeArtifact(layout, "02-plan.md", "# Plan\n\nArchitecture decisions.");
  await writeArtifact(layout, "03-tasks.json", JSON.stringify({ tasks: [] }, null, 2));
}

async function completePhase3(layout: V2StorageLayout) {
  await writeArtifact(layout, "03-test-spec.json", JSON.stringify({ testSpecs: [] }, null, 2));
}

describe("classifyPlanningResumability", () => {
  describe("phase 0", () => {
    it("returns restart_required when routing artifact is missing", async () => {
      const layout = await createLayoutFixture();
      const snapshot = snapshotFixture({ currentPhase: 0, orchestrationMode: "standard" });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });

    it("returns restart_required when routing JSON is corrupt", async () => {
      const layout = await createLayoutFixture();
      await writeArtifact(layout, "00-routing.json", "{not-json");
      const snapshot = snapshotFixture({ currentPhase: 0, orchestrationMode: "standard" });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });

    it("returns resumable when orchestration mode is present and routing artifact is valid", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      const snapshot = snapshotFixture({ currentPhase: 0, orchestrationMode: "standard" });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });
  });

  describe("phase 1", () => {
    it("returns restart_required when requirements markdown is missing", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      const snapshot = snapshotFixture({ currentPhase: 1 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });

    it("returns restart_required when requirements markdown is empty", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await writeArtifact(layout, "01-requirements.md", " \n\t ");
      const snapshot = snapshotFixture({ currentPhase: 1 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });

    it("returns resumable when requirements markdown is non-empty", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      const snapshot = snapshotFixture({ currentPhase: 1 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });

    it("returns restart_required when phase 0 prerequisite is missing", async () => {
      const layout = await createLayoutFixture();
      await completePhase1(layout);
      const snapshot = snapshotFixture({ currentPhase: 1 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });
  });

  describe("phase 2", () => {
    it("returns resumable when both plan and tasks are missing (phase can be rerun)", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      const snapshot = snapshotFixture({ currentPhase: 2 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });

    it("returns resumable when only plan exists", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await writeArtifact(layout, "02-plan.md", "# Plan\n\nOnly plan exists");
      const snapshot = snapshotFixture({ currentPhase: 2 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });

    it("returns resumable when only tasks exists and is valid JSON", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await writeArtifact(layout, "03-tasks.json", JSON.stringify({ tasks: [] }));
      const snapshot = snapshotFixture({ currentPhase: 2 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });

    it("returns resumable when both plan and tasks are valid", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await completePhase2(layout);
      const snapshot = snapshotFixture({ currentPhase: 2 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });

    it("returns restart_required when tasks JSON is corrupt", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await writeArtifact(layout, "02-plan.md", "# Plan\n\nValid plan");
      await writeArtifact(layout, "03-tasks.json", "{bad-json");
      const snapshot = snapshotFixture({ currentPhase: 2 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });

    it("returns restart_required when tasks JSON is empty", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await writeArtifact(layout, "02-plan.md", "# Plan\n\nValid plan");
      await writeArtifact(layout, "03-tasks.json", "  ");
      const snapshot = snapshotFixture({ currentPhase: 2 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });

    it("returns resumable when plan markdown is empty (phase rerunnable)", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await writeArtifact(layout, "02-plan.md", "\n\t ");
      const snapshot = snapshotFixture({ currentPhase: 2 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });

    it("returns restart_required when prerequisites are missing", async () => {
      const layout = await createLayoutFixture();
      const snapshot = snapshotFixture({ currentPhase: 2 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });
  });

  describe("phase 3", () => {
    it("returns resumable when test spec is missing", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await completePhase2(layout);
      const snapshot = snapshotFixture({ currentPhase: 3 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });

    it("returns resumable when test spec is valid JSON", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await completePhase2(layout);
      await completePhase3(layout);
      const snapshot = snapshotFixture({ currentPhase: 3 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });

    it("returns resumable when test spec is empty", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await completePhase2(layout);
      await writeArtifact(layout, "03-test-spec.json", "\n ");
      const snapshot = snapshotFixture({ currentPhase: 3 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });

    it("returns restart_required when test spec JSON is corrupt", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await completePhase2(layout);
      await writeArtifact(layout, "03-test-spec.json", "{bad-json");
      const snapshot = snapshotFixture({ currentPhase: 3 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });

    it("returns restart_required when phase 2 prerequisite is missing", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      const snapshot = snapshotFixture({ currentPhase: 3 });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });
  });

  describe("phase 4", () => {
    it("returns resumable in standard mode when all prerequisites are complete", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await completePhase2(layout);
      await completePhase3(layout);
      const snapshot = snapshotFixture({ currentPhase: 4, orchestrationMode: "standard" });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });

    it("returns restart_required in standard mode when test spec is missing", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await completePhase2(layout);
      const snapshot = snapshotFixture({ currentPhase: 4, orchestrationMode: "standard" });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });

    it("returns resumable in micro mode when routing and plan/tasks exist", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout, "micro");
      await completePhase2(layout);
      const snapshot = snapshotFixture({
        currentPhase: 4,
        orchestrationMode: "micro",
        requirementsFile: undefined,
        testSpecFile: undefined,
      });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });
  });

  describe("micro mode phase skipping", () => {
    it("phase 1 is resumable without requirements when routing exists", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout, "micro");
      const snapshot = snapshotFixture({
        currentPhase: 1,
        orchestrationMode: "micro",
        requirementsFile: undefined,
        testSpecFile: undefined,
      });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });

    it("phase 1 in micro mode is restart_required when routing is missing", async () => {
      const layout = await createLayoutFixture();
      const snapshot = snapshotFixture({
        currentPhase: 1,
        orchestrationMode: "micro",
        requirementsFile: undefined,
        testSpecFile: undefined,
      });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });

    it("phase 3 in micro mode is resumable with completed phase 2 artifacts", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout, "micro");
      await completePhase2(layout);
      const snapshot = snapshotFixture({
        currentPhase: 3,
        orchestrationMode: "micro",
        requirementsFile: undefined,
        testSpecFile: undefined,
      });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });

    it("phase 3 in micro mode remains resumable when phase 2 artifacts are missing", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout, "micro");
      const snapshot = snapshotFixture({
        currentPhase: 3,
        orchestrationMode: "micro",
        requirementsFile: undefined,
        testSpecFile: undefined,
      });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "resumable");
    });
  });

  describe("artifact file existence checks", () => {
    it("uses snapshot paths (missing custom requirements path is restart_required)", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await writeArtifact(layout, "01-requirements.md", "# Existing default file");
      const snapshot = snapshotFixture({
        currentPhase: 1,
        requirementsFile: "custom-requirements.md",
      });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });

    it("uses snapshot JSON path for validation (corrupt custom path is restart_required)", async () => {
      const layout = await createLayoutFixture();
      await completePhase0(layout);
      await completePhase1(layout);
      await writeArtifact(layout, "02-plan.md", "# Plan\n\nValid");
      await writeArtifact(layout, "03-tasks.json", JSON.stringify({ tasks: [] }));
      await writeArtifact(layout, "custom-tasks.json", "{bad-json");
      const snapshot = snapshotFixture({
        currentPhase: 2,
        tasksFile: "custom-tasks.json",
      });

      const result = await classifyPlanningResumability(snapshot, layout);
      assert.equal(result, "restart_required");
    });
  });
});
