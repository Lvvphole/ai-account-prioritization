import type { ReasonCode, SourceSignal } from "@repo/shared-schemas";
import { RUNTIME_CONFIG } from "../../../config/runtime";
import {
  contactEvidenceIsSupported,
  effectiveOpenPipelineUsd,
  type AccountContext,
  type AccountFeatures,
} from "../prioritizer.policy";
import { resolveVerifiedIntentObservations } from "./resolve-verified-intent-observations";

/**
 * discover-account-signals — builds the verified evidence set.
 *
 * Every authoritative reason must have a source signal that directly supports
 * its predicate. An unrelated account-identity signal cannot satisfy grounding.
 */
export function discoverAccountSignals(
  ctx: AccountContext,
  features: AccountFeatures,
  reasonCodes: readonly ReasonCode[] = [],
): SourceSignal[] {
  const cfg = RUNTIME_CONFIG;
  const a = ctx.account;
  const signals: SourceSignal[] = [];
  const openPipelineUsd = effectiveOpenPipelineUsd(ctx);

  if (
    reasonCodes.includes("high_open_pipeline") &&
    features.availability.pipeline &&
    openPipelineUsd >= cfg.highPipelineThresholdUsd
  ) {
    signals.push({
      kind: "derived",
      refId: a.id,
      description: `Open pipeline is $${openPipelineUsd.toLocaleString("en-US")}.`,
      verified: true,
    });
  }

  if (reasonCodes.includes("verified_intent_signal") && features.availability.intent) {
    for (const { signalCode, activity } of resolveVerifiedIntentObservations(a, ctx.activities)) {
      signals.push({
        kind: "intent",
        refId: activity.id,
        description: `Verified intent signal: ${signalCode}.`,
        verified: true,
      });
    }
  }

  if (
    reasonCodes.includes("stale_no_contact") &&
    features.availability.staleness &&
    a.daysSinceLastContact !== undefined &&
    a.daysSinceLastContact >= cfg.staleContactThresholdDays
  ) {
    signals.push({
      kind: "derived",
      refId: a.id,
      description: `No logged contact for ${a.daysSinceLastContact} days.`,
      verified: true,
    });
  }

  if (reasonCodes.includes("strategic_tier_account") && features.availability.tier) {
    signals.push({
      kind: "account",
      refId: a.id,
      description: `Account tier is ${a.tier}.`,
      verified: true,
    });
  }

  if (
    (reasonCodes.includes("renewal_approaching") || reasonCodes.includes("churn_risk_detected")) &&
    features.availability.lifecycle &&
    (a.lifecycleStage === "renewal" || a.lifecycleStage === "churn_risk")
  ) {
    signals.push({
      kind: "account",
      refId: a.id,
      description: `Account lifecycle stage is ${a.lifecycleStage}.`,
      verified: true,
    });
  }

  if (
    reasonCodes.includes("churn_risk_detected") &&
    features.availability.healthRisk &&
    a.healthScore !== undefined &&
    a.healthScore < cfg.churnRiskHealthThreshold
  ) {
    signals.push({
      kind: "account",
      refId: a.id,
      description: `Account health score is ${a.healthScore} (below churn-risk threshold).`,
      verified: true,
    });
  }

  if (reasonCodes.includes("stalled_opportunity") && features.availability.pipeline) {
    for (const opp of ctx.opportunities) {
      if (!opp.isClosed && (opp.stage === "proposal" || opp.stage === "negotiation")) {
        signals.push({
          kind: "opportunity",
          refId: opp.id,
          description: `Open opportunity "${opp.name}" is in ${opp.stage} stage and is worth $${opp.amountUsd.toLocaleString("en-US")}.`,
          verified: true,
        });
      }
    }
  }

  if (reasonCodes.includes("new_executive_buyer") && contactEvidenceIsSupported(ctx)) {
    for (const contact of ctx.contacts) {
      if (contact.role === "economic_buyer" && contact.lastEngagedAt !== undefined) {
        signals.push({
          kind: "contact",
          refId: contact.id,
          description: `Economic buyer ${contact.firstName} ${contact.lastName} has recorded engagement.`,
          verified: true,
        });
      }
    }
  }

  if (reasonCodes.includes("data_quality_blocked")) {
    for (const flag of [...a.dataQualityFlags].sort()) {
      signals.push({
        kind: "account",
        refId: a.id,
        description: `Account data-quality flag: ${flag}.`,
        verified: true,
      });
    }
  }

  if (reasonCodes.includes("no_qualifying_signal")) {
    signals.push({
      kind: "derived",
      refId: a.id,
      description: "No configured priority predicate was satisfied for this account.",
      verified: true,
    });
  }

  // Fail closed if a future reason is added without direct evidence support.
  if (signals.length === 0) {
    throw new Error(
      `Recommendation reasons have no direct source evidence for account ${a.id}: ${reasonCodes.join(",")}`,
    );
  }

  return signals;
}
