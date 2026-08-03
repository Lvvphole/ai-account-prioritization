import { describe, expect, it } from "vitest";
import {
  CAPABILITY_SNAPSHOT_FRESHNESS_POLICY_VERSION,
  assertCapabilitySnapshotFresh,
  prioritizeAccounts,
} from "agent-runtime";

const NOW = "2026-08-03T09:00:00.000Z";

const PIPELINE_CAPABILITIES = {
  accounts: true as const,
  contacts: false,
  opportunities: true,
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
    name: id,
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

describe("current-head P2 authority regressions", () => {
  it("uses preserved source decimal text before JavaScript number precision", () => {
    const recommendation = prioritizeAccounts({
      runId: "run_exact_decimal",
      createdAt: NOW,
      sourceCapabilitiesByAccountId: { acc_exact: PIPELINE_CAPABILITIES },
      contexts: [
        {
          account: baseAccount("acc_exact"),
          contacts: [],
          activities: [],
          opportunities: [
            {
              id: "opp_exact",
              accountId: "acc_exact",
              name: "Exact source amount",
              stage: "proposal",
              amountUsd: 70_000_000_000_000,
              amountUsdExact: "70000000000000.01",
              probability: 0.5,
              isClosed: false,
              isWon: false,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
        },
      ],
    })[0];

    expect(
      recommendation?.sourceSignals.some((signal) =>
        signal.description.includes("$70,000,000,000,000.01"),
      ),
    ).toBe(true);

    expect(() =>
      prioritizeAccounts({
        runId: "run_subcent_source_text",
        createdAt: NOW,
        sourceCapabilitiesByAccountId: { acc_subcent: PIPELINE_CAPABILITIES },
        contexts: [
          {
            account: baseAccount("acc_subcent"),
            contacts: [],
            activities: [],
            opportunities: [
              {
                id: "opp_subcent_source",
                accountId: "acc_subcent",
                name: "Sub-cent source amount",
                stage: "proposal",
                amountUsd: 70_000_000_000_000,
                amountUsdExact: "70000000000000.001",
                probability: 0.5,
                isClosed: false,
                isWon: false,
                createdAt: NOW,
                updatedAt: NOW,
              },
            ],
          },
        ],
      }),
    ).toThrow("must have at most two decimal places");
  });

  it("fails closed when capability authority is expired or future-dated", () => {
    expect(CAPABILITY_SNAPSHOT_FRESHNESS_POLICY_VERSION).toBe(
      "crm-source-capability-max-age-7d-v1",
    );
    expect(() =>
      assertCapabilitySnapshotFresh("2026-08-01T09:00:00.000Z", NOW),
    ).not.toThrow();
    expect(() =>
      assertCapabilitySnapshotFresh("2026-07-26T08:59:59.999Z", NOW),
    ).toThrow("is stale under crm-source-capability-max-age-7d-v1");
    expect(() =>
      assertCapabilitySnapshotFresh("2026-08-03T09:00:00.001Z", NOW),
    ).toThrow("newer than the injected decision clock");
  });

  it("rejects conflicting scoring capabilities and provenance snapshots", () => {
    const snapshot = {
      ...PIPELINE_CAPABILITIES,
      opportunities: false,
      source: "salesforce",
      mappingVersion: "salesforce-account-v8",
      observedAt: "2026-08-03T08:59:00.000Z",
    };

    expect(() =>
      prioritizeAccounts({
        runId: "run_conflicting_authority",
        createdAt: NOW,
        sourceCapabilitiesByAccountId: { acc_conflict: PIPELINE_CAPABILITIES },
        sourceCapabilitySnapshotsByAccountId: { acc_conflict: snapshot },
        contexts: [
          {
            account: baseAccount("acc_conflict"),
            contacts: [],
            opportunities: [],
            activities: [],
          },
        ],
      }),
    ).toThrow("Conflicting CRM source authority for account acc_conflict");
  });

  it("uses a snapshot-only declaration for both scoring and audit evidence", () => {
    const snapshot = {
      ...PIPELINE_CAPABILITIES,
      source: "salesforce",
      mappingVersion: "salesforce-account-v8",
      observedAt: "2026-08-03T08:59:00.000Z",
    };

    const recommendation = prioritizeAccounts({
      runId: "run_snapshot_only",
      createdAt: NOW,
      sourceCapabilitySnapshotsByAccountId: { acc_snapshot: snapshot },
      contexts: [
        {
          account: baseAccount("acc_snapshot"),
          contacts: [],
          opportunities: [
            {
              id: "opp_snapshot",
              accountId: "acc_snapshot",
              name: "Snapshot pipeline",
              stage: "proposal",
              amountUsd: 50_000,
              amountUsdExact: "50000.00",
              probability: 0.5,
              isClosed: false,
              isWon: false,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
          activities: [],
        },
      ],
    })[0];

    expect(recommendation?.reasonCodes).toContain("high_open_pipeline");
    expect(recommendation?.sourceCapabilitySnapshot).toEqual(snapshot);
  });
});
