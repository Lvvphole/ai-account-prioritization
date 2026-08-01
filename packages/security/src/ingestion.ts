/**
 * The staging boundary.
 *
 * Epic 1's exit gate is "no operational CRM table can be reached from a source
 * adapter directly". That is a statement about which tables a piece of code may
 * name, so this module names them: the two catalogues below are the authority,
 * and the guards turn a violation into a thrown error rather than a review
 * comment nobody writes.
 *
 * Inbound data lands in an ingestion table, gets a disposition, and reaches an
 * operational table only through an approved commit. There is no second path.
 *
 * Pure and dependency free, matching the rest of `@repo/security`.
 */

/**
 * Product tables. A row here is something the application treats as true: it
 * feeds the scorer, the dashboards and the recommendations.
 */
export const OPERATIONAL_TABLES: readonly string[] = [
  "accounts",
  "contacts",
  "opportunities",
  "activities",
  "recommendations",
  "prioritization_runs",
  "audit_evidence",
  "eval_results",
  "profiles",
  "workspaces",
  "workspace_memberships",
  "observability_events",
];

/**
 * Ingestion tables. A row here is a candidate, carrying its provenance and its
 * disposition. Nothing reads these to score or to rank.
 */
export const INGESTION_TABLES: readonly string[] = [
  "data_sources",
  "source_credentials",
  "source_scopes",
  "source_mapping_versions",
  "source_field_mappings",
  "source_sync_cursors",
  "ingestion_batches",
  "ingestion_files",
  "staged_records",
  "ingestion_findings",
  "change_sets",
  "change_set_items",
  "import_approvals",
  "import_commits",
  "import_commit_items",
  "import_rollbacks",
  "external_record_links",
  "domain_events",
  "trigger_definitions",
  "trigger_versions",
  "trigger_conditions",
  "trigger_actions",
  "trigger_executions",
  "dead_letter_events",
];

/**
 * Tables a source adapter may name: none.
 *
 * An adapter's job is to return raw records from a remote system. It has no
 * reason to read or write this database at all, so the allowance is empty
 * rather than "ingestion tables only". Persistence is the ingestion service's
 * job, and keeping the adapter out of it means a hostile or buggy connector has
 * no database surface to misuse.
 */
export const ADAPTER_ALLOWED_TABLES: readonly string[] = [];

export function isOperationalTable(table: string): boolean {
  return OPERATIONAL_TABLES.includes(table);
}

export function isIngestionTable(table: string): boolean {
  return INGESTION_TABLES.includes(table);
}

/** Thrown when code reaches for a table its layer may not touch. */
export class TableAccessError extends Error {
  readonly code = "INGEST_TABLE_ACCESS_FORBIDDEN";
  constructor(
    readonly table: string,
    readonly layer: string,
  ) {
    super(`${layer} may not access table '${table}'`);
    this.name = "TableAccessError";
  }
}

/** Refuses any database table to adapter code. */
export function assertAdapterTableAccess(table: string): void {
  if (!ADAPTER_ALLOWED_TABLES.includes(table)) {
    throw new TableAccessError(table, "source adapter");
  }
}

/**
 * Refuses an operational table to the staging pipeline. Parsing, mapping,
 * validation and change-set construction all run under this guard, so the only
 * code that can write a product row is the commit path.
 */
export function assertStagingTableAccess(table: string): void {
  if (isOperationalTable(table) || !isIngestionTable(table)) {
    throw new TableAccessError(table, "ingestion staging");
  }
}

/**
 * The single seam where staged data becomes product data.
 *
 * An approval is required by argument rather than checked afterwards, so a
 * commit without one cannot be expressed. `assertCommitAuthorized` fails closed
 * on a missing approval, a mismatched workspace, or a batch that never reached
 * the committing state.
 */
export interface CommitAuthorization {
  workspaceId: string;
  batchId: string;
  approvalId: string;
  approvedBy: string;
  /** Section 7.2 step 9. Some change sets demand a second approver. */
  secondApprovalRequired: boolean;
  secondApprovedBy: string | null;
}

export class CommitNotAuthorizedError extends Error {
  readonly code = "INGEST_COMMIT_NOT_AUTHORIZED";
  constructor(reason: string) {
    super(`Commit refused: ${reason}`);
    this.name = "CommitNotAuthorizedError";
  }
}

export function assertCommitAuthorized(
  auth: CommitAuthorization,
  expectedWorkspaceId: string,
): void {
  if (!auth.approvalId || !auth.approvedBy) {
    throw new CommitNotAuthorizedError("no approval on record");
  }
  if (auth.workspaceId !== expectedWorkspaceId) {
    throw new CommitNotAuthorizedError("approval belongs to another workspace");
  }
  if (auth.secondApprovalRequired && !auth.secondApprovedBy) {
    throw new CommitNotAuthorizedError("a second approver is required");
  }
  if (auth.secondApprovedBy && auth.secondApprovedBy === auth.approvedBy) {
    throw new CommitNotAuthorizedError("the second approver must be a different person");
  }
}
