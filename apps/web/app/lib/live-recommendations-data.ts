import { RecommendationSchema, type Recommendation } from "@repo/shared-schemas";
import type { Tables } from "@repo/supabase-client";
import { requireSession } from "./auth";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";

type LiveRecommendationRow = Tables<"recommendations"> & {
  workspace_id: string;
  runtime_recommendation_id: string;
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
 * Load the signed-in representative's latest durable published run.
 *
 * This path never falls back to mock recommendations. The browser session is
 * authenticated first, the query is owner-filtered, and Supabase RLS remains
 * the authoritative workspace boundary. The runtime persistence function also
 * guarantees that one persisted run cannot span workspaces.
 */
export async function loadLatestPublishedRecommendationsForCurrentUser(): Promise<
  Recommendation[]
> {
  const session = await requireSession();
  if (!isSupabaseConfigured()) {
    throw new Error("LIVE_RECOMMENDATIONS_REQUIRES_SUPABASE");
  }

  const supabase = await createClient();
  const latestResult = await supabase
    .from("recommendations")
    .select("*")
    .eq("owner_id", session.userId)
    .eq("published", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestResult.error) {
    throw new Error(`LIVE_RECOMMENDATIONS_LATEST_FAILED: ${latestResult.error.message}`);
  }
  if (!latestResult.data) return [];

  const latest = latestResult.data as unknown as LiveRecommendationRow;
  const runResult = await supabase
    .from("recommendations")
    .select("*")
    .eq("owner_id", session.userId)
    .eq("run_id", latest.run_id)
    .eq("published", true)
    .order("rank", { ascending: true });

  if (runResult.error) {
    throw new Error(`LIVE_RECOMMENDATIONS_RUN_FAILED: ${runResult.error.message}`);
  }

  return ((runResult.data ?? []) as unknown as LiveRecommendationRow[])
    .filter((row) => row.workspace_id === latest.workspace_id)
    .map(toRecommendation)
    .sort((a, b) => a.rank - b.rank);
}
