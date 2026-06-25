import { describe, it, expect, beforeEach } from "vitest";
import {
  runDailyPrioritizationForOwner,
  resetStore,
  getEnv,
} from "agent-runtime";
import fixture from "./fixtures/daily-prioritization.fixture.json";

/**
 * Deterministic end-to-end eval of the daily prioritization run.
 *
 * Runs the real orchestrator over the seeded CRM data and compares against a
 * golden fixture. This is the Sprint 3 / Epic 7 deterministic gate and proves
 * the runtime is reproducible (Strategic Programming: verify).
 */
describe("daily-prioritization (deterministic, golden)", () => {
  beforeEach(() => {
    resetStore();
  });

  it("env parses with safety defaults (human approval required)", () => {
    expect(getEnv().REQUIRE_HUMAN_APPROVAL).toBe(true);
  });

  it("matches the golden published order and scores", async () => {
    const run = await runDailyPrioritizationForOwner(fixture.ownerId, {
      now: fixture.now,
      autoApprove: fixture.autoApprove,
    });

    expect(run.totalAccountsConsidered).toBe(fixture.expected.totalAccountsConsidered);
    expect(run.blockedCount).toBe(fixture.expected.blockedCount);
    expect(run.recommendations.map((r) => r.accountId)).toEqual(
      fixture.expected.publishedOrder,
    );

    for (const rec of run.recommendations) {
      const expectedScore = (fixture.expected.scores as Record<string, number>)[
        rec.accountId
      ];
      expect(rec.score).toBe(expectedScore);
    }
  });

  it("is idempotent across runs (same input -> same output)", async () => {
    const r1 = await runDailyPrioritizationForOwner(fixture.ownerId, {
      now: fixture.now,
      autoApprove: fixture.autoApprove,
    });
    resetStore();
    const r2 = await runDailyPrioritizationForOwner(fixture.ownerId, {
      now: fixture.now,
      autoApprove: fixture.autoApprove,
    });
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
  });

  it("every published recommendation passed verification and carries evidence", async () => {
    const run = await runDailyPrioritizationForOwner(fixture.ownerId, {
      now: fixture.now,
      autoApprove: fixture.autoApprove,
    });
    for (const rec of run.recommendations) {
      expect(rec.published).toBe(true);
      expect(rec.verification.status).toBe("passed");
      expect(rec.sourceSignals.length).toBeGreaterThan(0);
      expect(rec.sourceSignals.every((s) => s.verified)).toBe(true);
      expect(rec.reasonCodes.length).toBeGreaterThan(0);
    }
  });
});
