import type { ReasonCode } from "@repo/shared-schemas";
import { RUNTIME_CONFIG } from "../../../config/runtime";
import type { AccountContext, AccountFeatures } from "../prioritizer.policy";
import { resolveVerifiedIntentObservations } from "./resolve-verified-intent-observations";

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

  if (
    features.availability.pipeline &&
    a.openPipelineUsd >= cfg.highPipelineThresholdUsd
  ) {
    codes.add("high_open_pipeline");
  }
  if (
    features.availability.intent &&
    resolveVerifiedIntentObservations(a, ctx.activities).length > 0
  ) {
    codes.add("verified_intent_signal");
  }
  if (
    features.availability.staleness &&
    a.daysSinceLastContact !== undefined &&
    a.daysSinceLastContact >= cfg.staleContactThresholdDays
  ) {
    codes.add("stale_no_contact");
  }
  if (features.availability.lifecycle && a.lifecycleStage === "renewal") {
    codes.add("renewal_approaching");
  }
  if (features.availability.lifecycle && a.lifecycleStage === "churn_risk") {
    codes.add("churn_risk_detected");
  }
  if (
    features.availability.healthRisk &&
    a.healthScore !== undefined &&
    a.healthScore < cfg.churnRiskHealthThreshold
  ) {
    codes.add("churn_risk_detected");
  }
  if (features.availability.tier && a.tier === "strategic") {
    codes.add("strategic_tier_account");
  }
  if (
    features.availability.pipeline &&
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

  // A complete low-signal account is not a data-quality failure. Preserve the
  // schema invariant with an explicit neutral policy result that maps to hold.
  if (codes.size === 0) codes.add("no_qualifying_signal");

  return [...codes];
}
