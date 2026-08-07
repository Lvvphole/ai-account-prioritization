import { describe, it, expect, beforeEach } from "vitest";
import {
  buildPrioritizationRunId,
  runDailyPrioritizationForOwner,
} from "./orchestrator.agent";
import { resetStore } from "../../shared-tools/database/client";
import { __setEnvForTesting } from "../../config/env";

const NOW = "2026-06-25T07:00:00Z";
const WORKSPACE_A = "aaaaaaaa-0000-0000-0000-000000000001";
const WORKSPACE_B = "bbbbbbbb-0000-0000-0000-000000000002";

describe("orchestrator daily prioritization", () => {
  beforeEach(() => {
    resetStore();
    __setEnvForTesting({ REQUIRE_HUMAN_APPROVAL: true });
  });

  it("includes workspace scope in the deterministic run identity", () => {
    const ownerId = "rep_alex";
    const runA = buildPrioritizationRunId(ownerId, NOW, {
      kind: "service",
      actorId: "daily_scheduler",
      workspaceId: WORKSPACE_A,
    });
    const runB = buildPrioritizationRunId(ownerId, NOW, {
      kind: "service",
      actorId: "daily_scheduler",
      workspaceId: WORKSPACE_B,
    });

    expect(runA).toBe(`run_${WORKSPACE_A}_${ownerId}_${NOW}`);
    expect(runB).toBe(`run_${WORKSPACE_B}_${ownerId}_${NOW}`);
    expect(runA).not.toBe(runB);
    expect(buildPrioritizationRunId(ownerId, NOW)).toBe(`run_${ownerId}_${NOW}`);
  });

  it("produces a deterministic, ranked run", async () => {
    const r1 = await runDailyPrioritizationForOwner("rep_alex", { now: NOW, autoApprove: true });
    resetStore();
    const r2 = await runDailyPrioritizationForOwner("rep_alex", { now: NOW, autoApprove: true });

    const ids1 = r1.recommendations.map((r) => `${r.rank}:${r.accountId}:${r.score}`);
    const ids2 = r2.recommendations.map((r) => `${r.rank}:${r.accountId}:${r.score}`);
    expect(ids1).toEqual(ids2);
  });

  it("ranks are contiguous and ordered by score descending", async () => {
    const run = await runDailyPrioritizationForOwner("rep_alex", { now: NOW, autoApprove: true });
    const ranks = run.recommendations.map((r) => r.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (let i = 1; i < run.recommendations.length; i++) {
      expect(run.recommendations[i - 1]!.score).toBeGreaterThanOrEqual(
        run.recommendations[i]!.score,
      );
    }
  });

  it("blocks customer-facing actions when approval is withheld (fail-closed)", async () => {
    const run = await runDailyPrioritizationForOwner("rep_alex", { now: NOW, autoApprove: false });
    // With approvals withheld, customer-facing/CRM-writeback recs must be blocked.
    expect(run.blockedCount).toBeGreaterThan(0);
    for (const rec of run.recommendations) {
      expect(rec.published).toBe(true);
      expect(rec.verification.status).toBe("passed");
    }
  });

  it("every published recommendation carries the required fields", async () => {
    const run = await runDailyPrioritizationForOwner("rep_alex", { now: NOW, autoApprove: true });
    for (const rec of run.recommendations) {
      expect(rec.score).toBeGreaterThanOrEqual(0);
      expect(rec.confidence).toBeGreaterThanOrEqual(0);
      expect(rec.reasonCodes.length).toBeGreaterThan(0);
      expect(rec.sourceSignals.length).toBeGreaterThan(0);
      expect(rec.sourceSignals.every((s) => s.verified)).toBe(true);
      expect(rec.nextBestAction.objective.length).toBeGreaterThan(0);
    }
  });
});
