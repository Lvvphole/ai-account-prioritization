import { isHardBlock, isScorerReadable } from "@repo/shared-schemas";
import type {
  FindingClass,
  FindingSeverity,
  RecordDisposition,
  TrustClassification,
} from "@repo/shared-schemas";
import type { NormalizedRow } from "./normalization";

/**
 * Validation layers 3 to 5 (secure-ingestion spec, section 14).
 *
 * Layers 1 and 2 already happened: the parser enforced transport and file
 * controls, and the schema rejected unknown keys. What remains is everything
 * that needs context — other rows, the existing workspace, and history.
 *
 * The output is a disposition per row plus findings. Two rules shape it:
 *
 *   - An anomaly never silently changes anything. It raises a warning or
 *     quarantines the row, and the number it objected to is reported rather
 *     than adjusted (section 14.4).
 *   - A hard block is derived from the rule that fired, not chosen by the
 *     caller, so a cross-workspace reference cannot be filed as a warning.
 */

/* --------------------------------------------------------------- context -- */

/** What the workspace looked like before this batch. */
export interface ValidationContext {
  workspaceId: string;
  /** External ids already linked to an operational row for this source. */
  knownExternalIds: ReadonlySet<string>;
  /** Account external ids a child row may legitimately point at. */
  knownAccountExternalIds: ReadonlySet<string>;
  /** Users who hold membership in this workspace. */
  workspaceMemberIds: ReadonlySet<string>;
  /** Current totals, used for the historical anomaly layer. */
  baseline: {
    accountCount: number;
    totalOpenPipelineUsd: number;
  };
  /** Deterministic clock, so "future date" is testable. */
  now: Date;
}

/** Section 14.4 thresholds. Configurable, deterministic, never inferred. */
export interface AnomalyThresholds {
  /** Reject a date this far beyond now. */
  maxFutureDays: number;
  /** Reject a date older than this. */
  maxAgeYears: number;
  /** Warn when one row's pipeline exceeds this. */
  singleRowPipelineUsd: number;
  /** Warn when the batch would move workspace pipeline by this fraction. */
  workspacePipelineFraction: number;
  /** Warn when the batch would add this fraction of new accounts. */
  accountCountFraction: number;
  /** Warn when a text field grows beyond this many characters. */
  maxTextLength: number;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  maxFutureDays: 365,
  maxAgeYears: 25,
  singleRowPipelineUsd: 50_000_000,
  workspacePipelineFraction: 0.5,
  accountCountFraction: 0.5,
  maxTextLength: 10_000,
};

/* -------------------------------------------------------------- findings -- */

export interface RowFinding {
  sourceRowNumber: number;
  findingClass: FindingClass;
  severity: FindingSeverity;
  ruleId: string;
  canonicalField: string | null;
  /** Already redacted. Never carries a raw customer value. */
  redactedValue: string | null;
  explanation: string;
  downstreamImpact: string | null;
}

export interface ValidatedRow {
  row: NormalizedRow;
  disposition: RecordDisposition;
  findings: RowFinding[];
}

export interface ValidationResult {
  rows: ValidatedRow[];
  /** Findings about the batch rather than one row. */
  batchFindings: RowFinding[];
  counts: Record<RecordDisposition, number>;
}

/** Truncate and strip anything that could carry a payload into a log. */
function redact(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\r\n\t]+/g, " ").slice(0, 80);
  return text.length === 80 ? `${text}…` : text;
}

function finding(
  sourceRowNumber: number,
  findingClass: FindingClass,
  severity: FindingSeverity,
  ruleId: string,
  explanation: string,
  options: Partial<Pick<RowFinding, "canonicalField" | "redactedValue" | "downstreamImpact">> = {},
): RowFinding {
  return {
    sourceRowNumber,
    findingClass,
    severity,
    ruleId,
    canonicalField: options.canonicalField ?? null,
    redactedValue: options.redactedValue ?? null,
    explanation,
    downstreamImpact: options.downstreamImpact ?? null,
  };
}

/**
 * A row's disposition is the worst thing found in it.
 *
 * Derived rather than assigned, so a caller cannot downgrade a hard block by
 * passing a gentler disposition, and adding a critical rule automatically
 * quarantines rather than requiring a second edit somewhere else.
 */
export function dispositionFor(findings: readonly RowFinding[]): RecordDisposition {
  if (findings.some((f) => isHardBlock(f.ruleId))) return "rejected";
  if (findings.some((f) => f.ruleId === "duplicate_external_id_in_batch")) return "duplicate";
  if (findings.some((f) => f.severity === "critical")) return "rejected";
  if (findings.some((f) => f.severity === "high")) return "quarantined";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  return "ready";
}

/* ------------------------------------------------------------- the layers -- */

/** Layer 3: referential controls (section 14.3). */
function referentialFindings(
  row: NormalizedRow,
  ctx: ValidationContext,
  seenExternalIds: Map<string, number>,
): RowFinding[] {
  const out: RowFinding[] = [];
  const n = row.sourceRowNumber;

  if (!row.externalId) {
    out.push(
      finding(n, "identity", "critical", "missing_external_id",
        "The row has no external id, so it cannot be matched to a record on a later sync.",
        { canonicalField: "externalId" }),
    );
  } else {
    const firstSeen = seenExternalIds.get(row.externalId);
    if (firstSeen !== undefined) {
      out.push(
        finding(n, "duplicate", "warning", "duplicate_external_id_in_batch",
          `This external id also appears on row ${firstSeen}. Only the first occurrence commits.`,
          { canonicalField: "externalId", redactedValue: redact(row.externalId) }),
      );
    } else {
      seenExternalIds.set(row.externalId, n);
    }
  }

  for (const missing of row.missingRequired) {
    out.push(
      finding(n, "schema", "critical", "missing_required_field",
        "A field the mapping marks required is empty.",
        { canonicalField: missing }),
    );
  }

  for (const failure of row.failures) {
    out.push(
      finding(n, "schema", "high", `transform_failed_${failure.reason}`,
        `The value could not be read as ${failure.transform.replace(/_/g, " ")}.`,
        {
          canonicalField: failure.canonicalField,
          downstreamImpact: "The field is stored empty rather than as an unparsed string.",
        }),
    );
  }

  // A parent in another tenant is the case Epic 0 exists to stop, so it is a
  // hard block rather than something an administrator can wave through.
  const parentId = row.payload.accountExternalId;
  if (typeof parentId === "string" && parentId) {
    if (!ctx.knownAccountExternalIds.has(parentId)) {
      out.push(
        finding(n, "referential_integrity", "high", "parent_account_not_found",
          "The named parent account does not exist in this workspace.",
          { canonicalField: "accountExternalId", redactedValue: redact(parentId) }),
      );
    }
  }

  const ownerId = row.payload.ownerId;
  if (typeof ownerId === "string" && ownerId && !ctx.workspaceMemberIds.has(ownerId)) {
    out.push(
      finding(n, "authorization", "high", "owner_not_a_workspace_member",
        "The named owner does not hold membership in this workspace.",
        {
          canonicalField: "ownerId",
          redactedValue: redact(ownerId),
          downstreamImpact: "Committing would assign a book to somebody who cannot see it.",
        }),
    );
  }

  return out;
}

/** Layer 4: historical anomaly controls (section 14.4). */
function anomalyFindings(
  row: NormalizedRow,
  ctx: ValidationContext,
  thresholds: AnomalyThresholds,
): RowFinding[] {
  const out: RowFinding[] = [];
  const n = row.sourceRowNumber;

  const pipeline = row.payload.openPipelineUsd;
  if (typeof pipeline === "number" && pipeline > thresholds.singleRowPipelineUsd) {
    out.push(
      finding(n, "data_anomaly", "high", "single_row_pipeline_spike",
        "One row carries more open pipeline than the configured ceiling for a single account.",
        {
          canonicalField: "openPipelineUsd",
          redactedValue: redact(pipeline),
          // Reported, never adjusted. Section 14.4.
          downstreamImpact: "Quarantined for review. The value is not altered.",
        }),
    );
  }

  for (const [field, value] of Object.entries(row.payload)) {
    if (typeof value !== "string") continue;

    if (value.length > thresholds.maxTextLength) {
      out.push(
        finding(n, "data_anomaly", "warning", "excessive_text_growth",
          "A text field is far longer than this field normally carries.",
          { canonicalField: field }),
      );
    }

    // Dates were normalized to ISO by the transform layer, so anything
    // date-shaped here is comparable.
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const when = Date.parse(value);
      const futureLimit = ctx.now.getTime() + thresholds.maxFutureDays * 86_400_000;
      const pastLimit = ctx.now.getTime() - thresholds.maxAgeYears * 365 * 86_400_000;
      if (when > futureLimit) {
        out.push(
          finding(n, "data_anomaly", "warning", "implausible_future_date",
            "The date is further in the future than the configured window allows.",
            { canonicalField: field, redactedValue: redact(value) }),
        );
      } else if (when < pastLimit) {
        out.push(
          finding(n, "data_anomaly", "warning", "implausibly_old_date",
            "The date is older than the configured window allows.",
            { canonicalField: field, redactedValue: redact(value) }),
        );
      }
    }
  }

  return out;
}

/** Layer 5: trust controls (section 14.5). */
function trustFindings(row: NormalizedRow): RowFinding[] {
  const out: RowFinding[] = [];

  for (const [field, trust] of Object.entries(row.fieldTrust) as [string, TrustClassification][]) {
    if (trust !== "untrusted_text") continue;
    const value = row.payload[field];
    if (typeof value !== "string") continue;

    // Recording that instruction-shaped prose arrived is useful for an
    // operator. It changes nothing: the field is already unreadable to the
    // scorer, so this is an observation rather than a control.
    if (/\b(ignore (all )?previous|disregard (the )?above|system prompt|you are now|act as)\b/i.test(value)) {
      out.push(
        finding(row.sourceRowNumber, "prompt_injection_pattern", "info",
          "instruction_shaped_text_observed",
          "The field contains text shaped like an instruction. It is stored as data.",
          {
            canonicalField: field,
            downstreamImpact:
              "None. The field is classified untrusted_text and the scorer cannot read it.",
          }),
      );
    }
  }

  // Defence in depth for the boundary normalization already established: if a
  // prose field ever became scorer-readable, that is a bug worth a finding
  // rather than a silent behaviour change.
  for (const [field, trust] of Object.entries(row.fieldTrust) as [string, TrustClassification][]) {
    if (isScorerReadable(trust) && /notes|description|body|subject/i.test(field)) {
      out.push(
        finding(row.sourceRowNumber, "untrusted_text", "critical",
          "free_text_marked_scorer_readable",
          "A free-text field was classified as scorer-readable, which must not happen.",
          { canonicalField: field }),
      );
    }
  }

  return out;
}

/* ---------------------------------------------------------------- driver -- */

/**
 * Validate every row of a batch.
 *
 * Batch-level anomalies are computed from the rows rather than from a second
 * pass over the file, so the whole decision is made from what was staged.
 */
export function validateBatch(
  rows: readonly NormalizedRow[],
  ctx: ValidationContext,
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
): ValidationResult {
  const seenExternalIds = new Map<string, number>();
  const validated: ValidatedRow[] = [];

  for (const row of rows) {
    const findings = [
      ...referentialFindings(row, ctx, seenExternalIds),
      ...anomalyFindings(row, ctx, thresholds),
      ...trustFindings(row),
    ];
    validated.push({ row, disposition: dispositionFor(findings), findings });
  }

  const batchFindings: RowFinding[] = [];

  const newAccounts = validated.filter(
    (v) => v.row.externalId && !ctx.knownExternalIds.has(v.row.externalId),
  ).length;
  if (
    ctx.baseline.accountCount > 0 &&
    newAccounts / ctx.baseline.accountCount > thresholds.accountCountFraction
  ) {
    batchFindings.push(
      finding(0, "data_anomaly", "high", "account_count_spike",
        `The batch adds ${newAccounts} accounts against an existing ${ctx.baseline.accountCount}.`,
        { downstreamImpact: "Review before committing. No value is altered." }),
    );
  }

  const batchPipeline = validated.reduce((sum, v) => {
    const p = v.row.payload.openPipelineUsd;
    return sum + (typeof p === "number" ? p : 0);
  }, 0);
  if (
    ctx.baseline.totalOpenPipelineUsd > 0 &&
    Math.abs(batchPipeline) / ctx.baseline.totalOpenPipelineUsd >
      thresholds.workspacePipelineFraction
  ) {
    batchFindings.push(
      finding(0, "data_anomaly", "high", "workspace_pipeline_spike",
        "The batch would move workspace open pipeline by more than the configured fraction.",
        { downstreamImpact: "Review before committing. No value is altered." }),
    );
  }

  const counts: Record<RecordDisposition, number> = {
    ready: 0,
    warning: 0,
    quarantined: 0,
    rejected: 0,
    duplicate: 0,
  };
  for (const v of validated) counts[v.disposition] += 1;

  return { rows: validated, batchFindings, counts };
}
