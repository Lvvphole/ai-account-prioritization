import type { AnalyticsEvent, AnalyticsEventName } from "@repo/shared-schemas";
import { AnalyticsEventSchema } from "@repo/shared-schemas";
import { repository } from "../database/repository";

/** Analytics tracker — validated, in-memory; swap sink for prod telemetry. */
let counter = 0;

export function trackEvent(input: {
  name: AnalyticsEventName;
  runId?: string;
  accountId?: string;
  userId?: string;
  properties?: Record<string, unknown>;
  occurredAt: string;
}): AnalyticsEvent {
  const event = AnalyticsEventSchema.parse({
    id: `evt_${++counter}_${input.name}`,
    name: input.name,
    runId: input.runId,
    accountId: input.accountId,
    userId: input.userId,
    properties: input.properties ?? {},
    occurredAt: input.occurredAt,
  } satisfies AnalyticsEvent);
  repository.appendAnalytics(event);
  return event;
}
