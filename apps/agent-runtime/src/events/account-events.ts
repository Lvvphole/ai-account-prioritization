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

export interface AccountRecomputeWork {
  workspaceId: string;
  accountId: string;
  eventIds: string[];
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
  return [...features].sort();
}

/**
 * Coalesce noisy webhook bursts into one account-level recomputation unit.
 * The source event ids remain attached for idempotency and audit evidence.
 */
export function coalesceAccountEvents(events: AccountEvent[]): AccountRecomputeWork[] {
  const byAccount = new Map<string, AccountRecomputeWork>();

  for (const event of events) {
    const key = `${event.workspaceId}:${event.accountId}`;
    const existing = byAccount.get(key);
    const affected = affectedFeaturesForEvent(event);
    if (!existing) {
      byAccount.set(key, {
        workspaceId: event.workspaceId,
        accountId: event.accountId,
        eventIds: [event.sourceEventId],
        affectedFeatures: affected,
        firstOccurredAt: event.occurredAt,
        lastOccurredAt: event.occurredAt,
      });
      continue;
    }

    if (!existing.eventIds.includes(event.sourceEventId)) existing.eventIds.push(event.sourceEventId);
    existing.affectedFeatures = [...new Set([...existing.affectedFeatures, ...affected])].sort();
    if (event.occurredAt < existing.firstOccurredAt) existing.firstOccurredAt = event.occurredAt;
    if (event.occurredAt > existing.lastOccurredAt) existing.lastOccurredAt = event.occurredAt;
  }

  return [...byAccount.values()].sort((a, b) => {
    const workspaceOrder = a.workspaceId.localeCompare(b.workspaceId);
    return workspaceOrder !== 0 ? workspaceOrder : a.accountId.localeCompare(b.accountId);
  });
}
