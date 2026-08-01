import type { Recommendation } from "@repo/shared-schemas";
import type { AccountContext } from "../account-prioritizer/prioritizer.policy";

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

/**
 * Build the minimum model-visible packet. Raw contacts, activities, opportunity
 * objects, notes, emails, and other unneeded CRM fields are deliberately omitted.
 * Verified evidence is stably prioritized for the authorized action and can be
 * capped before any model request is constructed.
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
  const signals = rec.sourceSignals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => {
      const priorityDelta = priorities.indexOf(a.signal.kind) - priorities.indexOf(b.signal.kind);
      return priorityDelta !== 0 ? priorityDelta : a.index - b.index;
    })
    .slice(0, maxSignals)
    .map(({ signal }) => ({
      id: signal.refId,
      kind: signal.kind,
      description: signal.description,
    }));

  if (signals.length === 0) {
    throw new Error("DRAFT_CONTEXT_UNVERIFIED_SIGNAL");
  }

  return {
    recommendationId: rec.id,
    accountId: rec.accountId,
    accountName: ctx.account.name,
    actionType: rec.nextBestAction.type,
    objective: rec.nextBestAction.objective,
    signals,
  };
}
