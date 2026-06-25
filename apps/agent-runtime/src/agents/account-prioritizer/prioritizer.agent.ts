import type { Recommendation } from "@repo/shared-schemas";
import { RUNTIME_CONFIG } from "../../config/runtime";
import type { AccountContext } from "./prioritizer.policy";
import { scoreAccounts } from "./tools/score-accounts";
import { rankAccounts, type RankedAccount } from "./tools/rank-accounts";
import { discoverAccountSignals } from "./tools/discover-account-signals";
import { generateReasonCodes } from "./tools/generate-reason-codes";
import { selectNextBestAction } from "./tools/select-next-best-action";
import { REASON_CODE_PHRASES } from "./prioritizer.prompt";

/**
 * Account Prioritizer agent.
 *
 * Pipeline: score -> rank -> (per account) discover signals -> reason codes ->
 * next best action -> deterministic narrative. Produces CANDIDATE
 * recommendations with verification left pending; the orchestrator runs the
 * guardrail verification and decides publish/block.
 *
 * The narrative here is template-built from reason codes + verified signals only
 * (no free-form LLM text in the runtime path), guaranteeing it never contains
 * fabricated or unsupported claims.
 */
function buildNarrative(ranked: RankedAccount, reasonCodes: string[]): string {
  const phrases = reasonCodes
    .map((c) => REASON_CODE_PHRASES[c])
    .filter((p): p is string => Boolean(p));
  const name = ranked.context.account.name;
  const lead =
    phrases.length > 0
      ? `${name} ${phrases.join(", ")}.`
      : `${name} is a current priority.`;
  return `Priority #${ranked.rank} (score ${ranked.score}). ${lead}`;
}

export interface PrioritizeArgs {
  runId: string;
  contexts: AccountContext[];
  createdAt: string;
}

export function prioritizeAccounts(args: PrioritizeArgs): Recommendation[] {
  const scored = scoreAccounts(args.contexts);
  const ranked = rankAccounts(scored);

  return ranked.map((r) => {
    const sourceSignals = discoverAccountSignals(r.context);
    const reasonCodes = generateReasonCodes(r.context, r.features);
    const nextBestAction = selectNextBestAction(
      r.context,
      reasonCodes,
      r.confidence,
      RUNTIME_CONFIG.minPublishableConfidence,
    );

    const rec: Recommendation = {
      id: `rec_${args.runId}_${r.accountId}`,
      runId: args.runId,
      accountId: r.accountId,
      ownerId: r.ownerId,
      score: r.score,
      rank: r.rank,
      confidence: r.confidence,
      reasonCodes,
      reasonNarrative: buildNarrative(r, reasonCodes),
      sourceSignals,
      nextBestAction,
      // Verification is filled in by the orchestrator's guardrail pass.
      verification: {
        status: "pending",
        schemaValid: false,
        guardrailsPassed: false,
        sourceSignalsVerified: false,
        permissionGranted: false,
        failedGates: [],
        checkedAt: args.createdAt,
      },
      approvalStatus:
        nextBestAction.customerFacing || nextBestAction.crmWriteBack
          ? "pending_approval"
          : "not_required",
      published: false,
      createdAt: args.createdAt,
    };
    return rec;
  });
}
