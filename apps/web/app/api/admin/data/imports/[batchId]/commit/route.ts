import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { can } from "@repo/security";
import { getSessionContext } from "../../../../../../lib/auth";
import { isSupabaseConfigured } from "../../../../../../lib/supabase/config";
import { createClient } from "../../../../../../lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

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

  // Resolve the exact reviewed change set from the persisted approval binding.
  // The request only names the batch. It cannot select a newer preview or an
  // unreviewed change set after the administrator has approved.
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: approvals, error: approvalError } = await supabase
    .from("import_approvals")
    .select("id,review_change_set_id,review_snapshot_hash")
    .eq("batch_id", batchId)
    .limit(2);

  if (approvalError) {
    return NextResponse.json({ error: "IMPORT_COMMIT_CONTEXT_UNAVAILABLE" }, { status: 409 });
  }
  if (!approvals || approvals.length !== 1) {
    return NextResponse.json({ error: "IMPORT_APPROVAL_NOT_UNIQUE" }, { status: 409 });
  }

  const approval = approvals[0] as {
    id: unknown;
    review_change_set_id: unknown;
    review_snapshot_hash: unknown;
  };
  if (
    typeof approval.id !== "string" ||
    !UUID.test(approval.id) ||
    typeof approval.review_change_set_id !== "string" ||
    !UUID.test(approval.review_change_set_id) ||
    typeof approval.review_snapshot_hash !== "string" ||
    !SHA256.test(approval.review_snapshot_hash)
  ) {
    return NextResponse.json({ error: "IMPORT_APPROVAL_REVIEW_BINDING_INVALID" }, { status: 409 });
  }

  const { data, error } = await supabase.rpc("commit_ingestion_batch", {
    p_batch_id: batchId,
    p_change_set_id: approval.review_change_set_id,
    p_approval_id: approval.id,
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
