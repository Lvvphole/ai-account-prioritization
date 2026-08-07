import { RecommendationSchema, type Recommendation } from "@repo/shared-schemas";
import type { Tables } from "@repo/supabase-client";
import { requireSession } from "./auth";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";

type LiveRecommendationRow = Tables<"recommendations"> & {
  workspace_id: string;
  runtime_recommendation_id: string;
};

type QueryError = { message: string };
type LiveRecommendationQuery = PromiseLike<{
  data: LiveRecommendationRow[] | null;
  error: QueryError | null;
}> & {
  eq(column: string, value: string | boolean): LiveRecommendationQuery;
  order(
    column: string,
    options: { ascending: boolean },
  ): LiveRecommendationQuery;
  limit(count: number): LiveRecommendationQuery;
  maybeSingle(): PromiseLike<{
    data: LiveRecommendationRow | null;
    error: QueryError | null;
  }>;
};

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
  const recommendations = supabase
    .from("recommendations")
    .select("*") as unknown as LiveRecommendationQuery;

  const latestResult = await recommendations
    .eq("owner_id", session.userId)
    .eq("workspace_id", normalizedWorkspaceId)
    .eq("published", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestResult.error) {
    throw new Error(`LIVE_RECOMMENDATIONS_LATEST_FAILED: ${latestResult.error.message}`);
  }
  if (!latestResult.data) return [];

  const latest = latestResult.data;
  const runQuery = supabase
    .from("recommendations")
    .select("*") as unknown as LiveRecommendationQuery;
  const runResult = await runQuery
    .eq("owner_id", session.userId)
    .eq("workspace_id", normalizedWorkspaceId)
    .eq("run_id", latest.run_id)
    .eq("published", true)
    .order("rank", { ascending: true });

  if (runResult.error) {
    throw new Error(`LIVE_RECOMMENDATIONS_RUN_FAILED: ${runResult.error.message}`);
  }

  return (runResult.data ?? []).map(toRecommendation).sort((a, b) => a.rank - b.rank);
}
