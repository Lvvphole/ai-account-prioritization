import { describe, expect, it } from "vitest";
import type { CrmSourceCapabilitySnapshot } from "@repo/shared-schemas";
import {
  CAPABILITY_SNAPSHOT_FRESHNESS_POLICY_VERSION,
  assertCapabilitySnapshotFresh,
  partitionCapabilityAuthority,
} from "./source-capabilities";

const NOW = "2026-08-03T09:00:00.000Z";

function snapshot(observedAt: string): CrmSourceCapabilitySnapshot {
  return {
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
    source: "salesforce",
    mappingVersion: "salesforce-account-v1",
    observedAt,
  };
}

describe("capability temporal authority", () => {
  it("contains stale, future, and missing evidence to the affected accounts", () => {
    const partition = partitionCapabilityAuthority(
      ["acc_stale", "acc_fresh", "acc_missing", "acc_future"],
      {
        acc_fresh: snapshot("2026-08-03T08:59:00.000Z"),
        acc_stale: snapshot("2026-07-20T09:00:00.000Z"),
        acc_future: snapshot("2026-08-03T09:00:00.001Z"),
      },
      NOW,
    );

    expect(partition.eligibleAccountIds).toEqual(["acc_fresh"]);
    expect(partition.holds.map(({ accountId, failedGate }) => [accountId, failedGate])).toEqual([
      ["acc_future", "CAPABILITY_SNAPSHOT_FUTURE"],
      ["acc_missing", "CAPABILITY_SNAPSHOT_MISSING"],
      ["acc_stale", "CAPABILITY_SNAPSHOT_STALE"],
    ]);
  });

  it("accepts the exact maximum-age boundary", () => {
    expect(() =>
      assertCapabilitySnapshotFresh("2026-07-27T09:00:00.000Z", NOW),
    ).not.toThrow();
    expect(CAPABILITY_SNAPSHOT_FRESHNESS_POLICY_VERSION).toBe(
      "crm-source-capability-max-age-7d-v1",
    );
  });

  it("rejects a zone-less decision clock before freshness evaluation", () => {
    expect(() =>
      assertCapabilitySnapshotFresh("2026-08-03T08:59:00.000Z", "2026-08-03T09:00:00"),
    ).toThrow("Decision clock must be an offset-bearing ISO timestamp.");
  });
});
