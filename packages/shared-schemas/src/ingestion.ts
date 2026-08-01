import { z } from "zod";
import { CanonicalObjectType, SourceKind } from "./source";

/**
 * Ingestion pipeline contracts (secure-ingestion spec, sections 8, 13).
 *
 * Nothing here is an operational CRM record. A staged record is a candidate: it
 * carries its provenance, its disposition and its findings, and only a commit
 * turns accepted candidates into operational rows.
 */

/* ------------------------------------------------------------ lifecycle -- */

/** Section 8.1. Every batch is in exactly one of these. */
export const IngestionState = z.enum([
  "draft",
  "awaiting_upload",
  "awaiting_auth",
  "received",
  "security_scanning",
  "parsing",
  "mapping",
  "validating",
  "ready_for_review",
  "awaiting_approval",
  "committing",
  "committed",
  "processing_events",
  "completed",
  // Terminal or exceptional.
  "rejected",
  "quarantined",
  "failed",
  "cancelled",
  "rolled_back",
  "partially_rolled_back",
]);
export type IngestionState = z.infer<typeof IngestionState>;

/* ------------------------------------------------------------- envelope -- */

/**
 * Section 8.3. The canonical shape every source converges on, whatever its
 * transport. The raw payload is stored separately and never reaches a model or
 * the scorer.
 */
export const InboundRecordEnvelopeSchema = z
  .object({
    workspaceId: z.string().uuid(),
    sourceId: z.string().uuid(),
    batchId: z.string().uuid(),
    objectType: CanonicalObjectType,
    externalId: z.string().min(1).max(255),
    externalParentId: z.string().min(1).max(255).optional(),
    schemaVersion: z.string().min(1).max(50),
    occurredAt: z.string().datetime().optional(),
    receivedAt: z.string().datetime(),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRowNumber: z.number().int().positive().optional(),
    normalizedPayload: z.record(z.unknown()),
    provenance: z
      .object({
        sourceType: SourceKind,
        sourceRecordUrl: z.string().url().optional(),
        syncCursor: z.string().max(1000).optional(),
        externalEventId: z.string().max(255).optional(),
      })
      .strict(),
  })
  .strict();
export type InboundRecordEnvelope = z.infer<typeof InboundRecordEnvelopeSchema>;

/* ---------------------------------------------------------------- trust -- */

/**
 * Section 8.4. The scorer may consume only `verified_structured` and approved
 * `derived_deterministic` fields.
 *
 * `untrusted_text` exists so that free-form CRM prose is excluded by
 * construction rather than by remembering to exclude it. An authenticated CRM
 * is not a trusted one: prompt-like instructions inside a note are data.
 */
export const TrustClassification = z.enum([
  "verified_structured",
  "unverified_structured",
  "untrusted_text",
  "derived_deterministic",
  "blocked",
]);
export type TrustClassification = z.infer<typeof TrustClassification>;

/** Trust levels the deterministic scorer is permitted to read. */
export const SCORER_READABLE_TRUST: readonly TrustClassification[] = [
  "verified_structured",
  "derived_deterministic",
];

export function isScorerReadable(trust: TrustClassification): boolean {
  return SCORER_READABLE_TRUST.includes(trust);
}

/* ---------------------------------------------------------------- batch -- */

export const IngestionBatchSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    sourceId: z.string().uuid(),
    state: IngestionState,
    objectType: CanonicalObjectType.nullable(),
    mappingVersionId: z.string().uuid().nullable(),
    name: z.string().min(1).max(200).nullable(),
    businessReason: z.string().max(1000).nullable(),
    createdBy: z.string().uuid(),
    createdAt: z.string().datetime(),
    totalRows: z.number().int().nonnegative(),
    readyRows: z.number().int().nonnegative(),
    warningRows: z.number().int().nonnegative(),
    quarantinedRows: z.number().int().nonnegative(),
    rejectedRows: z.number().int().nonnegative(),
    duplicateRows: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (b) =>
      b.readyRows + b.warningRows + b.quarantinedRows + b.rejectedRows + b.duplicateRows <=
      b.totalRows,
    { message: "row dispositions cannot exceed totalRows" },
  );
export type IngestionBatch = z.infer<typeof IngestionBatchSchema>;

export const IngestionFileSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    batchId: z.string().uuid(),
    /** Server-generated. The client never chooses a storage path. */
    storagePath: z.string().min(1).max(1000),
    /** Recorded as metadata only; never used to build the storage path. */
    originalFilename: z.string().min(1).max(255),
    byteSize: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    scanStatus: z.enum(["pending", "clean", "infected", "unavailable"]),
    scannedAt: z.string().datetime().nullable(),
    uploadedAt: z.string().datetime(),
  })
  .strict();
export type IngestionFile = z.infer<typeof IngestionFileSchema>;

/* --------------------------------------------------------------- staged -- */

/** Section 7.2 step 7. One final disposition per row. */
export const RecordDisposition = z.enum([
  "ready",
  "warning",
  "quarantined",
  "rejected",
  "duplicate",
]);
export type RecordDisposition = z.infer<typeof RecordDisposition>;

/** Dispositions a commit is allowed to write to operational tables. */
export const COMMITTABLE_DISPOSITIONS: readonly RecordDisposition[] = ["ready", "warning"];

export function isCommittable(disposition: RecordDisposition): boolean {
  return COMMITTABLE_DISPOSITIONS.includes(disposition);
}

export const StagedRecordSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    batchId: z.string().uuid(),
    mappingVersionId: z.string().uuid(),
    objectType: CanonicalObjectType,
    externalId: z.string().min(1).max(255),
    sourceRowNumber: z.number().int().positive().nullable(),
    rowHash: z.string().regex(/^[a-f0-9]{64}$/),
    disposition: RecordDisposition,
    normalizedPayload: z.record(z.unknown()),
    /** Per-field trust, so the scorer boundary is enforceable downstream. */
    fieldTrust: z.record(TrustClassification),
    /** Set when an admin corrects a value; the original hash is retained. */
    correctedFromHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type StagedRecord = z.infer<typeof StagedRecordSchema>;

/* -------------------------------------------------------------- finding -- */

/** Section 13.1. */
export const FindingClass = z.enum([
  "file_security",
  "authentication",
  "authorization",
  "workspace_boundary",
  "schema",
  "mapping",
  "identity",
  "referential_integrity",
  "duplicate",
  "replay",
  "resource_limit",
  "data_anomaly",
  "untrusted_text",
  "prompt_injection_pattern",
  "credential",
  "malware",
  "system_error",
]);
export type FindingClass = z.infer<typeof FindingClass>;

export const FindingSeverity = z.enum(["info", "warning", "high", "critical"]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const FindingDisposition = z.enum([
  "open",
  "corrected",
  "ignored_with_reason",
  "rejected_record",
  "rejected_batch",
  "hard_block",
]);
export type FindingDisposition = z.infer<typeof FindingDisposition>;

/**
 * Section 13.4. These can never be overridden, so the UI must not offer an
 * approve action for them and the commit path must refuse regardless.
 */
export const HARD_BLOCK_RULES: readonly string[] = [
  "signature_invalid",
  "cross_workspace_reference",
  "malware_detected",
  "executable_content_in_csv",
  "credential_revoked",
  "hard_resource_limit_exceeded",
  "event_id_reuse_different_hash",
  "protected_field_mapping_attempt",
  "scoring_config_change_attempt",
  "customer_action_attempt",
];

export function isHardBlock(ruleId: string): boolean {
  return HARD_BLOCK_RULES.includes(ruleId);
}

export const IngestionFindingSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    batchId: z.string().uuid().nullable(),
    stagedRecordId: z.string().uuid().nullable(),
    domainEventId: z.string().uuid().nullable(),
    findingClass: FindingClass,
    severity: FindingSeverity,
    disposition: FindingDisposition,
    ruleId: z.string().min(1).max(100),
    canonicalField: z.string().max(255).nullable(),
    /** Redacted before storage. Raw values never land here. */
    redactedValue: z.string().max(500).nullable(),
    explanation: z.string().min(1).max(1000),
    downstreamImpact: z.string().max(1000).nullable(),
    reviewedBy: z.string().uuid().nullable(),
    resolutionReason: z.string().max(1000).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type IngestionFinding = z.infer<typeof IngestionFindingSchema>;

/* ----------------------------------------------------------- change set -- */

export const ChangeKind = z.enum(["create", "update", "unchanged", "owner_change"]);
export type ChangeKind = z.infer<typeof ChangeKind>;

export const ChangeSetItemSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    changeSetId: z.string().uuid(),
    stagedRecordId: z.string().uuid(),
    objectType: CanonicalObjectType,
    externalId: z.string().min(1).max(255),
    /** Null on create. Set once the record resolves to an existing row. */
    targetRecordId: z.string().uuid().nullable(),
    changeKind: ChangeKind,
    /** Before and after per changed field, so rollback is exact. */
    beforeValues: z.record(z.unknown()),
    afterValues: z.record(z.unknown()),
  })
  .strict();
export type ChangeSetItem = z.infer<typeof ChangeSetItemSchema>;

export const ChangeSetSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    batchId: z.string().uuid(),
    createdAt: z.string().datetime(),
    newRecords: z.number().int().nonnegative(),
    updatedRecords: z.number().int().nonnegative(),
    unchangedRecords: z.number().int().nonnegative(),
    ownerChanges: z.number().int().nonnegative(),
    referentialFailures: z.number().int().nonnegative(),
    duplicateRecords: z.number().int().nonnegative(),
    pipelineDeltaUsd: z.number(),
    accountsEnteringTopN: z.number().int().nonnegative(),
    accountsLeavingTopN: z.number().int().nonnegative(),
    predictedGuardrailHolds: z.number().int().nonnegative(),
    /** Free-form summary of territory or source concentration shifts. */
    concentrationNotes: z.string().max(1000).nullable(),
  })
  .strict();
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

/* --------------------------------------------------------------- commit -- */

export const ImportApprovalSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    batchId: z.string().uuid(),
    approvedBy: z.string().uuid(),
    businessReason: z.string().min(1).max(1000),
    /** Section 7.2 step 9. Set when a risk threshold demanded a second approver. */
    secondApprovalRequired: z.boolean(),
    /**
     * Null until the second admin acts. This record is who has approved so far,
     * not a promise about who will, so a first approver cannot fill it in on
     * someone else's behalf.
     */
    secondApprovedBy: z.string().uuid().nullable(),
    approvedAt: z.string().datetime(),
  })
  .strict();
export type ImportApproval = z.infer<typeof ImportApprovalSchema>;

export const ImportCommitSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    batchId: z.string().uuid(),
    changeSetId: z.string().uuid(),
    approvalId: z.string().uuid(),
    committedBy: z.string().uuid(),
    committedAt: z.string().datetime(),
    recordsCreated: z.number().int().nonnegative(),
    recordsUpdated: z.number().int().nonnegative(),
    /** Null until a compensating rollback exists. */
    rolledBackByCommitId: z.string().uuid().nullable(),
  })
  .strict();
export type ImportCommit = z.infer<typeof ImportCommitSchema>;

export const ImportRollbackSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    /** The commit being compensated. Never edited or deleted. */
    originalCommitId: z.string().uuid(),
    /** The compensating commit this rollback produced. */
    compensatingCommitId: z.string().uuid().nullable(),
    requestedBy: z.string().uuid(),
    businessReason: z.string().min(1).max(1000),
    state: z.enum(["requested", "conflicted", "applied", "partially_applied", "denied"]),
    /** Records changed since the original commit, so rollback is conflict-aware. */
    conflictCount: z.number().int().nonnegative(),
    requestedAt: z.string().datetime(),
  })
  .strict();
export type ImportRollback = z.infer<typeof ImportRollbackSchema>;

/** Section 19.2. Ties an operational record back to its source record. */
export const ExternalRecordLinkSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    sourceId: z.string().uuid(),
    objectType: CanonicalObjectType,
    externalId: z.string().min(1).max(255),
    /** The operational row this external record resolves to. */
    internalRecordId: z.string().uuid(),
    lastCommitId: z.string().uuid().nullable(),
    lastSeenAt: z.string().datetime(),
  })
  .strict();
export type ExternalRecordLink = z.infer<typeof ExternalRecordLinkSchema>;
