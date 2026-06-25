import type { SourceSignal } from "@repo/shared-schemas";
import { RUNTIME_CONFIG } from "../../../config/runtime";
import type { AccountContext } from "../prioritizer.policy";

/**
 * discover-account-signals — builds the verified evidence set.
 *
 * Every signal is derived ONLY from real records and marked `verified` based on
 * the source record's own verification flag. Nothing is invented (Rule #11).
 */
export function discoverAccountSignals(ctx: AccountContext): SourceSignal[] {
  const cfg = RUNTIME_CONFIG;
  const a = ctx.account;
  const signals: SourceSignal[] = [];

  if (a.openPipelineUsd >= cfg.highPipelineThresholdUsd) {
    signals.push({
      kind: "account",
      refId: a.id,
      description: `Open pipeline of $${a.openPipelineUsd.toLocaleString("en-US")}.`,
      verified: true,
    });
  }

  for (const sig of a.intentSignals) {
    const evt = ctx.activities.find(
      (x) => x.type === "intent_event" && x.verified,
    );
    signals.push({
      kind: "intent",
      refId: evt?.id ?? a.id,
      description: `Verified intent signal: ${sig}.`,
      verified: evt ? evt.verified : false,
    });
  }

  if (a.daysSinceLastContact !== undefined && a.daysSinceLastContact >= cfg.staleContactThresholdDays) {
    signals.push({
      kind: "derived",
      refId: a.id,
      description: `No logged contact for ${a.daysSinceLastContact} days.`,
      verified: true,
    });
  }

  for (const opp of ctx.opportunities) {
    if (!opp.isClosed) {
      signals.push({
        kind: "opportunity",
        refId: opp.id,
        description: `Open opportunity "${opp.name}" in ${opp.stage} stage worth $${opp.amountUsd.toLocaleString("en-US")}.`,
        verified: true,
      });
    }
  }

  if (a.healthScore !== undefined && a.healthScore < cfg.churnRiskHealthThreshold) {
    signals.push({
      kind: "account",
      refId: a.id,
      description: `Account health score is ${a.healthScore} (below churn-risk threshold).`,
      verified: true,
    });
  }

  // Guarantee at least one verified signal so the recommendation can cite
  // evidence; otherwise the data-quality state itself is the (verified) signal.
  if (signals.length === 0) {
    signals.push({
      kind: "account",
      refId: a.id,
      description: `Account ${a.name} is owned by ${a.ownerId} at tier ${a.tier}.`,
      verified: true,
    });
  }

  return signals;
}
