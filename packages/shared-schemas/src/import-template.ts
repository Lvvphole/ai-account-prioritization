import { z } from "zod";
import { CanonicalObjectType, FieldTransform } from "./source";
import { ImportTemplateKind } from "./csv-import";

/**
 * Downloadable CSV templates (secure-ingestion spec, section 7.2 step 2).
 *
 * A template is a contract, not a convenience. Whatever it declares required is
 * what validation will demand, and whatever enum it lists is what the transform
 * will accept — so these definitions are the single place both are written down.
 * `packages/testing-evals/src/import-template.eval.ts` holds the two sides
 * together: it builds a mapping from the template, runs the template's own
 * example rows through the real parser and validator, and fails if a file
 * produced exactly as instructed would be rejected.
 *
 * The renderer neutralizes formula-leading values on the way out. Nothing here
 * ever evaluates a cell, so this is not self-protection: it is refusing to hand
 * a live formula to whoever opens the download in a spreadsheet.
 */

/* --------------------------------------------------------------- shapes -- */

export const TemplateColumnSchema = z
  .object({
    /** Doubles as the CSV header. Canonical names are the header names. */
    canonicalField: z.string().min(1).max(255),
    required: z.boolean(),
    transform: FieldTransform,
    /** One line, shown in the column reference next to the download. */
    description: z.string().min(1).max(300),
    /** Present when the value must come from a closed set. */
    enumValues: z.array(z.string().min(1)).min(1).optional(),
    maxLength: z.number().int().positive().optional(),
  })
  .strict();
export type TemplateColumn = z.infer<typeof TemplateColumnSchema>;

export const ImportTemplateSchema = z
  .object({
    kind: ImportTemplateKind,
    /** Null for the combined template, which carries the type per row. */
    objectType: CanonicalObjectType.nullable(),
    label: z.string().min(1).max(100),
    /** Section 7.2 step 2: templates are versioned and the version travels. */
    version: z.string().regex(/^v\d+$/),
    columns: z.array(TemplateColumnSchema).min(1).max(200),
    /** Filled example rows, keyed by canonical field. */
    examples: z.array(z.record(z.string())).min(1).max(10),
  })
  .strict();
export type ImportTemplate = z.infer<typeof ImportTemplateSchema>;

/** Every template moves together; a mixed set is how a mapping drifts. */
export const IMPORT_TEMPLATE_VERSION = "v1";

/* ------------------------------------------------------------ definitions -- */

const externalId: TemplateColumn = {
  canonicalField: "externalId",
  required: true,
  transform: "trim",
  description:
    "Your system's stable id for this record. Re-importing the same id updates that record instead of creating a second one.",
  maxLength: 255,
};

const accountExternalId = (required: boolean): TemplateColumn => ({
  canonicalField: "accountExternalId",
  required,
  transform: "trim",
  description:
    "The externalId of the account this belongs to. It must already exist in this workspace.",
  maxLength: 255,
});

/**
 * Required on accounts and optional on opportunities, matching the canonical
 * schemas: `Account.ownerId` has no default, so a created account without one
 * would not satisfy the contract the product reads it back through.
 */
const ownerId = (required: boolean): TemplateColumn => ({
  canonicalField: "ownerId",
  required,
  transform: "trim",
  description: required
    ? "The user id of the owner. They must be a member of this workspace."
    : "The user id of the owner. They must be a member of this workspace. Leave empty to clear the owner.",
  maxLength: 255,
});

const ACCOUNT_COLUMNS: TemplateColumn[] = [
  externalId,
  {
    canonicalField: "name",
    required: true,
    transform: "trim",
    description: "Account name as it should appear in the product.",
    maxLength: 255,
  },
  ownerId(true),
  {
    canonicalField: "tier",
    required: true,
    transform: "lowercase",
    description: "Account tier.",
    enumValues: ["strategic", "enterprise", "mid_market", "smb"],
  },
  {
    canonicalField: "lifecycleStage",
    required: true,
    transform: "lowercase",
    description: "Where the account sits in its lifecycle.",
    enumValues: [
      "prospect",
      "open_opportunity",
      "customer",
      "renewal",
      "churn_risk",
      "dormant",
    ],
  },
  {
    canonicalField: "industry",
    required: false,
    transform: "trim",
    description: "Free text. Used for segmentation, never for scoring.",
    maxLength: 120,
  },
  {
    canonicalField: "employeeCount",
    required: false,
    transform: "parse_integer",
    description: "Whole number. Digits only, no separators.",
  },
  {
    canonicalField: "openPipelineUsd",
    required: false,
    transform: "normalize_currency_usd",
    description:
      "Open pipeline in US dollars. Digits and at most two decimals; no currency symbol and no thousands separators.",
  },
  {
    canonicalField: "renewalDate",
    required: false,
    transform: "parse_iso_date",
    description: "ISO 8601 date, YYYY-MM-DD.",
  },
  {
    canonicalField: "notes",
    required: false,
    transform: "none",
    description:
      "Free text. Stored for people to read and never used as a scoring signal, whatever it contains.",
    maxLength: 10_000,
  },
];

const CONTACT_COLUMNS: TemplateColumn[] = [
  externalId,
  accountExternalId(true),
  {
    canonicalField: "firstName",
    required: true,
    transform: "trim",
    description: "Given name. Split rather than one full-name column, because the canonical contact stores the two separately and a split guessed at import time gets it wrong for a great many names.",
    maxLength: 120,
  },
  {
    canonicalField: "lastName",
    required: true,
    transform: "trim",
    description: "Family name.",
    maxLength: 120,
  },
  {
    canonicalField: "email",
    required: false,
    transform: "lowercase",
    description: "Work email address.",
    maxLength: 320,
  },
  {
    canonicalField: "title",
    required: false,
    transform: "trim",
    description: "Job title as written in your CRM.",
    maxLength: 200,
  },
  {
    canonicalField: "role",
    required: false,
    transform: "lowercase",
    description: "The part this contact plays in a deal. Defaults to unknown.",
    enumValues: [
      "economic_buyer",
      "champion",
      "technical_evaluator",
      "influencer",
      "blocker",
      "unknown",
    ],
  },
  {
    canonicalField: "isPrimary",
    required: false,
    transform: "parse_boolean",
    description: "true or false. Whether this is the primary contact on the account.",
  },
];

const OPPORTUNITY_COLUMNS: TemplateColumn[] = [
  externalId,
  accountExternalId(true),
  {
    canonicalField: "name",
    required: true,
    transform: "trim",
    description: "Opportunity name.",
    maxLength: 255,
  },
  {
    canonicalField: "stage",
    required: true,
    transform: "lowercase",
    description: "Sales stage.",
    enumValues: [
      "discovery",
      "qualification",
      "proposal",
      "negotiation",
      "closed_won",
      "closed_lost",
    ],
  },
  {
    canonicalField: "amountUsd",
    required: false,
    transform: "normalize_currency_usd",
    description: "Deal amount in US dollars. Digits and at most two decimals.",
  },
  {
    canonicalField: "closeDate",
    required: false,
    transform: "parse_iso_date",
    description: "Expected close date, YYYY-MM-DD.",
  },
  ownerId(false),
  {
    canonicalField: "nextStep",
    required: false,
    transform: "none",
    description: "Free text. Read by people, never scored.",
    maxLength: 2000,
  },
];

const ACTIVITY_COLUMNS: TemplateColumn[] = [
  externalId,
  accountExternalId(true),
  {
    canonicalField: "type",
    required: true,
    transform: "lowercase",
    description: "What happened. Inbound and outbound email are separate values, because direction is what makes an email evidence of engagement.",
    enumValues: [
      "call",
      "email_outbound",
      "email_inbound",
      "meeting",
      "note",
      "task",
      "intent_event",
    ],
  },
  {
    canonicalField: "createdById",
    required: true,
    transform: "trim",
    description: "The user id this activity is attributed to. They must be a member of this workspace.",
    maxLength: 255,
  },
  {
    canonicalField: "occurredAt",
    required: true,
    transform: "parse_iso_date",
    description: "When it happened, YYYY-MM-DD. A date in the future is refused.",
  },
  {
    canonicalField: "contactExternalId",
    required: false,
    transform: "trim",
    description: "The externalId of the contact involved, if any.",
    maxLength: 255,
  },
  {
    canonicalField: "subject",
    required: false,
    transform: "none",
    description: "Free text. Stored and never used as a scoring signal.",
    maxLength: 500,
  },
  {
    canonicalField: "body",
    required: false,
    transform: "none",
    description: "Free text. Stored and never used as a scoring signal, whatever it contains.",
    maxLength: 10_000,
  },
];

const INTENT_SIGNAL_COLUMNS: TemplateColumn[] = [
  externalId,
  accountExternalId(true),
  {
    canonicalField: "signalType",
    required: true,
    transform: "lowercase",
    description: "The kind of intent observed.",
    enumValues: ["content_view", "pricing_page", "competitor_research", "job_posting", "review_site"],
  },
  {
    canonicalField: "observedAt",
    required: true,
    transform: "parse_iso_date",
    description: "When the signal was observed, YYYY-MM-DD.",
  },
  {
    canonicalField: "intensity",
    required: false,
    transform: "parse_decimal",
    description: "0 to 1. How strong the signal is, as a decimal.",
  },
  {
    canonicalField: "topic",
    required: false,
    transform: "trim",
    description: "Short topic label.",
    maxLength: 120,
  },
];

const ACCOUNT_HEALTH_COLUMNS: TemplateColumn[] = [
  externalId,
  accountExternalId(true),
  {
    canonicalField: "measuredAt",
    required: true,
    transform: "parse_iso_date",
    description: "Date the measurement applies to, YYYY-MM-DD.",
  },
  {
    canonicalField: "healthScore",
    required: false,
    transform: "parse_decimal",
    description: "0 to 100. Your own health metric; the product does not recompute it.",
  },
  {
    canonicalField: "supportTicketsOpen",
    required: false,
    transform: "parse_integer",
    description: "Whole number of currently open tickets.",
  },
  {
    canonicalField: "usageTrend",
    required: false,
    transform: "lowercase",
    description: "Direction of product usage over the last period.",
    enumValues: ["growing", "flat", "declining"],
  },
];

/**
 * The combined template carries `objectType` per row and the union of every
 * object's columns. Only `objectType` and `externalId` are universally
 * required: what else a row needs depends on the type it declares, which is
 * checked per row at validation rather than by the header.
 */
const COMBINED_COLUMNS: TemplateColumn[] = (() => {
  const typeColumn: TemplateColumn = {
    canonicalField: "objectType",
    required: true,
    transform: "lowercase",
    description: "Which canonical object this row describes.",
    enumValues: [
      "account",
      "contact",
      "opportunity",
      "activity",
      "intent_signal",
      "account_health",
    ],
  };

  const seen = new Set<string>([typeColumn.canonicalField]);
  const union: TemplateColumn[] = [typeColumn];
  for (const column of [
    ...ACCOUNT_COLUMNS,
    ...CONTACT_COLUMNS,
    ...OPPORTUNITY_COLUMNS,
    ...ACTIVITY_COLUMNS,
    ...INTENT_SIGNAL_COLUMNS,
    ...ACCOUNT_HEALTH_COLUMNS,
  ]) {
    if (seen.has(column.canonicalField)) continue;
    seen.add(column.canonicalField);
    // Required-ness is per object type here, so the union relaxes it. A header
    // cannot know whether a row will declare `account` or `activity`.
    union.push({ ...column, required: column.canonicalField === "externalId" });
  }
  return union;
})();

export const IMPORT_TEMPLATES: Record<ImportTemplateKind, ImportTemplate> = {
  accounts: {
    kind: "accounts",
    objectType: "account",
    label: "Accounts",
    version: IMPORT_TEMPLATE_VERSION,
    columns: ACCOUNT_COLUMNS,
    examples: [
      {
        externalId: "ACME-001",
        name: "Acme Manufacturing",
        ownerId: "user-1",
        tier: "enterprise",
        lifecycleStage: "customer",
        industry: "Industrial equipment",
        employeeCount: "4200",
        openPipelineUsd: "185000.00",
        renewalDate: "2026-11-30",
        notes: "Renewal owner changed in Q3.",
      },
      {
        externalId: "NORTHWIND-014",
        name: "Northwind Logistics",
        ownerId: "user-2",
        tier: "mid_market",
        lifecycleStage: "open_opportunity",
        industry: "Freight",
        employeeCount: "780",
        openPipelineUsd: "42500.50",
        renewalDate: "2027-02-15",
        notes: "",
      },
    ],
  },
  contacts: {
    kind: "contacts",
    objectType: "contact",
    label: "Contacts",
    version: IMPORT_TEMPLATE_VERSION,
    columns: CONTACT_COLUMNS,
    examples: [
      {
        externalId: "CON-9001",
        accountExternalId: "ACME-001",
        firstName: "Dana",
        lastName: "Whitfield",
        email: "dana.whitfield@example.com",
        title: "VP Operations",
        role: "economic_buyer",
        isPrimary: "true",
      },
    ],
  },
  opportunities: {
    kind: "opportunities",
    objectType: "opportunity",
    label: "Opportunities",
    version: IMPORT_TEMPLATE_VERSION,
    columns: OPPORTUNITY_COLUMNS,
    examples: [
      {
        externalId: "OPP-5541",
        accountExternalId: "ACME-001",
        name: "Acme line expansion",
        stage: "negotiation",
        amountUsd: "185000.00",
        closeDate: "2026-09-30",
        ownerId: "user-1",
        nextStep: "Security review scheduled.",
      },
    ],
  },
  activities: {
    kind: "activities",
    objectType: "activity",
    label: "Activities",
    version: IMPORT_TEMPLATE_VERSION,
    columns: ACTIVITY_COLUMNS,
    examples: [
      {
        externalId: "ACT-77120",
        accountExternalId: "ACME-001",
        type: "meeting",
        occurredAt: "2026-07-14",
        createdById: "user-1",
        contactExternalId: "CON-9001",
        subject: "Rollout planning",
        body: "Walked through the rollout plan.",
      },
    ],
  },
  intent_signals: {
    kind: "intent_signals",
    objectType: "intent_signal",
    label: "Intent signals",
    version: IMPORT_TEMPLATE_VERSION,
    columns: INTENT_SIGNAL_COLUMNS,
    examples: [
      {
        externalId: "SIG-3310",
        accountExternalId: "ACME-001",
        signalType: "pricing_page",
        observedAt: "2026-07-22",
        intensity: "0.8",
        topic: "Enterprise tier",
      },
    ],
  },
  account_health: {
    kind: "account_health",
    objectType: "account_health",
    label: "Account health",
    version: IMPORT_TEMPLATE_VERSION,
    columns: ACCOUNT_HEALTH_COLUMNS,
    examples: [
      {
        externalId: "HLT-2026-07-ACME-001",
        accountExternalId: "ACME-001",
        measuredAt: "2026-07-31",
        healthScore: "72.5",
        supportTicketsOpen: "3",
        usageTrend: "flat",
      },
    ],
  },
  combined_crm: {
    kind: "combined_crm",
    objectType: null,
    label: "Combined CRM template",
    version: IMPORT_TEMPLATE_VERSION,
    columns: COMBINED_COLUMNS,
    examples: [
      {
        objectType: "account",
        externalId: "ACME-001",
        name: "Acme Manufacturing",
        ownerId: "user-1",
        openPipelineUsd: "185000.00",
        tier: "enterprise",
        lifecycleStage: "customer",
      },
      {
        objectType: "contact",
        externalId: "CON-9001",
        accountExternalId: "ACME-001",
        firstName: "Dana",
        lastName: "Whitfield",
        email: "dana.whitfield@example.com",
        role: "economic_buyer",
      },
    ],
  },
};

export const IMPORT_TEMPLATE_KINDS: readonly ImportTemplateKind[] = [
  "accounts",
  "contacts",
  "opportunities",
  "activities",
  "intent_signals",
  "account_health",
  "combined_crm",
];

/* -------------------------------------------------------------- rendering -- */

/** Section 21.1's leading set, duplicated here to keep this package dependency free. */
const FORMULA_START = /^[\t\r ]*[=+\-@]/;

/**
 * Quote per RFC 4180 and neutralize formula starts.
 *
 * Order matters: neutralize first, then quote. Quoting alone does not stop a
 * spreadsheet evaluating the cell — the quotes are stripped at parse — so the
 * apostrophe has to be inside them.
 *
 * Exported so the rule can be tested against a hostile value directly. Every
 * shipped example is benign, and a guard exercised only by benign input is a
 * guard nobody has checked.
 */
export function renderTemplateCell(value: string): string {
  const flattened = value.replace(/\r\n?|\n/g, " ");
  const safe = FORMULA_START.test(flattened) ? `'${flattened}` : flattened;
  return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Header row plus example rows, CRLF-terminated as RFC 4180 specifies. */
export function renderTemplateCsv(kind: ImportTemplateKind): string {
  const template = IMPORT_TEMPLATES[kind];
  const headers = template.columns.map((c) => c.canonicalField);
  const lines = [headers.map(renderTemplateCell).join(",")];
  for (const example of template.examples) {
    lines.push(headers.map((h) => renderTemplateCell(example[h] ?? "")).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Filename for the download. Carries the version so a stale template is
 * identifiable from the filename alone when somebody attaches it to a ticket.
 */
export function templateFilename(kind: ImportTemplateKind): string {
  return `${kind.replace(/_/g, "-")}-template-${IMPORT_TEMPLATES[kind].version}.csv`;
}

/** Canonical fields the template marks required, in header order. */
export function requiredColumns(kind: ImportTemplateKind): string[] {
  return IMPORT_TEMPLATES[kind].columns.filter((c) => c.required).map((c) => c.canonicalField);
}

/* ---------------------------------------------------------- header check -- */

export type HeaderProblemCode =
  | "column_limit_exceeded"
  | "duplicate_header"
  | "missing_required_column"
  | "unmapped_column";

export interface HeaderProblem {
  code: HeaderProblemCode;
  /** `unmapped_column` is informational: extra columns are dropped, not fatal. */
  blocking: boolean;
  /** The column names the problem is about, so a caller can phrase its own message. */
  columns: string[];
}

/**
 * Check a header row against a template.
 *
 * Lives here rather than in the browser because the server has to reach the
 * same verdict on the bytes it receives, and two implementations of "which
 * columns does this template require" is exactly how a file passes one and
 * fails the other.
 *
 * An unrecognised column is reported but not blocking: a column with no mapping
 * decision is dropped rather than guessed at, and saying so up front is what
 * stops somebody assuming their custom field was imported.
 */
export function checkTemplateHeaders(
  headers: readonly string[],
  kind: ImportTemplateKind,
  maxColumns: number,
): HeaderProblem[] {
  const template = IMPORT_TEMPLATES[kind];
  const problems: HeaderProblem[] = [];

  if (headers.length > maxColumns) {
    problems.push({ code: "column_limit_exceeded", blocking: true, columns: [] });
  }

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const header of headers) {
    if (seen.has(header) && !duplicates.includes(header)) duplicates.push(header);
    seen.add(header);
  }
  if (duplicates.length > 0) {
    problems.push({ code: "duplicate_header", blocking: true, columns: duplicates });
  }

  const missing = template.columns
    .filter((c) => c.required && !seen.has(c.canonicalField))
    .map((c) => c.canonicalField);
  if (missing.length > 0) {
    problems.push({ code: "missing_required_column", blocking: true, columns: missing });
  }

  const known = new Set(template.columns.map((c) => c.canonicalField));
  const unmapped = headers.filter((h) => h !== "" && !known.has(h));
  if (unmapped.length > 0) {
    problems.push({ code: "unmapped_column", blocking: false, columns: unmapped });
  }

  return problems;
}
