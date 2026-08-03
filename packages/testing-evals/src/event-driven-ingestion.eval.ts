import { describe, expect, it } from "vitest";
import {
  coalesceAccountEvents,
  createNotificationJob,
  nextNotificationAttemptAt,
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

  it("keeps health unavailable until a versioned derivation exists", () => {
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
    expect(modes.intent).toBe("derived");
    expect(modes.pipeline).toBe("derived");
  });

  it("creates stable collision-safe notification ids and bounded retry times", () => {
    const input = {
      workspaceId: "ws_1",
      recipientId: "a:b",
      recommendationId: "c",
      channel: "email" as const,
      now: "2026-08-03T09:00:00.000Z",
    };
    const first = createNotificationJob(input);
    const second = createNotificationJob({ ...input, now: "2026-08-03T10:00:00.000Z" });
    const delimiterCollisionCandidate = createNotificationJob({
      ...input,
      recipientId: "a",
      recommendationId: "b:c",
    });

    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.idempotencyKey).not.toBe(delimiterCollisionCandidate.idempotencyKey);
    expect(nextNotificationAttemptAt(input.now, 1)).toBe("2026-08-03T09:01:00.000Z");
    expect(nextNotificationAttemptAt(input.now, 10)).toBe("2026-08-03T10:00:00.000Z");
  });
});
