import type { Recommendation } from "@repo/shared-schemas";
import type { AccountContext } from "../account-prioritizer/prioritizer.policy";

export const DEFAULT_DRAFT_EVIDENCE_MAX_AGE_DAYS = 90;
const MS_PER_DAY = 86_400_000;

export interface VerifiedDraftSignal {
  id: string;
  kind: Recommendation["sourceSignals"][number]["kind"];
  description: string;
}

export interface VerifiedDraftContext {
  recommendationId: string;
  accountId: string;
  accountName: string;
  actionType: Recommendation["nextBestAction"]["type"];
  objective: string;
  signals: VerifiedDraftSignal[];
}

export interface DraftContextLimits {
  maxSignals?: number;
  /** Injected deterministic clock. Defaults to the recommendation creation time. */
  now?: string;
  /** When supplied, selected evidence must resolve to a source newer than this. */
  maxEvidenceAgeDays?: number;
}

const ACTION_SIGNAL_PRIORITY: Record<
  Recommendation["nextBestAction"]["type"],
  Recommendation["sourceSignals"][number]["kind"][]
> = {
  call: ["opportunity", "intent", "activity", "contact", "account", "derived"],
  schedule_meeting: ["opportunity", "intent", "activity", "contact", "account", "derived"],
  send_email: ["opportunity", "intent", "activity", "contact", "account", "derived"],
  log_research_note: ["derived", "account", "opportunity", "intent", "activity", "contact"],
  request_intro: ["contact", "activity", "account", "opportunity", "intent", "derived"],
  escalate_to_manager: ["derived", "account", "opportunity", "activity", "intent", "contact"],
  no_action_hold: ["derived", "account", "opportunity", "intent", "activity", "contact"],
};

const sourceObservedAt = (
  signal: Recommendation["sourceSignals"][number],
  ctx: AccountContext,
): string | undefined => {
  switch (signal.kind) {
    case "account":
    case "derived":
      return signal.refId === ctx.account.id ? ctx.account.updatedAt : undefined;
    case "contact":
      return ctx.contacts.find((contact) => contact.id === signal.refId)?.updatedAt;
    case "opportunity":
      return ctx.opportunities.find((opportunity) => opportunity.id === signal.refId)?.updatedAt;
    case "activity":
    case "intent":
      return ctx.activities.find((activity) => activity.id === signal.refId)?.occurredAt;
    default:
      return undefined;
  }
};

const assertFreshSelectedEvidence = (
  signal: Recommendation["sourceSignals"][number],
  ctx: AccountContext,
  now: string,
  maxEvidenceAgeDays: number,
): void => {
  const observedAt = sourceObservedAt(signal, ctx);
  if (!observedAt) {
    throw new Error("DRAFT_CONTEXT_SOURCE_UNRESOLVED");
  }

  const ageMs = Date.parse(now) - Date.parse(observedAt);
  if (!Number.isFinite(ageMs)) {
    throw new Error("DRAFT_CONTEXT_SOURCE_TIME_INVALID");
  }
  if (ageMs > maxEvidenceAgeDays * MS_PER_DAY) {
    throw new Error("DRAFT_CONTEXT_STALE_SIGNAL");
  }
};

/**
 * Build the minimum model-visible packet. Raw contacts, activities, opportunity
 * objects, notes, emails, and other unneeded CRM fields are deliberately omitted.
 * Verified evidence is stably prioritized for the authorized action and can be
 * capped before any model request is constructed. When a freshness policy is
 * supplied, every selected signal is resolved back to its source record and must
 * be fresh enough before its description is admitted to model-visible context.
 */
export function buildVerifiedDraftContext(
  rec: Recommendation,
  ctx: AccountContext,
  limits: DraftContextLimits = {},
): VerifiedDraftContext {
  if (rec.sourceSignals.length === 0 || rec.sourceSignals.some((signal) => !signal.verified)) {
    throw new Error("DRAFT_CONTEXT_UNVERIFIED_SIGNAL");
  }

  const priorities = ACTION_SIGNAL_PRIORITY[rec.nextBestAction.type];
  const maxSignals = limits.maxSignals ?? rec.sourceSignals.length;
  const now = limits.now ?? rec.createdAt;
  const selected = rec.sourceSignals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => {
      const priorityDelta = priorities.indexOf(a.signal.kind) - priorities.indexOf(b.signal.kind);
      return priorityDelta !== 0 ? priorityDelta : a.index - b.index;
    })
    .slice(0, maxSignals);

  if (selected.length === 0) {
    throw new Error("DRAFT_CONTEXT_UNVERIFIED_SIGNAL");
  }

  if (limits.maxEvidenceAgeDays !== undefined) {
    for (const { signal } of selected) {
      assertFreshSelectedEvidence(signal, ctx, now, limits.maxEvidenceAgeDays);
    }
  }

  const signals = selected.map(({ signal }) => ({
    id: signal.refId,
    kind: signal.kind,
    description: signal.description,
  }));

  return {
    recommendationId: rec.id,
    accountId: rec.accountId,
    accountName: ctx.account.name,
    actionType: rec.nextBestAction.type,
    objective: rec.nextBestAction.objective,
    signals,
  };
}
