import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalObjectType, IngestionState } from "@repo/shared-schemas";
import type { ApprovalState } from "./imports-data";
import { createClient } from "./supabase/server";

export interface LiveImportListRow {
  batchId: string;
  name: string;
  objectType: CanonicalObjectType | null;
  mappingVersionId: string | null;
  state: IngestionState;
  totalRows: number;
  committableRows: number;
  createdAt: string;
  createdBy: string;
}

export interface LiveImportChangeSet {
  id: string;
  newRecords: number;
  updatedRecords: number;
  unchangedRecords: number;
  ownerChanges: number;
  referentialFailures: number;
  duplicateRecords: number;
  pipelineDeltaUsd: number;
  predictedGuardrailHolds: number;
  concentrationNotes: string | null;
}

export interface LiveImportBatch {
  batchId: string;
  name: string;
  objectType: CanonicalObjectType | null;
  mappingVersionId: string | null;
  state: IngestionState;
  totalRows: number;
  readyRows: number;
  warningRows: number;
  quarantinedRows: number;
  rejectedRows: number;
  duplicateRows: number;
  createdAt: string;
  createdBy: string;
  businessReason: string | null;
  file: {
    originalFilename: string;
    bytes: number;
    sha256: string;
    uploadedAt: string;
    scanStatus: string;
    scannedAt: string | null;
  } | null;
  changeSet: LiveImportChangeSet | null;
  approval: ApprovalState | null;
  blockers: string[];
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function liveClient(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

export async function loadLiveImportList(): Promise<LiveImportListRow[]> {
  const supabase = liveClient(await createClient());
  const { data, error } = await supabase
    .from("ingestion_batches")
    .select(
      "id,name,state,object_type,mapping_version_id,total_rows,ready_rows,warning_rows,created_at,created_by",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(100);

  if (error) throw new Error(`LIVE_IMPORT_HISTORY_UNAVAILABLE: ${error.message}`);

  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      batchId: asString(row.id),
      name: asNullableString(row.name) ?? "Unnamed import",
      objectType: (row.object_type ?? null) as CanonicalObjectType | null,
      mappingVersionId: asNullableString(row.mapping_version_id),
      state: row.state as IngestionState,
      totalRows: asNumber(row.total_rows),
      committableRows: asNumber(row.ready_rows) + asNumber(row.warning_rows),
      createdAt: asString(row.created_at),
      createdBy: asString(row.created_by),
    };
  });
}

export async function loadLiveImportBatch(batchId: string): Promise<LiveImportBatch | null> {
  const supabase = liveClient(await createClient());
  const { data: batchData, error: batchError } = await supabase
    .from("ingestion_batches")
    .select(
      "id,name,state,object_type,mapping_version_id,total_rows,ready_rows,warning_rows,quarantined_rows,rejected_rows,duplicate_rows,created_at,created_by,business_reason",
    )
    .eq("id", batchId)
    .maybeSingle();

  if (batchError) throw new Error(`LIVE_IMPORT_BATCH_UNAVAILABLE: ${batchError.message}`);
  if (!batchData) return null;

  const batch = batchData as Record<string, unknown>;

  const [fileResult, changeResult, approvalResult, findingsResult] = await Promise.all([
    supabase
      .from("ingestion_files")
      .select("original_filename,byte_size,sha256,uploaded_at,scan_status,scanned_at")
      .eq("batch_id", batchId)
      .order("uploaded_at", { ascending: false })
      .limit(1),
    supabase
      .from("change_sets")
      .select(
        "id,new_records,updated_records,unchanged_records,owner_changes,referential_failures,duplicate_records,pipeline_delta_usd,predicted_guardrail_holds,concentration_notes",
      )
      .eq("batch_id", batchId)
      .limit(2),
    supabase
      .from("import_approvals")
      .select(
        "approved_by,business_reason,second_approval_required,second_approved_by,review_change_set_id,review_snapshot_hash",
      )
      .eq("batch_id", batchId)
      .limit(2),
    supabase
      .from("ingestion_findings")
      .select("rule_id,disposition")
      .eq("batch_id", batchId),
  ]);

  for (const result of [fileResult, changeResult, approvalResult, findingsResult]) {
    if (result.error) throw new Error(`LIVE_IMPORT_DETAIL_UNAVAILABLE: ${result.error.message}`);
  }

  if ((changeResult.data?.length ?? 0) > 1) {
    throw new Error("LIVE_IMPORT_CHANGE_SET_NOT_UNIQUE");
  }
  if ((approvalResult.data?.length ?? 0) > 1) {
    throw new Error("LIVE_IMPORT_APPROVAL_NOT_UNIQUE");
  }

  const fileRaw = fileResult.data?.[0] as Record<string, unknown> | undefined;
  const changeRaw = changeResult.data?.[0] as Record<string, unknown> | undefined;
  const approvalRaw = approvalResult.data?.[0] as Record<string, unknown> | undefined;
  const blockers = (findingsResult.data ?? [])
    .map((raw) => raw as Record<string, unknown>)
    .filter((row) => row.disposition === "hard_block")
    .map((row) => asString(row.rule_id))
    .filter(Boolean)
    .sort();

  const approval: ApprovalState | null = approvalRaw
    ? {
        secondApprovalRequired: approvalRaw.second_approval_required === true,
        reasons:
          approvalRaw.second_approval_required === true
            ? ["Persisted risk policy requires a distinct second administrator approval."]
            : [],
        blockers,
        approvedBy: asNullableString(approvalRaw.approved_by),
        secondApprovedBy: asNullableString(approvalRaw.second_approved_by),
        businessReason: asNullableString(approvalRaw.business_reason),
      }
    : {
        secondApprovalRequired: false,
        reasons: [],
        blockers,
        approvedBy: null,
        secondApprovedBy: null,
        businessReason: asNullableString(batch.business_reason),
      };

  const changeSet: LiveImportChangeSet | null = changeRaw
    ? {
        id: asString(changeRaw.id),
        newRecords: asNumber(changeRaw.new_records),
        updatedRecords: asNumber(changeRaw.updated_records),
        unchangedRecords: asNumber(changeRaw.unchanged_records),
        ownerChanges: asNumber(changeRaw.owner_changes),
        referentialFailures: asNumber(changeRaw.referential_failures),
        duplicateRecords: asNumber(changeRaw.duplicate_records),
        pipelineDeltaUsd: asNumber(changeRaw.pipeline_delta_usd),
        predictedGuardrailHolds: asNumber(changeRaw.predicted_guardrail_holds),
        concentrationNotes: asNullableString(changeRaw.concentration_notes),
      }
    : null;

  return {
    batchId: asString(batch.id),
    name: asNullableString(batch.name) ?? "Unnamed import",
    objectType: (batch.object_type ?? null) as CanonicalObjectType | null,
    mappingVersionId: asNullableString(batch.mapping_version_id),
    state: batch.state as IngestionState,
    totalRows: asNumber(batch.total_rows),
    readyRows: asNumber(batch.ready_rows),
    warningRows: asNumber(batch.warning_rows),
    quarantinedRows: asNumber(batch.quarantined_rows),
    rejectedRows: asNumber(batch.rejected_rows),
    duplicateRows: asNumber(batch.duplicate_rows),
    createdAt: asString(batch.created_at),
    createdBy: asString(batch.created_by),
    businessReason: asNullableString(batch.business_reason),
    file: fileRaw
      ? {
          originalFilename: asString(fileRaw.original_filename),
          bytes: asNumber(fileRaw.byte_size),
          sha256: asString(fileRaw.sha256),
          uploadedAt: asString(fileRaw.uploaded_at),
          scanStatus: asString(fileRaw.scan_status),
          scannedAt: asNullableString(fileRaw.scanned_at),
        }
      : null,
    changeSet,
    approval,
    blockers,
  };
}
