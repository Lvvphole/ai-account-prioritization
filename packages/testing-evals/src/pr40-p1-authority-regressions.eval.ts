import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { prioritizeAccounts } from "agent-runtime";

const NOW = "2026-08-03T09:00:00.000Z";

const unavailableCapabilities = {
  accounts: true as const,
  contacts: false,
  opportunities: false,
  activities: false,
  accountTier: false,
  lifecycleStage: false,
  emailEvents: false,
  renewals: false,
  healthScore: false,
  intentSignals: false,
};

function baseAccount(id: string) {
  return {
    id,
    name: `Account ${id}`,
    ownerId: "rep_1",
    tier: "smb" as const,
    lifecycleStage: "prospect" as const,
    openPipelineUsd: 0,
    intentSignals: [] as string[],
    dataQualityFlags: [] as string[],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("PR #40 P1 authority regressions", () => {
  it.each([
    {
      name: "strategic tier",
      accountId: "acc_tier",
      account: { ...baseAccount("acc_tier"), tier: "strategic" as const },
      contacts: [],
      capabilities: { ...unavailableCapabilities, accountTier: true },
      reason: "strategic_tier_account",
      evidenceKind: "account",
      evidenceText: "Account tier is strategic.",
    },
    {
      name: "renewal lifecycle",
      accountId: "acc_renewal",
      account: { ...baseAccount("acc_renewal"), lifecycleStage: "renewal" as const },
      contacts: [],
      capabilities: { ...unavailableCapabilities, lifecycleStage: true },
      reason: "renewal_approaching",
      evidenceKind: "account",
      evidenceText: "Account lifecycle stage is renewal.",
    },
    {
      name: "engaged economic buyer",
      accountId: "acc_buyer",
      account: baseAccount("acc_buyer"),
      contacts: [
        {
          id: "contact_buyer",
          accountId: "acc_buyer",
          firstName: "Avery",
          lastName: "Buyer",
          role: "economic_buyer" as const,
          isPrimary: true,
          lastEngagedAt: NOW,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      capabilities: { ...unavailableCapabilities, contacts: true },
      reason: "new_executive_buyer",
      evidenceKind: "contact",
      evidenceText: "Economic buyer Avery Buyer has recorded engagement.",
    },
    {
      name: "data quality block",
      accountId: "acc_quality",
      account: {
        ...baseAccount("acc_quality"),
        dataQualityFlags: ["missing_domain"],
      },
      contacts: [],
      capabilities: unavailableCapabilities,
      reason: "data_quality_blocked",
      evidenceKind: "account",
      evidenceText: "Account data-quality flag: missing_domain.",
    },
  ])("emits direct source evidence for $name reasons", (testCase) => {
    const recommendation = prioritizeAccounts({
      runId: `run_${testCase.accountId}`,
      createdAt: NOW,
      sourceCapabilitiesByAccountId: {
        [testCase.accountId]: testCase.capabilities,
      },
      contexts: [
        {
          account: testCase.account,
          contacts: testCase.contacts,
          opportunities: [],
          activities: [],
        },
      ],
    })[0];

    expect(recommendation?.reasonCodes).toContain(testCase.reason);
    expect(
      recommendation?.sourceSignals.some(
        (signal) =>
          signal.kind === testCase.evidenceKind &&
          signal.description === testCase.evidenceText &&
          signal.verified,
      ),
    ).toBe(true);
  });

  it("preserves source capability provenance in the recommendation authority envelope", () => {
    const accountId = "acc_provenance";
    const snapshot = {
      ...unavailableCapabilities,
      accountTier: true,
      source: "salesforce",
      mappingVersion: "salesforce-account-map-v3",
      observedAt: "2026-08-03T08:55:00.000Z",
    };

    const recommendation = prioritizeAccounts({
      runId: "run_provenance",
      createdAt: NOW,
      sourceCapabilitiesByAccountId: { [accountId]: snapshot },
      sourceCapabilitySnapshotsByAccountId: { [accountId]: snapshot },
      contexts: [
        {
          account: { ...baseAccount(accountId), tier: "strategic" },
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
