import type { AccountFeatureName } from "../agents/account-prioritizer/prioritizer.policy";

export type AccountEventType =
  | "crm.account.updated"
  | "crm.opportunity.updated"
  | "crm.activity.created"
  | "crm.contact.updated"
  | "crm.email.engaged"
  | "schedule.reconciliation.requested";

export interface AccountEvent {
  workspaceId: string;
  source: string;
  sourceEventId: string;
  type: AccountEventType;
  accountId: string;
  changedFields: string[];
  occurredAt: string;
}

export interface AccountEventReference {
  source: string;
  sourceEventId: string;
}

export interface AccountRecomputeWork {
  workspaceId: string;
  accountId: string;
  eventReferences: AccountEventReference[];
  affectedFeatures: AccountFeatureName[];
  firstOccurredAt: string;
  lastOccurredAt: string;
}

const FIELD_TO_FEATURES: Record<string, AccountFeatureName[]> = {
  openPipelineUsd: ["pipeline"],
  amountUsd: ["pipeline"],
  stage: ["pipeline", "lifecycle"],
  isClosed: ["pipeline", "lifecycle"],
  intentSignals: ["intent"],
  subject: ["intent", "staleness"],
  occurredAt: ["intent", "staleness"],
  lastContactedAt: ["staleness"],
  daysSinceLastContact: ["staleness"],
  tier: ["tier"],
  lifecycleStage: ["lifecycle"],
  renewalDate: ["lifecycle"],
  healthScore: ["healthRisk"],
};

function compareOrdinal(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function eventReferenceKey(reference: AccountEventReference): string {
  return JSON.stringify([reference.source, reference.sourceEventId]);
}

function compareEventReferences(a: AccountEventReference, b: AccountEventReference): number {
  const sourceOrder = compareOrdinal(a.source, b.source);
  return sourceOrder !== 0 ? sourceOrder : compareOrdinal(a.sourceEventId, b.sourceEventId);
}

export function affectedFeaturesForEvent(event: AccountEvent): AccountFeatureName[] {
  if (event.type === "schedule.reconciliation.requested") {
    return ["pipeline", "intent", "staleness", "tier", "lifecycle", "healthRisk"];
  }

  const features = new Set<AccountFeatureName>();
  for (const field of event.changedFields) {
    for (const feature of FIELD_TO_FEATURES[field] ?? []) features.add(feature);
  }

  if (event.type === "crm.activity.created" || event.type === "crm.email.engaged") {
    features.add("intent");
    features.add("staleness");
  }
  return [...features].sort(compareOrdinal);
}

/**
 * Coalesce noisy webhook bursts into one account-level recomputation unit.
 * Source-qualified references remain attached for idempotency and audit evidence.
 */
export function coalesceAccountEvents(events: AccountEvent[]): AccountRecomputeWork[] {
  const byAccount = new Map<string, AccountRecomputeWork>();

  for (const event of events) {
    const key = JSON.stringify([event.workspaceId, event.accountId]);
    const reference = { source: event.source, sourceEventId: event.sourceEventId };
    const existing = byAccount.get(key);
    const affected = affectedFeaturesForEvent(event);
    if (!existing) {
      byAccount.set(key, {
        workspaceId: event.workspaceId,
        accountId: event.accountId,
        eventReferences: [reference],
        affectedFeatures: affected,
        firstOccurredAt: event.occurredAt,
        lastOccurredAt: event.occurredAt,
      });
      continue;
    }

    const referenceKey = eventReferenceKey(reference);
    if (!existing.eventReferences.some((item) => eventReferenceKey(item) === referenceKey)) {
      existing.eventReferences.push(reference);
    }
    existing.affectedFeatures = [
      ...new Set([...existing.affectedFeatures, ...affected]),
    ].sort(compareOrdinal);
    if (event.occurredAt < existing.firstOccurredAt) existing.firstOccurredAt = event.occurredAt;
    if (event.occurredAt > existing.lastOccurredAt) existing.lastOccurredAt = event.occurredAt;
  }

  return [...byAccount.values()]
    .map((work) => ({
      ...work,
      eventReferences: [...work.eventReferences].sort(compareEventReferences),
    }))
    .sort((a, b) => {
      const workspaceOrder = compareOrdinal(a.workspaceId, b.workspaceId);
      return workspaceOrder !== 0 ? workspaceOrder : compareOrdinal(a.accountId, b.accountId);
    });
}
