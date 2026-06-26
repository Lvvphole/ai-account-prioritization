import { describe, it, expect } from "vitest";
import {
  can,
  requireCapability,
  capabilitiesFor,
  requiresApproval,
  isApprovalSatisfied,
  redactPII,
  redactProperties,
} from "./index";

describe("rbac", () => {
  it("grants role-appropriate capabilities and denies others (fail-closed)", () => {
    expect(can("rep", "view_own_recommendations")).toBe(true);
    expect(can("rep", "view_audit_evidence")).toBe(false);
    expect(can("rep", "edit_scoring_config")).toBe(false);

    expect(can("manager", "view_audit_evidence")).toBe(true);
    expect(can("manager", "edit_scoring_config")).toBe(false);

    expect(can("admin", "edit_scoring_config")).toBe(true);
  });

  it("admin capabilities are a superset of manager's, manager's of rep's", () => {
    const rep = new Set(capabilitiesFor("rep"));
    const mgr = new Set(capabilitiesFor("manager"));
    const adm = new Set(capabilitiesFor("admin"));
    for (const c of rep) expect(mgr.has(c)).toBe(true);
    for (const c of mgr) expect(adm.has(c)).toBe(true);
  });

  it("requireCapability throws when denied", () => {
    expect(() => requireCapability("rep", "edit_scoring_config")).toThrow(/Forbidden/);
    expect(() => requireCapability("admin", "edit_scoring_config")).not.toThrow();
  });
});

describe("approval policy", () => {
  const internal = { customerFacing: false, crmWriteBack: false };
  const external = { customerFacing: true, crmWriteBack: false };

  it("only customer-facing / CRM-writeback actions require approval", () => {
    expect(requiresApproval(internal)).toBe(false);
    expect(requiresApproval(external)).toBe(true);
    expect(requiresApproval({ customerFacing: false, crmWriteBack: true })).toBe(true);
  });

  it("internal actions are always allowed", () => {
    expect(
      isApprovalSatisfied(internal, {
        requireHumanApproval: true,
        approvalStatus: "not_required",
      }),
    ).toBe(true);
  });

  it("external actions are blocked unless explicitly approved (fail-closed)", () => {
    expect(
      isApprovalSatisfied(external, {
        requireHumanApproval: true,
        approvalStatus: "pending_approval",
      }),
    ).toBe(false);
    expect(
      isApprovalSatisfied(external, {
        requireHumanApproval: true,
        approvalStatus: "rejected",
      }),
    ).toBe(false);
    expect(
      isApprovalSatisfied(external, {
        requireHumanApproval: true,
        approvalStatus: "approved",
      }),
    ).toBe(true);
  });

  it("the global switch can only loosen in non-prod, never tightens approved", () => {
    expect(
      isApprovalSatisfied(external, {
        requireHumanApproval: false,
        approvalStatus: "pending_approval",
      }),
    ).toBe(true);
  });
});

describe("pii redaction", () => {
  it("redacts emails, phones, and SSNs", () => {
    expect(redactPII("ping dana.ito@helios-mfg.com please")).toContain("[redacted:email]");
    expect(redactPII("call +1 (415) 555-0199 today")).toContain("[redacted:phone]");
    expect(redactPII("ssn 123-45-6789")).toContain("[redacted:ssn]");
  });

  it("leaves non-PII values (scores, reason codes) untouched", () => {
    expect(redactPII("score 87 rank 1 strategic_tier_account")).toBe(
      "score 87 rank 1 strategic_tier_account",
    );
  });

  it("recursively redacts string values while preserving structure & types", () => {
    const out = redactProperties({
      rank: 1,
      score: 87,
      note: "reach lee.okafor@northwind.example",
      gates: ["approval_required", "ok"],
      nested: { phone: "415-555-0199" },
    });
    expect(out.rank).toBe(1);
    expect(out.score).toBe(87);
    expect(out.note).toContain("[redacted:email]");
    expect(out.gates).toEqual(["approval_required", "ok"]);
    expect((out.nested as { phone: string }).phone).toContain("[redacted:phone]");
  });

  it("redacts PII used as a property key, not just the value", () => {
    const out = redactProperties({ "dana.ito@helios-mfg.com": "vip" });
    expect(Object.keys(out)).toEqual(["[redacted:email]"]);
    expect(out["[redacted:email]"]).toBe("vip");
  });
});
