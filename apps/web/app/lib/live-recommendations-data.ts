import { RecommendationSchema, type Recommendation } from "@repo/shared-schemas";
import type { Tables } from "@repo/supabase-client";
import {
  assembleLiveDashboardData,
  type LiveDashboardAccountSummary,
  type LiveDashboardData,
  type LiveDashboardDataSource,
  type LiveDashboardWorkspace,
} from "./live-dashboard-data";
import { requireSession } from "./auth";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";

type LiveRecommendationRow = Tables<"recommendations"> & {
  workspace_id: string;
  runtime_recommendation_id: string;
};

type LiveAccountRow = Pick<
  Tables<"accounts">,
  "id" | "name" | "industry" | "tier" | "open_pipeline_usd" | "owner_id" | "updated_at"
> & { workspace_id: string };
type WorkspaceMembershipRow = { workspace_id: string };
type WorkspaceRow = { id: string; name: string };
type QueryError = { message: string };

type LiveQuery<T> = PromiseLike<{
  data: T[] | null;
  error: QueryError | null;
}> & {
  eq(column: string, value: string | boolean): LiveQuery<T>;
  in(column: string, values: string[]): LiveQuery<T>;
  order(column: string, options: { ascending: boolean }): LiveQuery<T>;
  limit(count: number): LiveQuery<T>;
  range(from: number, to: number): LiveQuery<T>;
  maybeSingle(): PromiseLike<{
    data: T | null;
    error: QueryError | null;
  }>;
};

type LiveTableClient = {
  from(table: string): {
    select(columns: string): LiveQuery<unknown>;
  };
};

const PAGE_SIZE = 1000;

function queryTable<T>(client: unknown, table: string, columns = "*"): LiveQuery<T> {
  return (client as LiveTableClient).from(table).select(columns) as unknown as LiveQuery<T>;
}

async function fetchAllRows<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: QueryError | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await page(from, from + PAGE_SIZE - 1);
    if (result.error) {
      throw new Error(`${what}: ${result.error.message}`);
    }
    const rows = result.data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

function toRecommendation(row: LiveRecommendationRow): Recommendation {
  return RecommendationSchema.parse({
    id: row.runtime_recommendation_id,
    runId: row.run_id,
    accountId: row.account_id,
    ownerId: row.owner_id,
    score: row.score,
    rank: row.rank,
    confidence: row.confidence,
    reasonCodes: row.reason_codes,
    reasonNarrative: row.reason_narrative,
    nextBestAction: row.next_best_action,
    sourceSignals: row.source_signals,
    verification: row.verification,
    approvalStatus: row.approval_status,
    published: row.published,
    createdAt: new Date(row.created_at).toISOString(),
  });
}

async function loadLatestPublishedRecommendations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  workspaceId: string,
): Promise<Recommendation[]> {
  const latestResult = await queryTable<LiveRecommendationRow>(supabase, "recommendations")
    .eq("owner_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("published", true)
    .order("created_at", { ascending: false })
    .order("run_id", { ascending: false })
    .order("runtime_recommendation_id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (latestResult.error) {
    throw new Error(`LIVE_RECOMMENDATIONS_LATEST_FAILED: ${latestResult.error.message}`);
  }
  if (!latestResult.data) return [];

  const runId = latestResult.data.run_id;
  const rows = await fetchAllRows<LiveRecommendationRow>(
    "LIVE_RECOMMENDATIONS_RUN_FAILED",
    (from, to) =>
      queryTable<LiveRecommendationRow>(supabase, "recommendations")
        .eq("owner_id", userId)
        .eq("workspace_id", workspaceId)
        .eq("run_id", runId)
        .eq("published", true)
        .order("rank", { ascending: true })
        .order("runtime_recommendation_id", { ascending: true })
        .range(from, to),
  );

  return rows
    .map(toRecommendation)
    .sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function createLiveDashboardDataSource(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): LiveDashboardDataSource {
  return {
    async listAuthorizedWorkspaces(): Promise<LiveDashboardWorkspace[]> {
      const memberships = await fetchAllRows<WorkspaceMembershipRow>(
        "LIVE_DASHBOARD_MEMBERSHIPS_FAILED",
        (from, to) =>
          queryTable<WorkspaceMembershipRow>(
            supabase,
            "workspace_memberships",
            "workspace_id",
          )
            .eq("user_id", userId)
            .order("workspace_id", { ascending: true })
            .range(from, to),
      );
      const authorizedIds = new Set(memberships.map((membership) => membership.workspace_id));
      if (authorizedIds.size === 0) return [];

      const workspaces = await fetchAllRows<WorkspaceRow>(
        "LIVE_DASHBOARD_WORKSPACES_FAILED",
        (from, to) =>
          queryTable<WorkspaceRow>(supabase, "workspaces", "id,name")
            .order("id", { ascending: true })
            .range(from, to),
      );

      return workspaces
        .filter((workspace) => authorizedIds.has(workspace.id))
        .map((workspace) => ({ id: workspace.id, name: workspace.name }));
    },

    async loadRecommendations(workspaceId) {
      return loadLatestPublishedRecommendations(supabase, userId, workspaceId);
    },

    async loadAccounts(workspaceId, accountIds): Promise<LiveDashboardAccountSummary[]> {
      if (accountIds.length === 0) return [];
      const rows = await fetchAllRows<LiveAccountRow>(
        "LIVE_DASHBOARD_ACCOUNTS_FAILED",
        (from, to) =>
          queryTable<LiveAccountRow>(
            supabase,
            "accounts",
            "id,name,industry,tier,open_pipeline_usd,owner_id,updated_at,workspace_id",
          )
            .eq("owner_id", userId)
            .eq("workspace_id", workspaceId)
            .in("id", accountIds)
            .order("id", { ascending: true })
            .range(from, to),
      );

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        industry: row.industry ?? undefined,
        tier: row.tier,
        openPipelineUsd: row.open_pipeline_usd,
        updatedAt: new Date(row.updated_at).toISOString(),
      }));
    },
  };
}

/**
 * Load the signed-in representative's latest durable published run for one
 * explicit workspace.
 *
 * This path never falls back to mock recommendations. The browser session is
 * authenticated first, the query is owner/workspace filtered, and Supabase RLS
 * remains the authoritative membership boundary. The caller must supply the
 * active workspace; this adapter does not infer tenant scope from whichever run
 * happens to be newest.
 */
export async function loadLatestPublishedRecommendationsForCurrentUser(
  workspaceId: string,
): Promise<Recommendation[]> {
  const session = await requireSession();
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId) {
    throw new Error("LIVE_RECOMMENDATIONS_REQUIRES_WORKSPACE");
  }
  if (!isSupabaseConfigured()) {
    throw new Error("LIVE_RECOMMENDATIONS_REQUIRES_SUPABASE");
  }

  const supabase = await createClient();
  return loadLatestPublishedRecommendations(supabase, session.userId, normalizedWorkspaceId);
}

/**
 * Resolve the authenticated representative's tenant scope, latest durable run,
 * and canonical account summaries for the live dashboard. A sole workspace is
 * selected automatically. Multiple memberships require an explicit authorized
 * workspace selection before recommendation data is read.
 */
export async function loadLiveDashboardForCurrentUser(
  selectedWorkspaceId?: string | string[],
): Promise<LiveDashboardData> {
  if (!isSupabaseConfigured()) {
    throw new Error("LIVE_DASHBOARD_REQUIRES_SUPABASE");
  }
  const session = await requireSession();
  const supabase = await createClient();
  return assembleLiveDashboardData(
    createLiveDashboardDataSource(supabase, session.userId),
    selectedWorkspaceId,
  );
}
