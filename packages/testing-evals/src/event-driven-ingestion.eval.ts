import { describe, expect, it } from "vitest";
import {
  coalesceAccountEvents,
  createNotificationJob,
  nextNotificationAttemptAt,
  resolveFeatureModes,
} from "agent-runtime";

describe("event-driven CRM foundation", () => {
  it("coalesces noisy account events and keeps source ids", () => {
    const work = coalesceAccountEvents([
      {
        workspaceId: "ws_1",
        source: "hubspot",
        sourceEventId: "evt_2",
        type: "crm.activity.created",
        accountId: "acc_1",
        changedFields: ["occurredAt"],
        occurredAt: "2026-08-03T09:01:00.000Z",
      },
      {
        workspaceId: "ws_1",
        source: "hubspot",
        sourceEventId: "evt_1",
        type: "crm.opportunity.updated",
        accountId: "acc_1",
        changedFields: ["amountUsd"],
        occurredAt: "2026-08-03T09:00:00.000Z",
      },
      {
        workspaceId: "ws_1",
        source: "hubspot",
        sourceEventId: "evt_2",
        type: "crm.activity.created",
        accountId: "acc_1",
        changedFields: ["occurredAt"],
        occurredAt: "2026-08-03T09:01:00.000Z",
      },
    ]);

    expect(work).toHaveLength(1);
    expect(work[0]).toMatchObject({
      workspaceId: "ws_1",
      accountId: "acc_1",
      eventIds: ["evt_2", "evt_1"],
      affectedFeatures: ["intent", "pipeline", "staleness"],
      firstOccurredAt: "2026-08-03T09:00:00.000Z",
      lastOccurredAt: "2026-08-03T09:01:00.000Z",
    });
  });

  it("does not require a source-provided health score", () => {
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

    expect(modes.healthRisk).toBe("derived");
    expect(modes.intent).toBe("derived");
    expect(modes.pipeline).toBe("derived");
  });

  it("creates stable notification ids and bounded retry times", () => {
    const input = {
      workspaceId: "ws_1",
      recipientId: "rep_1",
      recommendationId: "rec_1",
      channel: "email" as const,
      now: "2026-08-03T09:00:00.000Z",
    };
    const first = createNotificationJob(input);
    const second = createNotificationJob({ ...input, now: "2026-08-03T10:00:00.000Z" });

    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(nextNotificationAttemptAt(input.now, 1)).toBe("2026-08-03T09:01:00.000Z");
    expect(nextNotificationAttemptAt(input.now, 10)).toBe("2026-08-03T10:00:00.000Z");
  });
});
