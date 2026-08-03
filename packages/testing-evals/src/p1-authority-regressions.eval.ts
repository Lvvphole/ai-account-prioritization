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

  it("derives pipeline authority identically for every opportunity row order", () => {
    const now = "2026-08-03T09:00:00.000Z";
    const capabilities = {
      accounts: true as const,
      contacts: false,
      opportunities: true,
      activities: false,
      accountTier: true,
      lifecycleStage: false,
      emailEvents: false,
      renewals: false,
      healthScore: false,
      intentSignals: false,
    };
    const opportunities = [
      {
        id: "opp_c",
        accountId: "acc_pipeline",
        name: "Large component",
        stage: "qualification" as const,
        amountUsd: 49999.7,
        probability: 0.5,
        isClosed: false,
        isWon: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "opp_a",
        accountId: "acc_pipeline",
        name: "Ten cents",
        stage: "qualification" as const,
        amountUsd: 0.1,
        probability: 0.5,
        isClosed: false,
        isWon: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "opp_b",
        accountId: "acc_pipeline",
        name: "Twenty cents",
        stage: "qualification" as const,
        amountUsd: 0.2,
        probability: 0.5,
        isClosed: false,
        isWon: false,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const prioritize = (orderedOpportunities: typeof opportunities) =>
      prioritizeAccounts({
        runId: "run_pipeline_order",
        createdAt: now,
        sourceCapabilitiesByAccountId: { acc_pipeline: capabilities },
        contexts: [
          {
            account: {
              id: "acc_pipeline",
              name: "Pipeline Account",
              ownerId: "rep_1",
              tier: "smb" as const,
              lifecycleStage: "prospect" as const,
              openPipelineUsd: 0,
              intentSignals: [],
              dataQualityFlags: [],
              createdAt: now,
              updatedAt: now,
            },
            contacts: [],
            opportunities: orderedOpportunities,
            activities: [],
          },
        ],
      })[0];

    const first = prioritize(opportunities);
    const second = prioritize([...opportunities].reverse());

    expect(first).toEqual(second);
    expect(first?.reasonCodes).toContain("high_open_pipeline");
    expect(
      first?.sourceSignals.some((signal) =>
        signal.description.includes("open-opportunity-sum-usd-cents-v2"),
      ),
    ).toBe(true);
  });

  it("rejects sub-cent pipeline values regardless of amount magnitude", () => {
    const now = "2026-08-03T09:00:00.000Z";

    expect(() =>
      prioritizeAccounts({
        runId: "run_pipeline_precision",
        createdAt: now,
        sourceCapabilitiesByAccountId: {
          acc_precision: {
            accounts: true,
            contacts: false,
            opportunities: true,
            activities: false,
            accountTier: false,
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
              id: "acc_precision",
              name: "Precision Account",
              ownerId: "rep_1",
              tier: "smb" as const,
              lifecycleStage: "prospect" as const,
              openPipelineUsd: 0,
              intentSignals: [],
              dataQualityFlags: [],
              createdAt: now,
              updatedAt: now,
            },
            contacts: [],
            opportunities: [
              {
                id: "opp_subcent",
                accountId: "acc_precision",
                name: "Sub-cent amount",
                stage: "qualification" as const,
                amountUsd: 1_000_000_000_000.001,
                probability: 0.5,
                isClosed: false,
                isWon: false,
                createdAt: now,
                updatedAt: now,
              },
            ],
            activities: [],
          },
        ],
      }),
    ).toThrow("must have at most two decimal places");
  });

  it("serializes buyer evidence identically for every contact row order", () => {
    const now = "2026-08-03T09:00:00.000Z";
    const capabilities = {
      accounts: true as const,
      contacts: true,
      opportunities: false,
      activities: false,
      accountTier: true,
      lifecycleStage: false,
      emailEvents: false,
      renewals: false,
      healthScore: false,
      intentSignals: false,
    };
    const contacts = [
      {
        id: "contact_z",
        accountId: "acc_buyers",
        firstName: "Zoe",
        lastName: "Buyer",
        role: "economic_buyer" as const,
        isPrimary: false,
        lastEngagedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "contact_A",
        accountId: "acc_buyers",
        firstName: "Avery",
        lastName: "Buyer",
        role: "economic_buyer" as const,
        isPrimary: true,
        lastEngagedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const prioritize = (orderedContacts: typeof contacts) =>
      prioritizeAccounts({
        runId: "run_buyer_order",
        createdAt: now,
        sourceCapabilitiesByAccountId: { acc_buyers: capabilities },
        contexts: [
          {
            account: {
              id: "acc_buyers",
              name: "Buyer Order Account",
              ownerId: "rep_1",
              tier: "smb" as const,
              lifecycleStage: "prospect" as const,
              openPipelineUsd: 0,
              intentSignals: [],
              dataQualityFlags: [],
              createdAt: now,
              updatedAt: now,
            },
            contacts: orderedContacts,
            opportunities: [],
            activities: [],
          },
        ],
      })[0];

    const first = prioritize(contacts);
    const second = prioritize([...contacts].reverse());

    expect(first).toEqual(second);
    expect(first?.reasonCodes).toContain("new_executive_buyer");
    expect(
      first?.sourceSignals
        .filter((signal) => signal.kind === "contact")
        .map((signal) => signal.refId),
    ).toEqual(["contact_A", "contact_z"]);
  });
});
