import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Supabase wiring tests (Sprint 4).
 *
 * Two guarantees:
 *  1. Offline-by-default: without an RLS context (or without Supabase configured)
 *     the runtime resolves the in-memory store, so evals/CI never touch a DB.
 *  2. Correctness of the Supabase repository's row->schema mapping and the
 *     audit_evidence write, exercised against a mocked Supabase client.
 */
const h = vi.hoisted(() => {
  const inserted: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const tableData: Record<string, unknown[]> = {};
  const result = (data: unknown[]) => Promise.resolve({ data, error: null });
  const client = {
    from(table: string) {
      const rows = tableData[table] ?? [];
      return {
        select() {
          return {
            eq: () => result(rows),
            then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
              result(rows).then(onF, onR),
          };
        },
        insert(payload: Record<string, unknown>) {
          inserted.push({ table, payload });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { inserted, tableData, client };
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

beforeEach(() => {
  h.inserted.length = 0;
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

describe("Supabase repository mapping + audit write", () => {
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
    // Derived from last_contacted_at relative to NOW (24 days).
    expect(a.daysSinceLastContact).toBe(24);
  });

  it("writes audit evidence with mapped fields and no synthetic id", async () => {
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

    expect(h.inserted).toHaveLength(1);
    const { table, payload } = h.inserted[0]!;
    expect(table).toBe("audit_evidence");
    expect(payload).toMatchObject({
      run_id: "run_x",
      account_id: "aaaaaaa1-0000-0000-0000-000000000001",
      actor_id: "orchestrator",
      action: "publish_recommendation",
      decision: "allowed",
      evidence: { score: 70, rank: 1 },
      occurred_at: NOW,
    });
    // The DB generates the uuid id; we must not push the runtime's string id.
    expect("id" in payload).toBe(false);
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
});
