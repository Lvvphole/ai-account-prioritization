import { NextResponse } from "next/server";
import {
  parseActionApprovalRequest,
  parseActionApprovalState,
} from "../../lib/live-action-detail";
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

function refusalStatus(code: string | undefined): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "22023") return 400;
  return 409;
}

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "LIVE_ACTION_APPROVAL_NOT_CONFIGURED" }, { status: 503 });
  }

  const json = await request.json().catch(() => null);
  let input;
  try {
    input = parseActionApprovalRequest(json);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ACTION_APPROVAL_INVALID_REQUEST" },
      { status: 400 },
    );
  }

  // The database derives account, owner, run, action type and current authority
  // from the persisted recommendation. The browser supplies only the explicit
  // workspace/recommendation scope, exact visible content and human decision.
  const supabase = (await createClient()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc("record_action_payload_decision", {
    p_workspace_id: input.workspaceId,
    p_runtime_recommendation_id: input.recommendationId,
    p_content: input.content,
    p_decision: input.decision,
  });

  if (error) {
    return NextResponse.json(
      { error: "ACTION_APPROVAL_REFUSED" },
      { status: refusalStatus(error.code) },
    );
  }

  try {
    return NextResponse.json({ approval: parseActionApprovalState(data) });
  } catch {
    return NextResponse.json({ error: "ACTION_APPROVAL_RESULT_INVALID" }, { status: 500 });
  }
}
