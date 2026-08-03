import { describe, expect, it } from "vitest";
import {
  coalesceAccountEvents,
  createNotificationDelivery,
  parseDurableRecommendationId,
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

  it("normalizes offset-bearing event timestamps and rejects zone-less values", () => {
    const work = coalesceAccountEvents([
      {
        workspaceId: "ws_1",
        source: "crm",
        sourceEventId: "evt_early",
        type: "crm.account.updated",
        accountId: "acc_1",
        changedFields: ["tier"],
        occurredAt: "2026-08-03T10:00:00+02:00",
      },
      {
        workspaceId: "ws_1",
        source: "crm",
        sourceEventId: "evt_late",
        type: "crm.account.updated",
        accountId: "acc_1",
        changedFields: ["tier"],
        occurredAt: "2026-08-03T09:00:00Z",
      },
    ]);

    expect(work[0]?.firstOccurredAt).toBe("2026-08-03T08:00:00.000Z");
    expect(work[0]?.lastOccurredAt).toBe("2026-08-03T09:00:00.000Z");
    expect(() =>
      coalesceAccountEvents([
        {
          workspaceId: "ws_1",
          source: "crm",
          sourceEventId: "evt_zone_less",
          type: "crm.account.updated",
          accountId: "acc_1",
          changedFields: ["tier"],
          occurredAt: "2026-08-03T09:00:00",
        },
      ]),
    ).toThrow("must include an explicit UTC offset");
    expect(() =>
      coalesceAccountEvents([
        {
          workspaceId: "ws_1",
          source: "crm",
          sourceEventId: "evt_invalid",
          type: "crm.account.updated",
          accountId: "acc_1",
          changedFields: ["tier"],
          occurredAt: "not-a-timestampZ",
        },
      ]),
    ).toThrow("Invalid account event occurredAt timestamp");
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
    expect(modes.staleness).toBe("unavailable");
  });

  it("derives pipeline from traceable open opportunities instead of account defaults", () => {
    const now = "2026-08-03T09:00:00.000Z";
    const recommendation = prioritizeAccounts({
      runId: "run_pipeline_derivation",
      createdAt: now,
      sourceCapabilitiesByAccountId: {
        acc_pipeline: {
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
            id: "acc_pipeline",
            name: "Pipeline Account",
            ownerId: "rep_1",
            tier: "smb",
            lifecycleStage: "prospect",
            openPipelineUsd: 0,
            intentSignals: [],
            dataQualityFlags: [],
            createdAt: now,
            updatedAt: now,
          },
          contacts: [],
          activities: [],
          opportunities: [
            {
              id: "opp_open",
              accountId: "acc_pipeline",
              name: "Open opportunity",
              stage: "proposal",
              amountUsd: 250_000,
              probability: 0.5,
              isClosed: false,
              isWon: false,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: "opp_closed",
              accountId: "acc_pipeline",
              name: "Closed opportunity",
              stage: "closed_lost",
              amountUsd: 900_000,
              probability: 0,
              isClosed: true,
              isWon: false,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
      ],
    })[0];

    expect(recommendation?.reasonCodes).toContain("high_open_pipeline");
    expect(
      recommendation?.sourceSignals.some(
        (signal) =>
          signal.refId === "opp_open" &&
          signal.description.includes("$250,000") &&
          signal.description.includes("open-opportunity-sum-usd-cents-v2"),
      ),
    ).toBe(true);
    expect(
      recommendation?.sourceSignals.some(
        (signal) => signal.description.includes("Derived open pipeline totals $250,000"),
      ),
    ).toBe(true);
    expect(recommendation?.sourceSignals.some((signal) => signal.refId === "opp_closed")).toBe(false);
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
  });

  it("does not let unavailable staleness lift confidence above the action threshold", () => {
    const now = "2026-08-03T09:00:00.000Z";
    const recommendation = prioritizeAccounts({
      runId: "run_confidence_provenance",
      createdAt: now,
      sourceCapabilitiesByAccountId: {
        acc_confidence: {
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
            id: "acc_confidence",
            name: "Confidence Account",
            ownerId: "rep_1",
            tier: "strategic",
            lifecycleStage: "prospect",
            openPipelineUsd: 0,
            employeeCount: 100,
            daysSinceLastContact: 365,
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

    expect(recommendation?.confidence).toBeCloseTo(1 / 6, 8);
    expect(recommendation?.nextBestAction.type).toBe("no_action_hold");
    expect(recommendation?.approvalStatus).toBe("not_required");
  });

  it("does not let unavailable contacts raise confidence or create buyer reasons", () => {
    const now = "2026-08-03T09:00:00.000Z";
    const recommendation = prioritizeAccounts({
      runId: "run_contact_provenance",
      createdAt: now,
      sourceCapabilitiesByAccountId: {
        acc_contact: {
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
            id: "acc_contact",
            name: "Contact Account",
            ownerId: "rep_1",
            tier: "strategic",
            lifecycleStage: "prospect",
            openPipelineUsd: 0,
            employeeCount: 100,
            intentSignals: [],
            dataQualityFlags: [],
            createdAt: now,
            updatedAt: now,
          },
          contacts: [
            {
              id: "contact_default",
              accountId: "acc_contact",
              firstName: "Default",
              lastName: "Buyer",
              role: "economic_buyer",
              isPrimary: true,
              lastEngagedAt: now,
              createdAt: now,
              updatedAt: now,
            },
          ],
          opportunities: [],
          activities: [],
        },
      ],
    })[0];

    expect(recommendation?.confidence).toBeCloseTo(1 / 6, 8);
    expect(recommendation?.reasonCodes).not.toContain("new_executive_buyer");
    expect(recommendation?.nextBestAction.type).toBe("no_action_hold");
    expect(recommendation?.approvalStatus).toBe("not_required");
  });

  it("requires canonical durable recommendation UUIDs for delivery evidence", () => {
    const recommendationA = parseDurableRecommendationId(
      "91000000-0000-0000-0000-0000000000a1",
    );
    const recommendationB = parseDurableRecommendationId(
      "91000000-0000-0000-0000-0000000000b2",
    );
    const input = {
      workspaceId: "ws_1",
      recipientId: "a:b",
      recommendationId: recommendationA,
      channel: "email" as const,
      workflowRunId: "workflow_1",
      now: "2026-08-03T09:00:00.000Z",
    };

    const first = createNotificationDelivery(input);
    const second = createNotificationDelivery({ ...input, now: "2026-08-03T10:00:00.000Z" });
    const differentRecommendation = createNotificationDelivery({
      ...input,
      recipientId: "a",
      recommendationId: recommendationB,
    });

    expect(() => parseDurableRecommendationId("rec_run_account")).toThrow();
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.idempotencyKey).not.toBe(differentRecommendation.idempotencyKey);
    expect(first.recommendationId).toBe(recommendationA);
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
