import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const workspaceA = "aaaaaaaa-0000-0000-0000-000000000001";
  const workspaceB = "bbbbbbbb-0000-0000-0000-000000000002";
  const ownerId = "11111111-1111-1111-1111-111111111111";
  const persistA = vi.fn();
  const persistB = vi.fn();
  const discoveryRepo = {
    listOwnerScopes: vi.fn(async () => [
      { workspaceId: workspaceA, ownerId },
      { workspaceId: workspaceB, ownerId },
    ]),
  };
  const repoA = { persistPublishedRecommendations: persistA };
  const repoB = { persistPublishedRecommendations: persistB };
  const resolveRepository = vi.fn((ctx?: { workspaceId?: string }) => {
    if (ctx?.workspaceId === workspaceA) return repoA;
    if (ctx?.workspaceId === workspaceB) return repoB;
    return discoveryRepo;
  });
  const runDailyPrioritizationForOwner = vi.fn(
    async (requestedOwner: string, opts: { now?: string; rlsContext?: { workspaceId?: string } }) => ({
      runId: `run_${requestedOwner}_${opts.rlsContext?.workspaceId ?? "offline"}`,
      ownerId: requestedOwner,
      generatedAt: opts.now ?? "2026-08-07T10:00:00.000Z",
      recommendations: [],
      totalAccountsConsidered: 0,
      blockedCount: 0,
    }),
  );
  return {
    workspaceA,
    workspaceB,
    ownerId,
    persistA,
    persistB,
    discoveryRepo,
    repoA,
    repoB,
    resolveRepository,
    runDailyPrioritizationForOwner,
  };
});

vi.mock("../config/env", () => ({
  getEnv: () => ({ NODE_ENV: "test" }),
}));

vi.mock("../shared-tools/runtime-repository", () => ({
  resolveRepository: h.resolveRepository,
}));

vi.mock("../shared-tools/supabase/rls-context", () => ({
  isSupabaseConfigured: () => true,
}));

vi.mock("../agents/orchestrator/orchestrator.agent", () => ({
  runDailyPrioritizationForOwner: h.runDailyPrioritizationForOwner,
}));

import { runDailyPrioritizationForAllOwners } from "./daily-prioritization.schedule";

const NOW = "2026-08-07T10:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("daily prioritization workspace partition", () => {
  it("runs the same owner separately in each workspace and persists both runs", async () => {
    const runs = await runDailyPrioritizationForAllOwners({
      now: NOW,
      rlsContext: { kind: "service", actorId: "daily_scheduler" },
    });

    expect(h.discoveryRepo.listOwnerScopes).toHaveBeenCalledTimes(1);
    expect(h.runDailyPrioritizationForOwner).toHaveBeenCalledTimes(2);
    expect(h.runDailyPrioritizationForOwner).toHaveBeenNthCalledWith(
      1,
      h.ownerId,
      expect.objectContaining({
        now: NOW,
        rlsContext: {
          kind: "service",
          actorId: "daily_scheduler",
          workspaceId: h.workspaceA,
        },
      }),
    );
    expect(h.runDailyPrioritizationForOwner).toHaveBeenNthCalledWith(
      2,
      h.ownerId,
      expect.objectContaining({
        now: NOW,
        rlsContext: {
          kind: "service",
          actorId: "daily_scheduler",
          workspaceId: h.workspaceB,
        },
      }),
    );

    expect(h.persistA).toHaveBeenCalledTimes(1);
    expect(h.persistB).toHaveBeenCalledTimes(1);
    expect(runs).toHaveLength(2);
  });
});
