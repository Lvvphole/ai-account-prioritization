import type { NextBestAction, NextBestActionType, ReasonCode } from "@repo/shared-schemas";
import type { AccountContext } from "../prioritizer.policy";

/**
 * select-next-best-action — DETERMINISTIC NBA selection from reason codes and
 * lifecycle. Also classifies whether the action is customer-facing and/or a CRM
 * write-back, which drives approval gating downstream.
 */
const CUSTOMER_FACING: ReadonlySet<NextBestActionType> = new Set([
  "call",
  "send_email",
  "schedule_meeting",
]);
const CRM_WRITE_BACK: ReadonlySet<NextBestActionType> = new Set(["log_research_note"]);

function pickType(ctx: AccountContext, reasonCodes: ReasonCode[]): {
  type: NextBestActionType;
  objective: string;
} {
  const a = ctx.account;
  const has = (c: ReasonCode) => reasonCodes.includes(c);

  if (has("data_quality_blocked")) {
    return {
      type: "log_research_note",
      objective: "Resolve data-quality gaps before any customer outreach.",
    };
  }
  if (has("churn_risk_detected")) {
    return {
      type: "call",
      objective: `Proactively call ${a.name} to address churn-risk indicators and reassure the account.`,
    };
  }
  if (has("renewal_approaching")) {
    return {
      type: "schedule_meeting",
      objective: `Schedule a renewal-planning meeting with ${a.name}.`,
    };
  }
  if (has("stalled_opportunity")) {
    return {
      type: "send_email",
      objective: `Re-engage the open opportunity at ${a.name} with a concrete next step.`,
    };
  }
  if (has("verified_intent_signal")) {
    return {
      type: "call",
      objective: `Follow up on recent buying-intent signals from ${a.name}.`,
    };
  }
  if (has("stale_no_contact")) {
    return {
      type: "send_email",
      objective: `Reopen the conversation with ${a.name} after a period of no contact.`,
    };
  }
  return {
    type: "log_research_note",
    objective: `Research ${a.name} and document the account plan.`,
  };
}

export function selectNextBestAction(
  ctx: AccountContext,
  reasonCodes: ReasonCode[],
  confidence: number,
  minConfidence: number,
): NextBestAction {
  // Low-confidence accounts are held rather than actioned customer-facing.
  if (confidence < minConfidence) {
    return {
      type: "no_action_hold",
      customerFacing: false,
      crmWriteBack: false,
      objective: "Hold: insufficient data confidence to recommend an action.",
    };
  }

  const { type, objective } = pickType(ctx, reasonCodes);
  return {
    type,
    customerFacing: CUSTOMER_FACING.has(type),
    crmWriteBack: CRM_WRITE_BACK.has(type),
    objective,
  };
}
