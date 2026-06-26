import type { AnalyticsEvent, AnalyticsEventName } from "@repo/shared-schemas";
import { AnalyticsEventSchema } from "@repo/shared-schemas";
import { inMemoryRepository, type RuntimeRepository } from "../runtime-repository";

/** Analytics tracker — validated, appended to the run's repository sink. */
let counter = 0;

export async function trackEvent(
  input: {
    name: AnalyticsEventName;
    runId?: string;
    accountId?: string;
    userId?: string;
    properties?: Record<string, unknown>;
    occurredAt: string;
  },
  repo: RuntimeRepository = inMemoryRepository,
): Promise<AnalyticsEvent> {
  const event = AnalyticsEventSchema.parse({
    id: `evt_${++counter}_${input.name}`,
    name: input.name,
    runId: input.runId,
    accountId: input.accountId,
    userId: input.userId,
    properties: input.properties ?? {},
    occurredAt: input.occurredAt,
  } satisfies AnalyticsEvent);
  await repo.appendAnalytics(event);
  return event;
}
