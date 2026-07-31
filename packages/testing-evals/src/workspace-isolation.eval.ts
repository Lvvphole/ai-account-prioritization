import { describe, it, expect } from "vitest";
import {
  canInWorkspace,
  membershipIn,
  assertSameWorkspace,
  scopeToWorkspace,
  WorkspaceBoundaryError,
  can,
  capabilitiesFor,
  type Actor,
  type Membership,
} from "@repo/security";

/**
 * Workspace isolation evals (Epic 0 exit gate).
 *
 * Before the workspace boundary, holding `manager` or `admin` anywhere meant
 * holding it everywhere: the capability check took a role and no tenant. These
 * assert the in-process authority now fails closed across tenants, mirroring
 * what the RLS policies in migration 0008 enforce in the database.
 */

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

const adminInA: Actor = { kind: "user", userId: USER, workspaceId: WS_A, role: "admin" };
const managerInA: Actor = { kind: "user", userId: USER, workspaceId: WS_A, role: "manager" };
const repInA: Actor = { kind: "user", userId: USER, workspaceId: WS_A, role: "rep" };
const worker: Actor = { kind: "service", serviceId: "ingestion-worker", workspaceId: WS_A };

describe("workspace isolation", () => {
  it("grants a capability inside the actor's own workspace", () => {
    expect(canInWorkspace(adminInA, WS_A, "manage_data_sources")).toBe(true);
    expect(canInWorkspace(managerInA, WS_A, "view_data_sources")).toBe(true);
  });

  it("denies the same capability in another workspace", () => {
    // The defect this boundary exists to prevent: an admin of one tenant
    // operating on another.
    expect(canInWorkspace(adminInA, WS_B, "manage_data_sources")).toBe(false);
    expect(canInWorkspace(adminInA, WS_B, "commit_manual_import")).toBe(false);
    expect(canInWorkspace(adminInA, WS_B, "view_audit_evidence")).toBe(false);
    expect(canInWorkspace(managerInA, WS_B, "view_data_sources")).toBe(false);
  });

  it("denies an empty or unknown workspace id", () => {
    expect(canInWorkspace(adminInA, "", "manage_data_sources")).toBe(false);
    expect(canInWorkspace(adminInA, "not-a-workspace", "view_data_sources")).toBe(false);
  });

  it("keeps reps out of the ingestion control plane entirely", () => {
    for (const capability of [
      "view_data_sources",
      "view_ingestion_batches",
      "create_manual_import",
      "commit_manual_import",
      "review_quarantine",
      "manage_event_triggers",
      "rollback_ingestion_commit",
    ] as const) {
      expect(canInWorkspace(repInA, WS_A, capability)).toBe(false);
    }
  });

  it("gives managers read-only ingestion visibility", () => {
    expect(canInWorkspace(managerInA, WS_A, "view_ingestion_batches")).toBe(true);
    expect(canInWorkspace(managerInA, WS_A, "view_field_mappings")).toBe(true);

    // A manager cannot change anything in the ingestion plane.
    for (const capability of [
      "manage_data_sources",
      "manage_source_credentials",
      "create_manual_import",
      "commit_manual_import",
      "review_quarantine",
      "approve_ingestion_exception",
      "manage_field_mappings",
      "manage_event_triggers",
      "replay_ingestion_event",
      "rollback_ingestion_commit",
    ] as const) {
      expect(canInWorkspace(managerInA, WS_A, capability)).toBe(false);
    }
  });

  it("confines the service actor to processing, never authorization", () => {
    expect(canInWorkspace(worker, WS_A, "view_ingestion_batches")).toBe(true);

    // A compromised worker must not be able to approve or commit its own work.
    for (const capability of [
      "commit_manual_import",
      "approve_ingestion_exception",
      "review_quarantine",
      "manage_data_sources",
      "manage_event_triggers",
      "rollback_ingestion_commit",
      "edit_scoring_config",
      "approve_customer_action",
    ] as const) {
      expect(canInWorkspace(worker, WS_A, capability)).toBe(false);
    }

    // And it is bound to the workspace it was granted.
    expect(canInWorkspace(worker, WS_B, "view_ingestion_batches")).toBe(false);
  });

  it("never grants a capability to read a source secret", () => {
    // manage_source_credentials permits rotation and revocation only. The
    // matrix must contain no capability that returns a secret to any caller,
    // for any role, so a secret cannot be read even by an admin.
    expect(canInWorkspace(adminInA, WS_A, "manage_source_credentials")).toBe(true);

    for (const role of ["rep", "manager", "admin"] as const) {
      const granted = capabilitiesFor(role).map(String);
      expect(granted.filter((c) => /read.*secret|secret.*read|view_source_credential/.test(c)))
        .toEqual([]);
    }
  });

  it("resolves membership only for the matching workspace and user", () => {
    const memberships: Membership[] = [
      { workspaceId: WS_A, userId: USER, role: "admin" },
      { workspaceId: WS_B, userId: "other-user", role: "admin" },
    ];
    expect(membershipIn(memberships, WS_A, USER)?.role).toBe("admin");
    expect(membershipIn(memberships, WS_B, USER)).toBeNull();
  });

  it("rejects a cross-workspace parent reference", () => {
    expect(() => assertSameWorkspace(WS_A, WS_A, WS_A)).not.toThrow();
    expect(() => assertSameWorkspace(WS_A, WS_B)).toThrow(WorkspaceBoundaryError);
    expect(() => assertSameWorkspace(WS_A, null)).toThrow(WorkspaceBoundaryError);

    try {
      assertSameWorkspace(WS_A, WS_B);
    } catch (error) {
      const boundary = error as WorkspaceBoundaryError;
      expect(boundary.code).toBe("INGEST_WORKSPACE_MISMATCH");
      // The error must not carry the offending record payload.
      expect(boundary.message).not.toContain(WS_B);
    }
  });

  it("filters query results down to one workspace", () => {
    const rows = [
      { workspaceId: WS_A, id: "a1" },
      { workspaceId: WS_B, id: "b1" },
      { workspaceId: WS_A, id: "a2" },
    ];
    expect(scopeToWorkspace(rows, WS_A).map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(scopeToWorkspace(rows, WS_B).map((r) => r.id)).toEqual(["b1"]);
  });

  it("leaves the pre-existing role matrix unchanged", () => {
    // Epic 0 adds tenant scope. It must not alter what a role could already do.
    expect(can("rep", "view_own_recommendations")).toBe(true);
    expect(can("rep", "view_team_coverage")).toBe(false);
    expect(can("manager", "view_team_coverage")).toBe(true);
    expect(can("manager", "edit_scoring_config")).toBe(false);
    expect(can("admin", "edit_scoring_config")).toBe(true);
  });
});
