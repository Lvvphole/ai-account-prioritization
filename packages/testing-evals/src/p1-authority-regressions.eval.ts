import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { prioritizeAccounts } from "agent-runtime";

describe("P1 authority regressions", () => {
  it("emits direct evidence for every generated account reason", () => {
    const now = "2026-08-03T09:00:00.000Z";
    const baseAccount = {
      ownerId: "rep_1",
      openPipelineUsd: 0,
      intentSignals: [] as string[],
      dataQualityFlags: [] as string[],
      createdAt: now,
      updatedAt: now,
    };

    const recommendations = prioritizeAccounts({
      runId: "run_reason_evidence",
      createdAt: now,
      sourceCapabilitiesByAccountId: {
        acc_strategic: {
          accounts: true,
          contacts: false,
          opportunities: false,
          activities: false,
          accountTier: true,
          lifecycleStage: false,
          emailEvents: false,
          renewals: false,
          healthScore: false,
          intentSignals: false,
        },
        acc_renewal: {
          accounts: true,
          contacts: false,
          opportunities: false,
          activities: false,
          accountTier: false,
          lifecycleStage: true,
          emailEvents: false,
          renewals: false,
          healthScore: false,
          intentSignals: false,
        },
        acc_buyer: {
          accounts: true,
          contacts: true,
          opportunities: false,
          activities: false,
          accountTier: true,
          lifecycleStage: false,
          emailEvents: false,
          renewals: false,
          healthScore: false,
          intentSignals: false,
        },
        acc_quality: {
          accounts: true,
          contacts: false,
          opportunities: false,
          activities: false,
          accountTier: true,
          lifecycleStage: false,
          emailEvents: false,
          renewals: false,
          healthScore: false,
          intentSignals: false,
        },
      },
      contexts: [
        {
          account: {
            ...baseAccount,
            id: "acc_strategic",
            name: "Strategic Account",
            tier: "strategic" as const,
            lifecycleStage: "prospect" as const,
          },
          contacts: [],
          opportunities: [],
          activities: [],
        },
        {
          account: {
            ...baseAccount,
            id: "acc_renewal",
            name: "Renewal Account",
            tier: "smb" as const,
            lifecycleStage: "renewal" as const,
          },
          contacts: [],
          opportunities: [],
          activities: [],
        },
        {
          account: {
            ...baseAccount,
            id: "acc_buyer",
            name: "Buyer Account",
            tier: "smb" as const,
            lifecycleStage: "prospect" as const,
          },
          contacts: [
            {
              id: "contact_buyer",
              accountId: "acc_buyer",
              firstName: "Avery",
              lastName: "Buyer",
              role: "economic_buyer" as const,
              isPrimary: true,
              lastEngagedAt: now,
              createdAt: now,
              updatedAt: now,
            },
          ],
          opportunities: [],
          activities: [],
        },
        {
          account: {
            ...baseAccount,
            id: "acc_quality",
            name: "Quality Account",
            tier: "smb" as const,
            lifecycleStage: "prospect" as const,
            dataQualityFlags: ["missing_industry"],
          },
          contacts: [],
          opportunities: [],
          activities: [],
        },
      ],
    });

    const byAccount = new Map(recommendations.map((rec) => [rec.accountId, rec]));

    const strategic = byAccount.get("acc_strategic");
    expect(strategic?.reasonCodes).toContain("strategic_tier_account");
    expect(
      strategic?.sourceSignals.some((signal) => signal.description === "Account tier is strategic."),
    ).toBe(true);

    const renewal = byAccount.get("acc_renewal");
    expect(renewal?.reasonCodes).toContain("renewal_approaching");
    expect(
      renewal?.sourceSignals.some((signal) => signal.description === "Account lifecycle stage is renewal."),
    ).toBe(true);

    const buyer = byAccount.get("acc_buyer");
    expect(buyer?.reasonCodes).toContain("new_executive_buyer");
    expect(
      buyer?.sourceSignals.some(
        (signal) =>
          signal.kind === "contact" &&
          signal.refId === "contact_buyer" &&
          signal.description === "Economic buyer Avery Buyer has recorded engagement.",
      ),
    ).toBe(true);

    const quality = byAccount.get("acc_quality");
    expect(quality?.reasonCodes).toContain("data_quality_blocked");
    expect(
      quality?.sourceSignals.some(
        (signal) => signal.description === "Account data-quality flag: missing_industry.",
      ),
    ).toBe(true);
  });

  it("preserves connector capability provenance on the recommendation", () => {
    const now = "2026-08-03T09:00:00.000Z";
    const snapshot = {
      accounts: true as const,
      contacts: false,
      opportunities: false,
      activities: false,
      accountTier: true,
      lifecycleStage: false,
      emailEvents: false,
      renewals: false,
      healthScore: false,
      intentSignals: false,
      source: "salesforce",
      mappingVersion: "salesforce-account-v7",
      observedAt: "2026-08-03T08:59:30.000Z",
    };

    const recommendation = prioritizeAccounts({
      runId: "run_capability_provenance",
      createdAt: now,
      sourceCapabilitiesByAccountId: { acc_provenance: snapshot },
      sourceCapabilitySnapshotsByAccountId: { acc_provenance: snapshot },
      contexts: [
        {
          account: {
            id: "acc_provenance",
            name: "Provenance Account",
            ownerId: "rep_1",
            tier: "strategic",
            lifecycleStage: "prospect",
            openPipelineUsd: 0,
            intentSignals: [],
            dataQualityFlags: [],
            createdAt: now,
            updatedAt: now,
          },
          contacts: [],
          opportunities: [],
          activities: [],
        },
      ],
    })[0];

    expect(recommendation?.sourceCapabilitySnapshot).toEqual(snapshot);
  });

  it("enforces pending-only outbox inserts at the database authority boundary", async () => {
    const migration = await readFile(
      new URL(
        "../../../supabase/migrations/0017_event_outbox_and_notification_jobs.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("before insert on public.integration_event_outbox");
    expect(migration).toContain(
      "integration event outbox insert must start in pending publication state",
    );

    const insertGrant = migration.match(
      /grant insert \([\s\S]*?\) on table public\.integration_event_outbox to service_role;/,
    )?.[0];

    expect(insertGrant).toBeDefined();
    expect(insertGrant).not.toMatch(/\bstatus\b/);
    expect(insertGrant).not.toMatch(/\bpublication_attempt_count\b/);
    expect(insertGrant).not.toMatch(/\bworkflow_run_id\b/);
    expect(insertGrant).not.toMatch(/\bpublished_at\b/);
  });
});
