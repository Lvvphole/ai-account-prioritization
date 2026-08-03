import { describe, expect, it } from "vitest";
import {
  coalesceAccountEvents,
  createNotificationDelivery,
  prioritizeAccounts,
  resolveFeatureModes,
} from "agent-runtime";

describe("event-driven CRM foundation", () => {
  it("coalesces noisy account events and keeps source-qualified evidence", () => {
    const events = [
      {
        workspaceId: "ws_1",
        source: "hubspot",
        sourceEventId: "evt_2",
        type: "crm.activity.created" as const,
        accountId: "acc_1",
        changedFields: ["occurredAt"],
        occurredAt: "2026-08-03T09:01:00.000Z",
      },
      {
        workspaceId: "ws_1",
        source: "salesforce",
        sourceEventId: "evt_2",
        type: "crm.opportunity.updated" as const,
        accountId: "acc_1",
        changedFields: ["amountUsd"],
        occurredAt: "2026-08-03T09:00:00.000Z",
      },
      {
        workspaceId: "ws_1",
        source: "hubspot",
        sourceEventId: "evt_2",
        type: "crm.activity.created" as const,
        accountId: "acc_1",
        changedFields: ["occurredAt"],
        occurredAt: "2026-08-03T09:01:00.000Z",
      },
    ];
    const work = coalesceAccountEvents(events);
    const reversed = coalesceAccountEvents([...events].reverse());

    expect(work).toHaveLength(1);
    expect(work[0]).toMatchObject({
      workspaceId: "ws_1",
      accountId: "acc_1",
      eventReferences: [
        { source: "hubspot", sourceEventId: "evt_2" },
        { source: "salesforce", sourceEventId: "evt_2" },
      ],
      affectedFeatures: ["intent", "pipeline", "staleness"],
      firstOccurredAt: "2026-08-03T09:00:00.000Z",
      lastOccurredAt: "2026-08-03T09:01:00.000Z",
    });
    expect(reversed).toEqual(work);
  });

  it("orders work with an ordinal comparator", () => {
    const work = coalesceAccountEvents([
      {
        workspaceId: "ws",
        source: "crm",
        sourceEventId: "2",
        type: "crm.account.updated",
        accountId: "z",
        changedFields: ["tier"],
        occurredAt: "2026-08-03T09:00:00.000Z",
      },
      {
        workspaceId: "ws",
        source: "crm",
        sourceEventId: "1",
        type: "crm.account.updated",
        accountId: "A",
        changedFields: ["tier"],
        occurredAt: "2026-08-03T09:00:00.000Z",
      },
    ]);
    expect(work.map((item) => item.accountId)).toEqual(["A", "z"]);
  });

  it("keeps unimplemented derived features unavailable", () => {
    const modes = resolveFeatureModes({
      accounts: true,
      contacts: true,
      opportunities: true,
      activities: true,
      accountTier: true,
      lifecycleStage: true,
      emailEvents: false,
      renewals: false,
      healthScore: false,
      intentSignals: false,
    });

    expect(modes.healthRisk).toBe("unavailable");
    expect(modes.intent).toBe("unavailable");
    expect(modes.pipeline).toBe("derived");
    expect(modes.staleness).toBe("derived");
  });

  it("keeps renewal-only lifecycle unavailable until a derivation exists", () => {
    const modes = resolveFeatureModes({
      accounts: true,
      contacts: true,
      opportunities: true,
      activities: true,
      accountTier: true,
      lifecycleStage: false,
      emailEvents: false,
      renewals: true,
      healthScore: false,
      intentSignals: false,
    });

    expect(modes.lifecycle).toBe("unavailable");
  });

  it("threads connector availability into score, reasons, and evidence", () => {
    const now = "2026-08-03T09:00:00.000Z";
    const capabilities = {
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
    const contexts = [
      {
        account: {
          id: "acc_high_defaults",
          name: "High Defaults",
          ownerId: "rep_1",
          tier: "strategic" as const,
          lifecycleStage: "churn_risk" as const,
          openPipelineUsd: 100_000,
          daysSinceLastContact: 365,
          healthScore: 0,
          intentSignals: ["surge"],
          dataQualityFlags: [],
          createdAt: now,
          updatedAt: now,
        },
        contacts: [],
        opportunities: [],
        activities: [],
      },
      {
        account: {
          id: "acc_low_defaults",
          name: "Low Defaults",
          ownerId: "rep_1",
          tier: "smb" as const,
          lifecycleStage: "prospect" as const,
          openPipelineUsd: 100_000,
          daysSinceLastContact: 0,
          healthScore: 100,
          intentSignals: [],
          dataQualityFlags: [],
          createdAt: now,
          updatedAt: now,
        },
        contacts: [],
        opportunities: [],
        activities: [],
      },
    ];

    const recommendations = prioritizeAccounts({
      runId: "run_capability_test",
      contexts,
      createdAt: now,
      sourceCapabilitiesByAccountId: {
        acc_high_defaults: capabilities,
        acc_low_defaults: capabilities,
      },
    });
    const high = recommendations.find((item) => item.accountId === "acc_high_defaults");
    const low = recommendations.find((item) => item.accountId === "acc_low_defaults");

    expect(high?.score).toBe(low?.score);
    expect(high?.reasonCodes).not.toContain("strategic_tier_account");
    expect(high?.reasonCodes).not.toContain("churn_risk_detected");
    expect(high?.reasonCodes).not.toContain("stale_no_contact");
    expect(high?.reasonCodes).not.toContain("verified_intent_signal");
    expect(high?.sourceSignals.some((signal) => signal.description.includes("health score"))).toBe(false);
    expect(high?.sourceSignals.some((signal) => signal.description.includes("No logged contact"))).toBe(false);
    expect(high?.sourceSignals.some((signal) => signal.description.includes("tier strategic"))).toBe(false);
  });

  it("creates stable collision-safe delivery evidence without retry scheduling", () => {
    const input = {
      workspaceId: "ws_1",
      recipientId: "a:b",
      recommendationId: "c",
      channel: "email" as const,
      workflowRunId: "workflow_1",
      now: "2026-08-03T09:00:00.000Z",
    };
    const first = createNotificationDelivery(input);
    const second = createNotificationDelivery({ ...input, now: "2026-08-03T10:00:00.000Z" });
    const delimiterCollisionCandidate = createNotificationDelivery({
      ...input,
      recipientId: "a",
      recommendationId: "b:c",
    });

    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.idempotencyKey).not.toBe(delimiterCollisionCandidate.idempotencyKey);
    expect(first).toMatchObject({
      workflowRunId: "workflow_1",
      status: "requested",
      providerMessageId: null,
      requestedAt: input.now,
      sentAt: null,
      failedAt: null,
      failureCode: null,
    });
    expect(first).not.toHaveProperty("attemptCount");
    expect(first).not.toHaveProperty("availableAt");
  });
});