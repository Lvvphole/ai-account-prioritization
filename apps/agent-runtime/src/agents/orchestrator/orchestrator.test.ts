import { describe, it, expect, beforeEach } from "vitest";
import { runDailyPrioritizationForOwner } from "./orchestrator.agent";
import { resetStore } from "../../shared-tools/database/client";
import { __setEnvForTesting } from "../../config/env";

const NOW = "2026-06-25T07:00:00Z";

describe("orchestrator daily prioritization", () => {
  beforeEach(() => {
    resetStore();
    __setEnvForTesting({ REQUIRE_HUMAN_APPROVAL: true });
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
