import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "../../lib/supabase/config";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import {
  parseActionExecutionRequest,
  parseActionExecutionState,
} from "../../lib/live-action-detail";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && !isSupabaseConfigured()) {
    return NextResponse.json({ error: "ACTION_EXECUTION_NOT_CONFIGURED" }, { status: 503 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "ACTION_EXECUTION_LIVE_ONLY" }, { status: 409 });
  }

  let input;
  try {
    input = parseActionExecutionRequest(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ACTION_EXECUTION_INVALID_REQUEST" },
      { status: 400 },
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "ACTION_EXECUTION_UNAUTHENTICATED" }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("execute_approved_protected_action", {
      p_workspace_id: input.workspaceId,
      p_runtime_recommendation_id: input.recommendationId,
      p_content: input.content,
    });
    if (error) {
      return NextResponse.json({ error: "ACTION_EXECUTION_DENIED" }, { status: 403 });
    }

    const execution = parseActionExecutionState(data);
    return NextResponse.json({ execution });
  } catch {
    return NextResponse.json({ error: "ACTION_EXECUTION_FAILED" }, { status: 500 });
  }
}
