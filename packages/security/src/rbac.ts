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
  | "edit_scoring_config";

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
  ]),
  admin: new Set([
    "view_own_recommendations",
    "approve_customer_action",
    "view_team_coverage",
    "view_audit_evidence",
    "edit_scoring_config",
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
