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
  if (code === "22023") return 400;
  return 409;
}

export async function POST(
  request: Request,
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

  const body = (await request.json().catch(() => null)) as { businessReason?: unknown } | null;
  const businessReason = typeof body?.businessReason === "string" ? body.businessReason.trim() : "";
  if (businessReason.length < 10 || businessReason.length > 1000) {
    return NextResponse.json({ error: "INVALID_BUSINESS_REASON" }, { status: 400 });
  }

  // The generated DB type intentionally follows committed table types and does
  // not yet enumerate ingestion RPCs. The RPC itself is the strict boundary;
  // no browser-supplied workspace, approver, threshold, or change data crosses it.
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data, error } = await supabase.rpc("approve_ingestion_batch", {
    p_batch_id: batchId,
    p_business_reason: businessReason,
  });

  if (error) {
    return NextResponse.json(
      { error: "IMPORT_APPROVAL_REFUSED", detail: error.message },
      { status: errorStatus(error.code) },
    );
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "IMPORT_APPROVAL_RESULT_INVALID" }, { status: 500 });
  }

  const result = data as Record<string, unknown>;
  return NextResponse.json({
    status: result.status,
    approvalId: result.approvalId,
    secondApprovalRequired: result.secondApprovalRequired,
    secondApprovedBy: result.secondApprovedBy,
    businessReason: result.businessReason,
    reasons: result.reasons,
  });
}
