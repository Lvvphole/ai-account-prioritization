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

/**
 * Build the minimum model-visible packet. Raw contacts, activities, opportunity
 * objects, notes, emails, and other unneeded CRM fields are deliberately omitted.
 */
export function buildVerifiedDraftContext(
  rec: Recommendation,
  ctx: AccountContext,
): VerifiedDraftContext {
  const signals = rec.sourceSignals
    .filter((signal) => signal.verified)
    .map((signal) => ({
      id: signal.refId,
      kind: signal.kind,
      description: signal.description,
    }));

  if (signals.length !== rec.sourceSignals.length || signals.length === 0) {
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
