import { z } from "zod";
import { CanonicalObjectType } from "./source";

/**
 * Manual CSV import contracts (secure-ingestion spec, sections 7 and 21.1).
 *
 * A CSV has no authoritative magic signature, so nothing here trusts a single
 * check. The limits are declared as data, the client is told them before it
 * uploads, and the server re-enforces every one of them on the bytes it
 * actually received. A client-supplied filename is metadata and never a path.
 */

/* --------------------------------------------------------------- limits -- */

/**
 * Section 7.1. Server-configured and displayed before upload, so a rejection
 * is predictable rather than a surprise after a long wait.
 */
export const ImportLimitsSchema = z
  .object({
    maxBytes: z.number().int().positive(),
    maxRows: z.number().int().positive(),
    maxColumns: z.number().int().positive(),
    maxCellCharacters: z.number().int().positive(),
    maxProcessingMs: z.number().int().positive(),
    /** Concurrent in-flight batches per workspace. */
    maxConcurrentBatches: z.number().int().positive(),
  })
  .strict();
export type ImportLimits = z.infer<typeof ImportLimitsSchema>;

/** Spec defaults. A deployment may lower these; nothing raises them silently. */
export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxRows: 100_000,
  maxColumns: 200,
  maxCellCharacters: 32_768,
  maxProcessingMs: 15 * 60 * 1000,
  maxConcurrentBatches: 3,
};

/* --------------------------------------------------------------- upload -- */

/** Section 7.2 step 1. */
export const ImportTemplateKind = z.enum([
  "accounts",
  "contacts",
  "opportunities",
  "activities",
  "intent_signals",
  "account_health",
  "combined_crm",
]);
export type ImportTemplateKind = z.infer<typeof ImportTemplateKind>;

/**
 * What the browser asks for. It names what it intends to upload and nothing
 * about where the bytes will live: the path is the server's to choose.
 */
export const UploadIntentRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    sourceId: z.string().uuid(),
    templateKind: ImportTemplateKind,
    objectType: CanonicalObjectType,
    mappingVersionId: z.string().uuid(),
    /** Recorded as metadata only. Never used to build a storage path. */
    originalFilename: z.string().min(1).max(255),
    /** Advisory. Section 21.1: MIME is not authoritative. */
    declaredContentType: z.string().max(255).optional(),
    /** Client's claim about size, checked again against the received bytes. */
    declaredBytes: z.number().int().nonnegative(),
  })
  .strict();
export type UploadIntentRequest = z.infer<typeof UploadIntentRequestSchema>;

export const UploadIntentSchema = z
  .object({
    batchId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    /** Server-generated, workspace-prefixed. Section 16.1. */
    storagePath: z.string().min(1).max(1000),
    bucket: z.literal("ingestion-quarantine"),
    signedUrl: z.string().url(),
    expiresAt: z.string().datetime(),
    /** Echoed back so the browser can show them next to the file picker. */
    limits: ImportLimitsSchema,
  })
  .strict();
export type UploadIntent = z.infer<typeof UploadIntentSchema>;

/**
 * Section 7.2 step 4. Finalize is idempotent and re-checks ownership rather
 * than trusting that the intent it issued earlier is the one being finalized.
 */
export const FinalizeUploadRequestSchema = z
  .object({
    batchId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    /** Observed by the server from storage, not reported by the client. */
    observedBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type FinalizeUploadRequest = z.infer<typeof FinalizeUploadRequestSchema>;

/* ---------------------------------------------------------------- scan -- */

/** Section 7.2 step 5. Every visible check, pass or fail, with a reason. */
export const ScanCheck = z.enum([
  "authorization",
  "workspace_binding",
  "object_ownership",
  "size_limits",
  "text_format",
  "malware",
  "parser_safety",
]);
export type ScanCheck = z.infer<typeof ScanCheck>;

export const ScanCheckResultSchema = z
  .object({
    check: ScanCheck,
    passed: z.boolean(),
    /** Redacted. Never contains file content. */
    detail: z.string().max(500).nullable(),
  })
  .strict();
export type ScanCheckResult = z.infer<typeof ScanCheckResultSchema>;

export const ScanVerdictSchema = z
  .object({
    batchId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    checks: z.array(ScanCheckResultSchema).min(1).max(20),
    /**
     * `unavailable` is distinct from `clean`. Production must not treat a
     * scanner it could not reach as a scanner that found nothing.
     */
    malwareStatus: z.enum(["clean", "infected", "unavailable"]),
    /** Names the scanner so an audit can tell which engine cleared the file. */
    providerId: z.string().min(1).max(100).nullable(),
    scannedAt: z.string().datetime(),
  })
  .strict();
export type ScanVerdict = z.infer<typeof ScanVerdictSchema>;

/* --------------------------------------------------------------- parse -- */

/** Why a file or a row was refused. Each maps to a finding rule id. */
export const ParseRejection = z.enum([
  "not_utf8",
  "nul_byte",
  "forbidden_control_character",
  "row_limit_exceeded",
  "column_limit_exceeded",
  "cell_length_exceeded",
  "byte_limit_exceeded",
  "duration_exceeded",
  "inconsistent_column_count",
  "unterminated_quote",
  "empty_file",
  "missing_header",
  "duplicate_header",
]);
export type ParseRejection = z.infer<typeof ParseRejection>;

export const ParsedRowSchema = z
  .object({
    /** 1-based, counting the header as row 1, so it matches what a user sees. */
    rowNumber: z.number().int().positive(),
    values: z.record(z.string()),
  })
  .strict();
export type ParsedRow = z.infer<typeof ParsedRowSchema>;

export const ParseOutcomeSchema = z
  .object({
    headers: z.array(z.string()).max(200),
    rowsParsed: z.number().int().nonnegative(),
    bytesRead: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    /** Present when the file was refused outright rather than row by row. */
    fatal: ParseRejection.nullable(),
    /** Per-row refusals. The rest of the file still parses. */
    rowErrors: z
      .array(
        z
          .object({
            rowNumber: z.number().int().positive(),
            reason: ParseRejection,
          })
          .strict(),
      )
      .max(1000),
    truncated: z.boolean(),
  })
  .strict();
export type ParseOutcome = z.infer<typeof ParseOutcomeSchema>;

/* ------------------------------------------------------------ approvals -- */

/**
 * Section 7.2 step 9. A change set crossing any of these needs a second
 * approver. Expressed as data so the preview can name which one triggered.
 */
export const SecondApprovalTriggerSchema = z
  .object({
    recordsChanged: z.number().int().positive(),
    workspaceAccountFraction: z.number().min(0).max(1),
    ownerChangeFraction: z.number().min(0).max(1),
    absolutePipelineDeltaUsd: z.number().positive(),
  })
  .strict();
export type SecondApprovalTrigger = z.infer<typeof SecondApprovalTriggerSchema>;

export const DEFAULT_SECOND_APPROVAL_TRIGGER: SecondApprovalTrigger = {
  recordsChanged: 10_000,
  workspaceAccountFraction: 0.1,
  ownerChangeFraction: 0.05,
  absolutePipelineDeltaUsd: 10_000_000,
};

/**
 * A cross-workspace reference or any hard security finding is not on this list
 * because neither is approvable. They block the commit outright (section 13.4),
 * and modelling them as "needs a second approver" would imply otherwise.
 */
export const NON_APPROVABLE_BLOCKERS: readonly string[] = [
  "cross_workspace_reference",
  "hard_security_finding",
];
