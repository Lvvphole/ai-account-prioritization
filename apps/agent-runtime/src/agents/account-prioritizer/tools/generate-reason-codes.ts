import type { ReasonCode } from "@repo/shared-schemas";
import { RUNTIME_CONFIG } from "../../../config/runtime";
import type { AccountContext, AccountFeatures } from "../prioritizer.policy";

/**
 * generate-reason-codes — DETERMINISTIC mapping from facts to a CLOSED set of
 * reason codes. The LLM may only narrate these; it cannot invent new ones.
 * Always returns at least one code.
 */
export function generateReasonCodes(
  ctx: AccountContext,
  features: AccountFeatures,
): ReasonCode[] {
  const cfg = RUNTIME_CONFIG;
  const a = ctx.account;
  const codes = new Set<ReasonCode>();

  if (a.openPipelineUsd >= cfg.highPipelineThresholdUsd) codes.add("high_open_pipeline");
  if (a.intentSignals.length > 0) codes.add("verified_intent_signal");
  if (
    a.daysSinceLastContact !== undefined &&
    a.daysSinceLastContact >= cfg.staleContactThresholdDays
  ) {
    codes.add("stale_no_contact");
  }
  if (a.lifecycleStage === "renewal") codes.add("renewal_approaching");
  if (a.lifecycleStage === "churn_risk") codes.add("churn_risk_detected");
  if (a.healthScore !== undefined && a.healthScore < cfg.churnRiskHealthThreshold) {
    codes.add("churn_risk_detected");
  }
  if (a.tier === "strategic") codes.add("strategic_tier_account");
  if (
    ctx.opportunities.some(
      (o) => !o.isClosed && (o.stage === "proposal" || o.stage === "negotiation"),
    )
  ) {
    codes.add("stalled_opportunity");
  }
  if (
    ctx.contacts.some((c) => c.role === "economic_buyer" && c.lastEngagedAt !== undefined)
  ) {
    codes.add("new_executive_buyer");
  }
  if (a.dataQualityFlags.length > 0) codes.add("data_quality_blocked");

  // Fallback: never return an empty set. Pick the strongest feature's code.
  if (codes.size === 0) {
    const ranked: [keyof AccountFeatures, ReasonCode][] = [
      ["pipeline", "high_open_pipeline"],
      ["healthRisk", "churn_risk_detected"],
      ["staleness", "stale_no_contact"],
      ["tier", "strategic_tier_account"],
    ];
    const best = ranked
      .map(([f, code]) => ({ value: features[f], code }))
      .sort((x, y) => y.value - x.value)[0];
    codes.add(best ? best.code : "stale_no_contact");
  }

  return [...codes];
}
