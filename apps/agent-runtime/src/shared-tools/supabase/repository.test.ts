import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Recommendation } from "@repo/shared-schemas";

/**
 * Supabase wiring tests.
 *
 * Guarantees:
 *  1. Offline-by-default repository resolution for evals/CI.
 *  2. Correct DB row -> Zod schema mapping.
 *  3. Runtime service reads fail closed without workspace scope.
 *  4. Owner enumeration preserves workspace partitions.
 *  5. Runtime audit writes use the workspace-binding RPC.
 *  6. Only verified published recommendations reach the durable persistence RPC.
 */
const h = vi.hoisted(() => {
  const rpcCalls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const tableData: Record<string, Array<Record<string, unknown>>> = {};
  const state: { rpcError: string | null; persistCountOverride: number | null } = {
    rpcError: null,
    persistCountOverride: null,
  };

  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        range(from: number, to: number) {
          const rows = tableData[table] ?? [];
          const filtered = rows.filter((row) =>
            filters.every(([column, value]) => row[column] === value),
          );
          return Promise.resolve({ data: filtered.slice(from, to + 1), error: null });
        },
      };
      return builder;
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
const WORKSPACE_A = "aaaaaaaa-0000-0000-0000-000000000001";
const WORKSPACE_B = "bbbbbbbb-0000-0000-0000-000000000002";
const OWNER = "11111111-1111-1111-1111-111111111111";
const SERVICE: RlsContext = { kind: "service", actorId: "orchestrator" };
const SCOPED_SERVICE: RlsContext = {
  kind: "service",
  actorId: "orchestrator",
  workspaceId: WORKSPACE_A,
};

const PUBLISHED: Recommendation = {
  id: "rec_run_x_aaaaaaa1-0000-0000-0000-000000000001",
  runId: "run_x",
  accountId: "aaaaaaa1-0000-0000-0000-000000000001",
  ownerId: OWNER,
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

function accountRow(
  id: string,
  workspaceId: string,
  name: string,
): Record<string, unknown> {
  return {
    id,
    workspace_id: workspaceId,
    name,
    domain: "example.com",
    owner_id: OWNER,
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
  };
}

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

describe("Supabase repository mapping + tenant scope + durable writes", () => {
  it("fails closed when a service account read has no workspace scope", async () => {
    const repo = createSupabaseRepository(SERVICE, NOW);
    await expect(repo.listAccountsByOwner(OWNER)).rejects.toThrow(
      "explicit workspace scope",
    );
  });

  it("keeps the same owner in separate deterministic workspace scopes", async () => {
    h.tableData.accounts = [
      accountRow("aaaaaaa1-0000-0000-0000-000000000001", WORKSPACE_A, "A"),
      accountRow("bbbbbbb2-0000-0000-0000-000000000002", WORKSPACE_B, "B"),
    ];

    const repo = createSupabaseRepository(SERVICE, NOW);
    await expect(repo.listOwnerScopes()).resolves.toEqual([
      { workspaceId: WORKSPACE_A, ownerId: OWNER },
      { workspaceId: WORKSPACE_B, ownerId: OWNER },
    ]);
  });

  it("maps only accounts from the service context workspace", async () => {
    h.tableData.accounts = [
      accountRow(
        "aaaaaaa1-0000-0000-0000-000000000001",
        WORKSPACE_A,
        "Helios Manufacturing",
      ),
      accountRow(
        "bbbbbbb2-0000-0000-0000-000000000002",
        WORKSPACE_B,
        "Other Workspace Account",
      ),
    ];

    const repo = createSupabaseRepository(SCOPED_SERVICE, NOW);
    const accounts = await repo.listAccountsByOwner(OWNER);

    expect(accounts).toHaveLength(1);
    const a = accounts[0]!;
    expect(a.id).toBe("aaaaaaa1-0000-0000-0000-000000000001");
    expect(a.ownerId).toBe(OWNER);
    expect(a.lifecycleStage).toBe("open_opportunity");
    expect(a.openPipelineUsd).toBe(180000);
    expect(a.lastContactedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(a.daysSinceLastContact).toBe(24);
  });

  it("writes audit evidence through the workspace-binding RPC", async () => {
    const repo = createSupabaseRepository(SCOPED_SERVICE, NOW);
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
    const repo = createSupabaseRepository(SCOPED_SERVICE, NOW);
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
    const repo = createSupabaseRepository(SCOPED_SERVICE, NOW);
    await repo.persistPublishedRecommendations([PUBLISHED]);

    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0]!.functionName).toBe("persist_published_recommendations");
    expect(h.rpcCalls[0]!.args.p_recommendations).toEqual([PUBLISHED]);
  });

  it("rejects an unpublished recommendation before the DB call", async () => {
    const repo = createSupabaseRepository(SCOPED_SERVICE, NOW);
    await expect(
      repo.persistPublishedRecommendations([{ ...PUBLISHED, published: false }]),
    ).rejects.toThrow("not eligible for published persistence");
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("propagates persistence errors and count mismatches", async () => {
    const repo = createSupabaseRepository(SCOPED_SERVICE, NOW);
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
        workspace_id: WORKSPACE_A,
        name: "Pinecrest Logistics",
        domain: null,
        owner_id: OWNER,
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

    const repo = createSupabaseRepository(SCOPED_SERVICE, NOW);
    const [a] = await repo.listAccountsByOwner(OWNER);
    expect(a!.daysSinceLastContact).toBeUndefined();
    expect(a!.lastContactedAt).toBeUndefined();
    expect(a!.domain).toBeUndefined();
  });

  it("pages through results beyond the 1000-row API cap (no silent truncation)", async () => {
    h.tableData.accounts = Array.from({ length: 1500 }, (_, i) => ({
      id: `acc-${i}`,
      workspace_id: WORKSPACE_A,
      name: `Account ${i}`,
      domain: null,
      owner_id: OWNER,
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

    const repo = createSupabaseRepository(SCOPED_SERVICE, NOW);
    const accounts = await repo.listAccountsByOwner(OWNER);
    expect(accounts).toHaveLength(1500);
    expect(accounts[1499]!.id).toBe("acc-1499");
  });
});
