import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Recommendation } from "@repo/shared-schemas";

/**
 * Supabase wiring tests.
 *
 * Guarantees:
 *  1. Offline-by-default repository resolution for evals/CI.
 *  2. Correct DB row -> Zod schema mapping.
 *  3. Runtime audit writes use the workspace-binding RPC.
 *  4. Only verified published recommendations reach the durable persistence RPC.
 */
const h = vi.hoisted(() => {
  const rpcCalls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const tableData: Record<string, unknown[]> = {};
  const state: { rpcError: string | null; persistCountOverride: number | null } = {
    rpcError: null,
    persistCountOverride: null,
  };
  const client = {
    from(table: string) {
      const rows = tableData[table] ?? [];
      // Mimic PostgREST range paging: .range(from,to) returns that slice.
      const page = (from: number, to: number) =>
        Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      const ranged = { range: (from: number, to: number) => page(from, to) };
      return {
        select() {
          return {
            eq: () => ranged,
            range: (from: number, to: number) => page(from, to),
          };
        },
      };
    },
    rpc(functionName: string, args: Record<string, unknown>) {
      rpcCalls.push({ functionName, args });
      if (state.rpcError) {
        return Promise.resolve({ data: null, error: { message: state.rpcError } });
      }
      if (functionName === "persist_published_recommendations") {
        const payload = args.p_recommendations;
        const count = Array.isArray(payload) ? payload.length : 0;
        return Promise.resolve({
          data: state.persistCountOverride ?? count,
          error: null,
        });
      }
      return Promise.resolve({
        data: "99999999-9999-9999-9999-999999999999",
        error: null,
      });
    },
  };
  return { rpcCalls, tableData, state, client };
});

vi.mock("@repo/supabase-client", () => ({
  createServerSupabaseClient: () => h.client,
  createServiceRoleClient: () => h.client,
}));

import { createSupabaseRepository } from "./repository";
import { isSupabaseConfigured, type RlsContext } from "./rls-context";
import { resolveRepository, inMemoryRepository } from "../runtime-repository";

const NOW = "2026-06-25T00:00:00Z";
const SERVICE: RlsContext = { kind: "service", actorId: "orchestrator" };

const PUBLISHED: Recommendation = {
  id: "rec_run_x_aaaaaaa1-0000-0000-0000-000000000001",
  runId: "run_x",
  accountId: "aaaaaaa1-0000-0000-0000-000000000001",
  ownerId: "11111111-1111-1111-1111-111111111111",
  score: 70,
  rank: 1,
  confidence: 0.9,
  reasonCodes: ["strategic_tier_account"],
  reasonNarrative: "Priority #1 based on verified account evidence.",
  sourceSignals: [
    {
      kind: "account",
      refId: "aaaaaaa1-0000-0000-0000-000000000001",
      description: "Strategic account tier is authoritative.",
      verified: true,
    },
  ],
  nextBestAction: {
    type: "no_action_hold",
    customerFacing: false,
    crmWriteBack: false,
    objective: "Hold until the next verified signal.",
  },
  verification: {
    status: "passed",
    schemaValid: true,
    guardrailsPassed: true,
    sourceSignalsVerified: true,
    permissionGranted: true,
    failedGates: [],
    checkedAt: NOW,
  },
  approvalStatus: "not_required",
  published: true,
  createdAt: NOW,
};

beforeEach(() => {
  h.rpcCalls.length = 0;
  h.state.rpcError = null;
  h.state.persistCountOverride = null;
  for (const k of Object.keys(h.tableData)) delete h.tableData[k];
});

describe("offline-by-default repository resolution", () => {
  it("falls back to the in-memory store without an RLS context", () => {
    expect(resolveRepository()).toBe(inMemoryRepository);
  });

  it("stays in-memory even with a context when Supabase is unconfigured", () => {
    expect(isSupabaseConfigured()).toBe(false);
    expect(resolveRepository(SERVICE, NOW)).toBe(inMemoryRepository);
  });
});

describe("Supabase repository mapping + durable writes", () => {
  it("maps a DB account row into the Zod Account schema", async () => {
    h.tableData.accounts = [
      {
        id: "aaaaaaa1-0000-0000-0000-000000000001",
        name: "Helios Manufacturing",
        domain: "helios-mfg.com",
        owner_id: "11111111-1111-1111-1111-111111111111",
        tier: "strategic",
        lifecycle_stage: "open_opportunity",
        industry: "Industrial",
        employee_count: 4200,
        annual_revenue_usd: 820000000,
        open_pipeline_usd: 180000,
        last_contacted_at: "2026-06-01T00:00:00+00:00",
        health_score: 62,
        intent_signals: ["pricing_page_visit"],
        data_quality_flags: [],
        created_at: "2025-01-10T00:00:00+00:00",
        updated_at: "2026-06-01T00:00:00+00:00",
      },
    ];

    const repo = createSupabaseRepository(SERVICE, NOW);
    const accounts = await repo.listAccountsByOwner(
      "11111111-1111-1111-1111-111111111111",
    );

    expect(accounts).toHaveLength(1);
    const a = accounts[0]!;
    expect(a.id).toBe("aaaaaaa1-0000-0000-0000-000000000001");
    expect(a.ownerId).toBe("11111111-1111-1111-1111-111111111111");
    expect(a.lifecycleStage).toBe("open_opportunity");
    expect(a.openPipelineUsd).toBe(180000);
    expect(a.lastContactedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(a.daysSinceLastContact).toBe(24);
  });

  it("writes audit evidence through the workspace-binding RPC", async () => {
    const repo = createSupabaseRepository(SERVICE, NOW);
    await repo.appendAudit({
      id: "audit_1_publish_recommendation",
      runId: "run_x",
      accountId: "aaaaaaa1-0000-0000-0000-000000000001",
      actorId: "orchestrator",
      action: "publish_recommendation",
      decision: "allowed",
      reason: "Passed all gates.",
      evidence: { score: 70, rank: 1 },
      occurredAt: NOW,
    });

    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0]).toEqual({
      functionName: "append_runtime_audit_evidence",
      args: {
        p_entry: {
          runId: "run_x",
          accountId: "aaaaaaa1-0000-0000-0000-000000000001",
          actorId: "orchestrator",
          action: "publish_recommendation",
          decision: "allowed",
          reason: "Passed all gates.",
          evidence: { score: 70, rank: 1 },
          occurredAt: NOW,
        },
      },
    });
    expect("id" in (h.rpcCalls[0]!.args.p_entry as Record<string, unknown>)).toBe(false);
  });

  it("fails closed when durable audit has no account workspace binding", async () => {
    const repo = createSupabaseRepository(SERVICE, NOW);
    await expect(
      repo.appendAudit({
        id: "audit_missing_account",
        actorId: "orchestrator",
        action: "test",
        decision: "allowed",
        reason: "Test.",
        evidence: {},
        occurredAt: NOW,
      }),
    ).rejects.toThrow("requires accountId");
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("persists only schema-valid verified published recommendations", async () => {
    const repo = createSupabaseRepository(SERVICE, NOW);
    await repo.persistPublishedRecommendations([PUBLISHED]);

    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0]!.functionName).toBe("persist_published_recommendations");
    expect(h.rpcCalls[0]!.args.p_recommendations).toEqual([PUBLISHED]);
  });

  it("rejects an unpublished recommendation before the DB call", async () => {
    const repo = createSupabaseRepository(SERVICE, NOW);
    await expect(
      repo.persistPublishedRecommendations([{ ...PUBLISHED, published: false }]),
    ).rejects.toThrow("not eligible for published persistence");
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("propagates persistence errors and count mismatches", async () => {
    const repo = createSupabaseRepository(SERVICE, NOW);
    h.state.rpcError = "tenant mismatch";
    await expect(repo.persistPublishedRecommendations([PUBLISHED])).rejects.toThrow(
      "tenant mismatch",
    );

    h.state.rpcError = null;
    h.state.persistCountOverride = 0;
    await expect(repo.persistPublishedRecommendations([PUBLISHED])).rejects.toThrow(
      "count mismatch",
    );
  });

  it("derives no staleness when last_contacted_at is null", async () => {
    h.tableData.accounts = [
      {
        id: "bbbbbbb2-0000-0000-0000-000000000002",
        name: "Pinecrest Logistics",
        domain: null,
        owner_id: "11111111-1111-1111-1111-111111111111",
        tier: "smb",
        lifecycle_stage: "prospect",
        industry: null,
        employee_count: null,
        annual_revenue_usd: null,
        open_pipeline_usd: 0,
        last_contacted_at: null,
        health_score: null,
        intent_signals: [],
        data_quality_flags: ["missing_primary_contact"],
        created_at: "2026-03-15T00:00:00+00:00",
        updated_at: "2026-05-15T00:00:00+00:00",
      },
    ];

    const repo = createSupabaseRepository(SERVICE, NOW);
    const [a] = await repo.listAccountsByOwner(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(a!.daysSinceLastContact).toBeUndefined();
    expect(a!.lastContactedAt).toBeUndefined();
    expect(a!.domain).toBeUndefined();
  });

  it("pages through results beyond the 1000-row API cap (no silent truncation)", async () => {
    const owner = "11111111-1111-1111-1111-111111111111";
    h.tableData.accounts = Array.from({ length: 1500 }, (_, i) => ({
      id: `acc-${i}`,
      name: `Account ${i}`,
      domain: null,
      owner_id: owner,
      tier: "smb",
      lifecycle_stage: "prospect",
      industry: null,
      employee_count: null,
      annual_revenue_usd: null,
      open_pipeline_usd: 0,
      last_contacted_at: null,
      health_score: null,
      intent_signals: [],
      data_quality_flags: [],
      created_at: "2026-01-01T00:00:00+00:00",
      updated_at: "2026-01-01T00:00:00+00:00",
    }));

    const repo = createSupabaseRepository(SERVICE, NOW);
    const accounts = await repo.listAccountsByOwner(owner);
    expect(accounts).toHaveLength(1500);
    expect(accounts[1499]!.id).toBe("acc-1499");
  });
});
