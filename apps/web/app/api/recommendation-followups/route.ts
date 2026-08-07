import { NextResponse } from "next/server";
import {
  parseRecommendationFollowupRequest,
  parseRecommendationFollowupState,
  recommendationFollowupRpcStatus,
} from "../../lib/recommendation-followup-contract";
import { getSessionContext } from "../../lib/auth";
import { isSupabaseConfigured } from "../../lib/supabase/config";
import { createClient } from "../../lib/supabase/server";

type RpcError = { code?: string; message: string };
type RpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
};

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "RECOMMENDATION_FOLLOWUP_NOT_CONFIGURED" }, { status: 503 });
  }

  const json = await request.json().catch(() => null);
  let input;
  try {
    input = parseRecommendationFollowupRequest(json);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "RECOMMENDATION_FOLLOWUP_INVALID_REQUEST" },
      { status: 400 },
    );
  }

  // The database re-derives current membership, account ownership, recommendation
  // publication/verification state, actor identity, run and account provenance.
  // The browser can supply only the explicit recommendation scope, fixed follow-up
  // classification, and the prior event it observed for optimistic concurrency.
  const supabase = (await createClient()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc("record_recommendation_followup", {
    p_workspace_id: input.workspaceId,
    p_runtime_recommendation_id: input.recommendationId,
    p_kind: input.kind,
    p_code: input.code,
    p_expected_event_id: input.expectedEventId,
  });

  if (error) {
    return NextResponse.json(
      { error: "RECOMMENDATION_FOLLOWUP_REFUSED" },
      { status: recommendationFollowupRpcStatus(error.code) },
    );
  }

  try {
    return NextResponse.json({ followup: parseRecommendationFollowupState(data) });
  } catch {
    return NextResponse.json({ error: "RECOMMENDATION_FOLLOWUP_RESULT_INVALID" }, { status: 500 });
  }
}
