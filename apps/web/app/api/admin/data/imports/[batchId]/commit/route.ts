import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { can } from "@repo/security";
import { getSessionContext } from "../../../../../../lib/auth";
import { isSupabaseConfigured } from "../../../../../../lib/supabase/config";
import { createClient } from "../../../../../../lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorStatus(code: string | undefined): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  return 409;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const session = await getSessionContext();
  if (!session) return NextResponse.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  if (!can(session.role, "commit_manual_import")) {
    return NextResponse.json({ error: "IMPORT_COMMIT_FORBIDDEN" }, { status: 403 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "LIVE_INGESTION_NOT_CONFIGURED" }, { status: 503 });
  }

  const { batchId } = await params;
  if (!UUID.test(batchId)) {
    return NextResponse.json({ error: "INVALID_BATCH_ID" }, { status: 400 });
  }

  // Resolve the immutable commit inputs from persistence. The request only
  // names the batch; it cannot select another change set or another approval.
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const [{ data: changeSets, error: changeError }, { data: approvals, error: approvalError }] =
    await Promise.all([
      supabase.from("change_sets").select("id").eq("batch_id", batchId).limit(2),
      supabase.from("import_approvals").select("id").eq("batch_id", batchId).limit(2),
    ]);

  if (changeError || approvalError) {
    return NextResponse.json({ error: "IMPORT_COMMIT_CONTEXT_UNAVAILABLE" }, { status: 409 });
  }
  if (!changeSets || changeSets.length !== 1) {
    return NextResponse.json({ error: "IMPORT_CHANGE_SET_NOT_UNIQUE" }, { status: 409 });
  }
  if (!approvals || approvals.length !== 1) {
    return NextResponse.json({ error: "IMPORT_APPROVAL_NOT_UNIQUE" }, { status: 409 });
  }

  const changeSetId = (changeSets[0] as { id: string }).id;
  const approvalId = (approvals[0] as { id: string }).id;
  const { data, error } = await supabase.rpc("commit_ingestion_batch", {
    p_batch_id: batchId,
    p_change_set_id: changeSetId,
    p_approval_id: approvalId,
  });

  if (error) {
    return NextResponse.json(
      { error: "IMPORT_COMMIT_REFUSED", detail: error.message },
      { status: errorStatus(error.code) },
    );
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "IMPORT_COMMIT_RESULT_INVALID" }, { status: 500 });
  }

  const result = data as Record<string, unknown>;
  return NextResponse.json({
    status: result.status,
    batchId: result.batchId,
    commitId: result.commitId,
    recordsCreated: result.recordsCreated,
    recordsUpdated: result.recordsUpdated,
    state: result.state,
  });
}
