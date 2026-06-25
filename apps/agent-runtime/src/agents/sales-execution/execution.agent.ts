import type { Recommendation } from "@repo/shared-schemas";
import type { AccountContext } from "../account-prioritizer/prioritizer.policy";
import { generateCallObjective } from "./tools/generate-call-objective";
import { generateEmailDraft } from "./tools/generate-email-draft";
import { generateCrmNote } from "./tools/generate-crm-note";

/**
 * Sales Execution agent.
 *
 * Attaches a deterministic draft to a recommendation's next-best-action based on
 * the action type. Drafts are generated from verified signals only; nothing here
 * sends anything — customer-facing/CRM actions remain approval-gated.
 */
export function attachActionDraft(
  rec: Recommendation,
  ctx: AccountContext,
): Recommendation {
  const primaryContact = ctx.contacts.find((c) => c.isPrimary) ?? ctx.contacts[0];
  const action = rec.nextBestAction;
  let draft: string | undefined;

  switch (action.type) {
    case "call":
    case "schedule_meeting":
      draft = generateCallObjective({
        account: ctx.account,
        objective: action.objective,
        signals: rec.sourceSignals,
      });
      break;
    case "send_email":
      draft = generateEmailDraft({
        account: ctx.account,
        primaryContact,
        repId: rec.ownerId,
      });
      break;
    case "log_research_note":
      draft = generateCrmNote({
        account: ctx.account,
        reasonCodes: rec.reasonCodes,
        signals: rec.sourceSignals,
        score: rec.score,
        rank: rec.rank,
      });
      break;
    case "request_intro":
    case "escalate_to_manager":
    case "no_action_hold":
    default:
      draft = undefined;
  }

  return { ...rec, nextBestAction: { ...action, draft } };
}
