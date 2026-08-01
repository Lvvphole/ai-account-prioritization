import {
  DEFAULT_IMPORT_LIMITS,
  DEFAULT_SECOND_APPROVAL_TRIGGER,
  IMPORT_TEMPLATES,
} from "@repo/shared-schemas";
import type {
  CanonicalObjectType,
  ChangeKind,
  FindingSeverity,
  ImportTemplateKind,
  IngestionState,
  RecordDisposition,
  ScanCheck,
} from "@repo/shared-schemas";

/**
 * Import console presentation data (secure-ingestion spec, section 7.2).
 *
 * These shapes mirror the pipeline contracts rather than restating them: a
 * batch here holds the same `IngestionState`, the same `ScanCheck` set and the
 * same `RecordDisposition` values the worker produces, so a screen cannot show
 * a status the pipeline is incapable of reaching.
 *
 * The batches below are sample data. `IMPORT_HISTORY_IS_SAMPLE` is rendered on
 * the page, for the same reason the telemetry counters say so: an operations
 * console that quietly shows fixtures is worse than one that shows nothing.
 */

export const IMPORT_HISTORY_IS_SAMPLE = true;

export const IMPORT_LIMITS = DEFAULT_IMPORT_LIMITS;
export const SECOND_APPROVAL_TRIGGER = DEFAULT_SECOND_APPROVAL_TRIGGER;

/* ------------------------------------------------------------ vocabulary -- */

/** Plain-language labels. The enum values are contract, not copy. */
export const STATE_LABEL: Record<IngestionState, string> = {
  draft: "Draft",
  awaiting_upload: "Awaiting upload",
  awaiting_auth: "Awaiting authorization",
  received: "Received",
  security_scanning: "Security scanning",
  parsing: "Parsing",
  mapping: "Mapping",
  validating: "Validating",
  ready_for_review: "Ready for review",
  awaiting_approval: "Awaiting approval",
  committing: "Committing",
  committed: "Committed",
  processing_events: "Processing events",
  completed: "Completed",
  rejected: "Rejected",
  quarantined: "Quarantined",
  failed: "Failed",
  cancelled: "Cancelled",
  rolled_back: "Rolled back",
  partially_rolled_back: "Partially rolled back",
};

export type Tone = "good" | "warn" | "bad" | "neutral";

export function stateTone(state: IngestionState): Tone {
  if (state === "completed" || state === "committed") return "good";
  if (
    state === "rejected" ||
    state === "quarantined" ||
    state === "failed" ||
    state === "rolled_back" ||
    state === "partially_rolled_back"
  ) {
    return "bad";
  }
  if (state === "ready_for_review" || state === "awaiting_approval") return "warn";
  return "neutral";
}

export const CHECK_LABEL: Record<ScanCheck, string> = {
  authorization: "Authorization",
  workspace_binding: "Workspace binding",
  object_ownership: "Object ownership",
  size_limits: "Size limits",
  text_format: "Text-format checks",
  malware: "Malware scan",
  parser_safety: "Parser-safety checks",
};

export const DISPOSITION_LABEL: Record<RecordDisposition, string> = {
  ready: "Ready",
  warning: "Warning",
  quarantined: "Quarantined",
  rejected: "Rejected",
  duplicate: "Duplicate",
};

/** Only `ready` and `warning` may commit (section 7.2 step 7). */
export const COMMITTABLE_DISPOSITIONS: readonly RecordDisposition[] = ["ready", "warning"];

export function dispositionTone(disposition: RecordDisposition): Tone {
  if (disposition === "ready") return "good";
  if (disposition === "warning" || disposition === "duplicate") return "warn";
  return "bad";
}

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  create: "New record",
  update: "Update",
  unchanged: "No change",
  owner_change: "Ownership change",
};

/* ---------------------------------------------------------------- shapes -- */

export interface ScanCheckRow {
  check: ScanCheck;
  passed: boolean;
  detail: string | null;
}

export interface BatchFinding {
  sourceRowNumber: number | null;
  severity: FindingSeverity;
  ruleId: string;
  canonicalField: string | null;
  /** Already redacted upstream. This layer never re-derives a raw value. */
  redactedValue: string | null;
  explanation: string;
  downstreamImpact: string | null;
  rowsAffected: number;
}

export interface ChangeSetItemRow {
  sourceRowNumber: number;
  objectType: CanonicalObjectType;
  externalId: string;
  changeKind: ChangeKind;
  beforeValues: Record<string, string>;
  afterValues: Record<string, string>;
}

/** Mirrors the runtime preview, including its refusal to guess rank impact. */
export interface ChangeSetSummary {
  newRecords: number;
  updatedRecords: number;
  unchangedRecords: number;
  ownerChanges: number;
  referentialFailures: number;
  duplicateRecords: number;
  pipelineDeltaUsd: number;
  rankImpact: { accountsEnteringTopN: number; accountsLeavingTopN: number; topN: number } | null;
  rankImpactUnavailableReason: string | null;
  predictedGuardrailHolds: number;
  concentrationNotes: string | null;
  items: ChangeSetItemRow[];
}

export interface ApprovalState {
  secondApprovalRequired: boolean;
  reasons: string[];
  /** Never approvable. Present means the commit is refused, not escalated. */
  blockers: string[];
  approvedBy: string | null;
  secondApprovedBy: string | null;
  businessReason: string | null;
}

export interface LineageHop {
  layer: string;
  ref: string;
  detail: string;
}

export interface ImportBatch {
  batchId: string;
  name: string;
  templateKind: ImportTemplateKind;
  objectType: CanonicalObjectType | null;
  mappingVersion: string;
  state: IngestionState;
  originalFilename: string;
  bytes: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
  /** Null until the scan runs. */
  scan: {
    checks: ScanCheckRow[];
    malwareStatus: "clean" | "infected" | "unavailable";
    providerId: string | null;
    scannedAt: string;
  } | null;
  parse: {
    headers: string[];
    rowsParsed: number;
    durationMs: number;
    fatal: string | null;
    rowErrors: { rowNumber: number; reason: string }[];
    truncated: boolean;
  } | null;
  dispositions: Record<RecordDisposition, number>;
  findings: BatchFinding[];
  changeSet: ChangeSetSummary | null;
  approval: ApprovalState | null;
  lineage: LineageHop[];
  /** Set once a compensating rollback has been issued. */
  rollback: {
    issuedBy: string;
    issuedAt: string;
    reason: string;
    recordsRestored: number;
    conflicts: { externalId: string; detail: string }[];
  } | null;
}

/* ----------------------------------------------------------------- data -- */

function passingChecks(overrides: Partial<Record<ScanCheck, ScanCheckRow>> = {}): ScanCheckRow[] {
  const order: ScanCheck[] = [
    "authorization",
    "workspace_binding",
    "object_ownership",
    "size_limits",
    "text_format",
    "malware",
    "parser_safety",
  ];
  return order.map(
    (check) => overrides[check] ?? { check, passed: true, detail: null },
  );
}

export const IMPORT_BATCHES: ImportBatch[] = [
  {
    batchId: "b7c1e2a4-0f3d-4c8e-9a1b-5d6e7f801234",
    name: "Q3 account refresh",
    templateKind: "accounts",
    objectType: "account",
    mappingVersion: "accounts-v1",
    state: "ready_for_review",
    originalFilename: "q3-accounts.csv",
    bytes: 1_842_113,
    sha256: "9f2c4a1e6b8d0357e9f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7",
    uploadedBy: "avery.stone@example.com",
    uploadedAt: "2026-07-31 09:14 UTC",
    scan: {
      checks: passingChecks(),
      malwareStatus: "clean",
      providerId: "clamav-0.103",
      scannedAt: "2026-07-31 09:14 UTC",
    },
    parse: {
      headers: IMPORT_TEMPLATES.accounts.columns.map((c) => c.canonicalField),
      rowsParsed: 4_812,
      durationMs: 6_140,
      fatal: null,
      rowErrors: [
        { rowNumber: 902, reason: "cell_length_exceeded" },
        { rowNumber: 3311, reason: "inconsistent_column_count" },
      ],
      truncated: false,
    },
    dispositions: { ready: 4_463, warning: 271, quarantined: 44, rejected: 12, duplicate: 22 },
    findings: [
      {
        sourceRowNumber: null,
        severity: "warning",
        ruleId: "duplicate_external_id_in_batch",
        canonicalField: "externalId",
        redactedValue: null,
        explanation:
          "An external id appears more than once in this file. Only the first occurrence commits.",
        downstreamImpact: "Later rows for the same id are staged and skipped.",
        rowsAffected: 22,
      },
      {
        sourceRowNumber: null,
        severity: "high",
        ruleId: "owner_not_a_workspace_member",
        canonicalField: "ownerId",
        redactedValue: "user-8841",
        explanation: "The named owner does not hold membership in this workspace.",
        downstreamImpact: "Committing would assign a book to somebody who cannot see it.",
        rowsAffected: 44,
      },
      {
        sourceRowNumber: null,
        severity: "critical",
        ruleId: "missing_external_id",
        canonicalField: "externalId",
        redactedValue: null,
        explanation:
          "The row has no external id, so it cannot be matched to a record on a later sync.",
        downstreamImpact: "The row cannot commit and is not approvable.",
        rowsAffected: 12,
      },
      {
        sourceRowNumber: null,
        severity: "warning",
        ruleId: "pipeline_value_out_of_band",
        canonicalField: "openPipelineUsd",
        redactedValue: "8400000.00",
        explanation: "The value is far outside this workspace's usual range for the field.",
        downstreamImpact: "The account would enter the top-N preview on this row alone.",
        rowsAffected: 3,
      },
    ],
    changeSet: {
      newRecords: 318,
      updatedRecords: 4_416,
      unchangedRecords: 0,
      ownerChanges: 96,
      referentialFailures: 44,
      duplicateRecords: 22,
      pipelineDeltaUsd: 2_884_500,
      rankImpact: { accountsEnteringTopN: 4, accountsLeavingTopN: 4, topN: 25 },
      rankImpactUnavailableReason: null,
      predictedGuardrailHolds: 271,
      concentrationNotes: null,
      items: [
        {
          sourceRowNumber: 2,
          objectType: "account",
          externalId: "ACME-001",
          changeKind: "owner_change",
          beforeValues: { ownerId: "user-1", openPipelineUsd: "185000.00" },
          afterValues: { ownerId: "user-4", openPipelineUsd: "242000.00" },
        },
        {
          sourceRowNumber: 3,
          objectType: "account",
          externalId: "NORTHWIND-014",
          changeKind: "update",
          beforeValues: { openPipelineUsd: "42500.50" },
          afterValues: { openPipelineUsd: "61200.00" },
        },
        {
          sourceRowNumber: 9,
          objectType: "account",
          externalId: "HELIOS-220",
          changeKind: "create",
          beforeValues: {},
          afterValues: { name: "Helios Renewables", tier: "mid_market", openPipelineUsd: "78000.00" },
        },
        {
          sourceRowNumber: 41,
          objectType: "account",
          externalId: "VERTEX-118",
          changeKind: "owner_change",
          beforeValues: { ownerId: "user-7" },
          afterValues: { ownerId: "" },
        },
      ],
    },
    approval: {
      secondApprovalRequired: false,
      reasons: [],
      blockers: [],
      approvedBy: null,
      secondApprovedBy: null,
      businessReason: null,
    },
    lineage: [],
    rollback: null,
  },
  {
    batchId: "c8d2f3b5-1e4a-4d9f-8b2c-6e7f8a912345",
    name: "July opportunity load",
    templateKind: "opportunities",
    objectType: "opportunity",
    mappingVersion: "opportunities-v1",
    state: "completed",
    originalFilename: "july-opportunities.csv",
    bytes: 612_004,
    sha256: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809",
    uploadedBy: "avery.stone@example.com",
    uploadedAt: "2026-07-24 16:02 UTC",
    scan: {
      checks: passingChecks(),
      malwareStatus: "clean",
      providerId: "clamav-0.103",
      scannedAt: "2026-07-24 16:02 UTC",
    },
    parse: {
      headers: IMPORT_TEMPLATES.opportunities.columns.map((c) => c.canonicalField),
      rowsParsed: 1_204,
      durationMs: 1_890,
      fatal: null,
      rowErrors: [],
      truncated: false,
    },
    dispositions: { ready: 1_198, warning: 6, quarantined: 0, rejected: 0, duplicate: 0 },
    findings: [
      {
        sourceRowNumber: null,
        severity: "warning",
        ruleId: "close_date_in_the_past",
        canonicalField: "closeDate",
        redactedValue: null,
        explanation: "The expected close date is already behind us.",
        downstreamImpact: "The opportunity is imported but will not raise a renewal signal.",
        rowsAffected: 6,
      },
    ],
    changeSet: {
      newRecords: 214,
      updatedRecords: 990,
      unchangedRecords: 0,
      ownerChanges: 0,
      referentialFailures: 0,
      duplicateRecords: 0,
      pipelineDeltaUsd: -412_000,
      rankImpact: null,
      rankImpactUnavailableReason:
        "This import changes opportunities, not accounts, so it has no top-N movement of its own. Account ranking updates when the affected accounts are rescored.",
      predictedGuardrailHolds: 6,
      concentrationNotes: null,
      items: [],
    },
    approval: {
      secondApprovalRequired: false,
      reasons: [],
      blockers: [],
      approvedBy: "avery.stone@example.com",
      secondApprovedBy: null,
      businessReason: "Monthly pipeline reconciliation from the CRM export.",
    },
    lineage: [
      {
        layer: "File",
        ref: "july-opportunities.csv",
        detail: "612 KB, SHA-256 1a2b3c4d…, quarantine bucket, deleted after 7 days",
      },
      {
        layer: "Ingestion batch",
        ref: "c8d2f3b5",
        detail: "Scanned clean by clamav-0.103, parsed 1,204 rows in 1.9 s",
      },
      {
        layer: "Staged records",
        ref: "1,204 staged",
        detail: "1,198 ready, 6 warning, 0 quarantined, 0 rejected",
      },
      {
        layer: "Commit",
        ref: "commit 4f19c2",
        detail: "1,204 rows written, approved by avery.stone@example.com",
      },
      {
        layer: "Domain events",
        ref: "1,204 events",
        detail: "214 opportunity.created, 990 opportunity.updated",
      },
      {
        layer: "Prioritization runs",
        ref: "run 2026-07-24-b",
        detail: "882 affected accounts rescored by the deterministic scorer",
      },
      {
        layer: "Recommendations",
        ref: "126 changed",
        detail: "Reason codes updated; nothing sent without approval",
      },
      {
        layer: "Audit evidence",
        ref: "audit 9c41e0",
        detail: "Immutable. Rollback would append a compensating entry, never edit this one.",
      },
    ],
    rollback: null,
  },
  {
    batchId: "d9e3a4c6-2f5b-4e0a-9c3d-7f8a9b023456",
    name: "Territory reassignment",
    templateKind: "accounts",
    objectType: "account",
    mappingVersion: "accounts-v1",
    state: "quarantined",
    originalFilename: "territory-2026.csv",
    bytes: 94_220,
    sha256: "5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
    uploadedBy: "jordan.reyes@example.com",
    uploadedAt: "2026-07-29 11:47 UTC",
    scan: {
      checks: passingChecks({
        parser_safety: {
          check: "parser_safety",
          passed: false,
          detail: "12 cells begin with a formula character and were neutralized before staging.",
        },
      }),
      malwareStatus: "clean",
      providerId: "clamav-0.103",
      scannedAt: "2026-07-29 11:47 UTC",
    },
    parse: {
      headers: IMPORT_TEMPLATES.accounts.columns.map((c) => c.canonicalField),
      rowsParsed: 612,
      durationMs: 740,
      fatal: null,
      rowErrors: [],
      truncated: false,
    },
    dispositions: { ready: 0, warning: 0, quarantined: 612, rejected: 0, duplicate: 0 },
    findings: [
      {
        sourceRowNumber: null,
        severity: "critical",
        ruleId: "cross_workspace_reference",
        canonicalField: "accountExternalId",
        redactedValue: "WS2-ACCT-4471",
        explanation: "The file references records that belong to a different workspace.",
        downstreamImpact:
          "The batch cannot commit. A cross-workspace reference is not approvable by anyone.",
        rowsAffected: 612,
      },
    ],
    changeSet: null,
    approval: {
      secondApprovalRequired: false,
      reasons: [],
      blockers: ["cross_workspace_reference"],
      approvedBy: null,
      secondApprovedBy: null,
      businessReason: null,
    },
    lineage: [],
    rollback: null,
  },
];

export function findBatch(batchId: string): ImportBatch | undefined {
  return IMPORT_BATCHES.find((b) => b.batchId === batchId);
}

/** Short id for display. The full id stays in links and audit records. */
export function shortId(batchId: string): string {
  return batchId.slice(0, 8);
}

export function formatUsd(amount: number): string {
  const sign = amount < 0 ? "−" : "+";
  return `${sign}$${Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function totalRows(dispositions: Record<RecordDisposition, number>): number {
  return Object.values(dispositions).reduce((sum, n) => sum + n, 0);
}

export function committableRows(dispositions: Record<RecordDisposition, number>): number {
  return COMMITTABLE_DISPOSITIONS.reduce((sum, d) => sum + dispositions[d], 0);
}
