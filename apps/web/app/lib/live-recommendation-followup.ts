import { parseRecommendationFollowupState, type RecommendationFollowupState } from "./recommendation-followup-contract";
import { requireSession } from "./auth";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";

type RpcError = { message: string };
type RpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
};

export async function loadRecommendationFollowupForCurrentUser(
  workspaceId: string,
  recommendationId: string,
): Promise<RecommendationFollowupState> {
  await requireSession();
  if (!isSupabaseConfigured()) {
    throw new Error("RECOMMENDATION_FOLLOWUP_REQUIRES_SUPABASE");
  }

  const normalizedWorkspaceId = workspaceId.trim();
  const normalizedRecommendationId = recommendationId.trim();
  if (!normalizedWorkspaceId || !normalizedRecommendationId) {
    throw new Error("RECOMMENDATION_FOLLOWUP_INVALID_SCOPE");
  }

  const supabase = (await createClient()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc("get_recommendation_followup_state", {
    p_workspace_id: normalizedWorkspaceId,
    p_runtime_recommendation_id: normalizedRecommendationId,
  });

  if (error) {
    throw new Error(`RECOMMENDATION_FOLLOWUP_LOAD_FAILED: ${error.message}`);
  }
  return parseRecommendationFollowupState(data);
}
