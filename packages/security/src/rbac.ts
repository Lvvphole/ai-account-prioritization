/**
 * Role-Based Access Control (RBAC).
 *
 * A deterministic capability matrix for the three application roles. It mirrors
 * what the database enforces in Supabase Row Level Security (supabase/migrations
 * 0005_rls_policies.sql) and the PRD personas, giving the web/API layers a single
 * in-process authority for "may this role do X?" decisions. Pure and dependency
 * free — no I/O, no async, no Supabase import.
 */
export type AppRole = "rep" | "manager" | "admin";

/** The set of capabilities the product gates on. */
export type Capability =
  /** See one's own ranked recommendations / daily plan. */
  | "view_own_recommendations"
  /** Approve a customer-facing send or CRM write-back. */
  | "approve_customer_action"
  /** See team coverage gaps and held/blocked recommendations (manager view). */
  | "view_team_coverage"
  /** Read the immutable audit trail. */
  | "view_audit_evidence"
  /** Inspect or change the deterministic scoring configuration. */
  | "edit_scoring_config"
  /* --- Ingestion control plane (secure-ingestion spec, section 5.2) --- */
  /** See connected sources and their health. */
  | "view_data_sources"
  /** Connect, pause, resume or revoke a source. */
  | "manage_data_sources"
  /**
   * Rotate or revoke source credentials. Note this never grants READING a
   * secret: no role may read a source secret after creation.
   */
  | "manage_source_credentials"
  /** See ingestion batches and their summaries. */
  | "view_ingestion_batches"
  /** Start a manual CSV import. */
  | "create_manual_import"
  /** Commit a reviewed import to operational tables. */
  | "commit_manual_import"
  /** Open and resolve quarantine findings. */
  | "review_quarantine"
  /** Approve a documented warning. Hard blocks are never approvable. */
  | "approve_ingestion_exception"
  /** See field mappings. */
  | "view_field_mappings"
  /** Create or publish a mapping version. */
  | "manage_field_mappings"
  /** See event triggers and their executions. */
  | "view_event_triggers"
  /** Create, publish, pause or resume a trigger. */
  | "manage_event_triggers"
  /** Replay a failed or dead-lettered ingestion event. */
  | "replay_ingestion_event"
  /** Issue a compensating rollback of a committed import. */
  | "rollback_ingestion_commit";

/**
 * Capability grants per role. Higher roles are supersets of lower ones, matching
 * the RLS predicates (`owner = auth.uid() OR is_manager_or_admin()`, audit reads
 * gated to manager/admin, scoring config to admin).
 */
const ROLE_CAPABILITIES: Record<AppRole, ReadonlySet<Capability>> = {
  rep: new Set(["view_own_recommendations", "approve_customer_action"]),
  manager: new Set([
    "view_own_recommendations",
    "approve_customer_action",
    "view_team_coverage",
    "view_audit_evidence",
    // Read-only visibility into ingestion. A manager sees source health and
    // batch summaries but cannot connect a source, change a mapping, commit an
    // import, resolve a finding, or edit a trigger.
    "view_data_sources",
    "view_ingestion_batches",
    "view_field_mappings",
    "view_event_triggers",
  ]),
  admin: new Set([
    "view_own_recommendations",
    "approve_customer_action",
    "view_team_coverage",
    "view_audit_evidence",
    "edit_scoring_config",
    "view_data_sources",
    "manage_data_sources",
    "manage_source_credentials",
    "view_ingestion_batches",
    "create_manual_import",
    "commit_manual_import",
    "review_quarantine",
    "approve_ingestion_exception",
    "view_field_mappings",
    "manage_field_mappings",
    "view_event_triggers",
    "manage_event_triggers",
    "replay_ingestion_event",
    "rollback_ingestion_commit",
  ]),
};

/** True when `role` is granted `capability`. Unknown roles are denied (fail-closed). */
export function can(role: AppRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.has(capability) ?? false;
}

/** Assert a capability; throws a stable error when denied. */
export function requireCapability(role: AppRole, capability: Capability): void {
  if (!can(role, capability)) {
    throw new Error(`Forbidden: role '${role}' lacks capability '${capability}'.`);
  }
}

/** All capabilities granted to a role (read-only copy). */
export function capabilitiesFor(role: AppRole): Capability[] {
  return [...(ROLE_CAPABILITIES[role] ?? new Set<Capability>())];
}
