import type { AppRole, Capability } from "./rbac";
import { can } from "./rbac";

/**
 * Workspace-scoped authorization.
 *
 * Before this boundary existed, a manager or admin role was global: holding it
 * anywhere meant holding it everywhere. Tenant scope now comes from membership,
 * so a capability check must answer "in which workspace" as well as "what".
 *
 * Pure and dependency free, matching `rbac.ts`. The database enforces the same
 * predicates through RLS; this is the in-process authority.
 */

/** A user's membership in one workspace. */
export interface Membership {
  workspaceId: string;
  userId: string;
  role: AppRole;
}

/**
 * The resolved actor for a request.
 *
 * A service actor is modelled separately rather than as a fourth `AppRole`. It
 * has no browser login and no membership row, so widening the role enum (and
 * the `app_role` database enum with it) would let a service identity be granted
 * through the normal user path. Instead it is granted one workspace explicitly
 * per call and holds only the capabilities listed below.
 */
export type Actor =
  | { kind: "user"; userId: string; workspaceId: string; role: AppRole }
  | { kind: "service"; serviceId: string; workspaceId: string };

/**
 * What a service actor may do. It processes accepted work and writes audit
 * evidence. It cannot review, approve, commit, or manage configuration, so a
 * compromised worker cannot authorize its own changes.
 */
const SERVICE_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "view_data_sources",
  "view_ingestion_batches",
  "view_field_mappings",
  "view_event_triggers",
  "view_audit_evidence",
]);

/**
 * True when `actor` holds `capability` **in `workspaceId`**. Fails closed on any
 * workspace mismatch, so a capability held in one tenant never leaks into
 * another.
 */
export function canInWorkspace(
  actor: Actor,
  workspaceId: string,
  capability: Capability,
): boolean {
  if (!workspaceId || actor.workspaceId !== workspaceId) return false;
  if (actor.kind === "service") return SERVICE_CAPABILITIES.has(capability);
  return can(actor.role, capability);
}

/** Resolve a user's membership in one workspace, or null when not a member. */
export function membershipIn(
  memberships: readonly Membership[],
  workspaceId: string,
  userId: string,
): Membership | null {
  return (
    memberships.find((m) => m.workspaceId === workspaceId && m.userId === userId) ??
    null
  );
}

/**
 * Guard for parent/child references. Every ingested record names a parent, and
 * a record pointing at a parent in another tenant is a hard block rather than a
 * validation warning.
 */
export function assertSameWorkspace(
  expectedWorkspaceId: string,
  ...actualWorkspaceIds: (string | null | undefined)[]
): void {
  for (const actual of actualWorkspaceIds) {
    if (actual !== expectedWorkspaceId) {
      throw new WorkspaceBoundaryError(expectedWorkspaceId, actual ?? null);
    }
  }
}

/** Thrown on a cross-workspace reference. Carries no record payload. */
export class WorkspaceBoundaryError extends Error {
  readonly code = "INGEST_WORKSPACE_MISMATCH";
  constructor(
    readonly expected: string,
    readonly actual: string | null,
  ) {
    super("Cross-workspace reference rejected");
    this.name = "WorkspaceBoundaryError";
  }
}

/**
 * Narrow a collection to one workspace. Used wherever a query result could
 * otherwise span tenants, as defence in depth behind RLS.
 */
export function scopeToWorkspace<T extends { workspaceId: string }>(
  rows: readonly T[],
  workspaceId: string,
): T[] {
  return rows.filter((r) => r.workspaceId === workspaceId);
}
