import type { ReasonCode, SourceSignal } from "@repo/shared-schemas";
import { RUNTIME_CONFIG } from "../../../config/runtime";
import {
  contactEvidenceIsSupported,
  deriveOpenPipelineEvidence,
  effectiveOpenPipelineUsd,
  formatUsdAmount,
  formatUsdMinorUnits,
  type AccountContext,
  type AccountFeatures,
} from "../prioritizer.policy";
import { resolveVerifiedIntentObservations } from "./resolve-verified-intent-observations";

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Build verified, deterministic, record-traceable recommendation evidence. */
export function discoverAccountSignals(
  ctx: AccountContext,
  features: AccountFeatures,
  reasonCodes: readonly ReasonCode[] = [],
): SourceSignal[] {
  const cfg = RUNTIME_CONFIG;
  const a = ctx.account;
  const signals: SourceSignal[] = [];
  const supportedReasons = new Set<ReasonCode>();
  const openPipelineUsd = effectiveOpenPipelineUsd(ctx);

  const addSignal = (reason: ReasonCode, signal: SourceSignal): void => {
    signals.push(signal);
    supportedReasons.add(reason);
  };

  if (ctx.featureModes?.pipeline === "derived" && features.availability.pipeline) {
    const evidence = deriveOpenPipelineEvidence(ctx);
    signals.push({
      kind: "derived",
      refId: a.id,
      description: `Derived open pipeline totals ${formatUsdMinorUnits(evidence.totalMinorUnits)} using ${evidence.derivationVersion}.`,
      verified: true,
    });

    const highPipeline =
      reasonCodes.includes("high_open_pipeline") &&
      evidence.totalUsd >= cfg.highPipelineThresholdUsd;

    for (const contribution of evidence.contributions) {
      const signal: SourceSignal = {
        kind: "opportunity",
        refId: contribution.opportunityId,
        description: `Opportunity ${contribution.opportunityId} contributes ${formatUsdMinorUnits(contribution.amountMinorUnits)} to derived open pipeline using ${evidence.derivationVersion}.`,
        verified: true,
      };
      if (highPipeline) addSignal("high_open_pipeline", signal);
      else signals.push(signal);
    }
  } else if (
    reasonCodes.includes("high_open_pipeline") &&
    features.availability.pipeline &&
    openPipelineUsd >= cfg.highPipelineThresholdUsd
  ) {
    addSignal("high_open_pipeline", {
      kind: "derived",
      refId: a.id,
      description: `Open pipeline is ${formatUsdAmount(openPipelineUsd, a.id)}.`,
      verified: true,
    });
  }

  if (reasonCodes.includes("verified_intent_signal") && features.availability.intent) {
    for (const { signalCode, activity } of resolveVerifiedIntentObservations(a, ctx.activities)) {
      addSignal("verified_intent_signal", {
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
    addSignal("stale_no_contact", {
      kind: "derived",
      refId: a.id,
      description: `No logged contact for ${a.daysSinceLastContact} days.`,
      verified: true,
    });
  }

  if (
    reasonCodes.includes("strategic_tier_account") &&
    features.availability.tier &&
    a.tier === "strategic"
  ) {
    addSignal("strategic_tier_account", {
      kind: "account",
      refId: a.id,
      description: `Account tier is ${a.tier}.`,
      verified: true,
    });
  }

  if (
    reasonCodes.includes("renewal_approaching") &&
    features.availability.lifecycle &&
    a.lifecycleStage === "renewal"
  ) {
    addSignal("renewal_approaching", {
      kind: "account",
      refId: a.id,
      description: `Account lifecycle stage is ${a.lifecycleStage}.`,
      verified: true,
    });
  }

  if (
    reasonCodes.includes("churn_risk_detected") &&
    features.availability.lifecycle &&
    a.lifecycleStage === "churn_risk"
  ) {
    addSignal("churn_risk_detected", {
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
    addSignal("churn_risk_detected", {
      kind: "account",
      refId: a.id,
      description: `Account health score is ${a.healthScore} (below churn-risk threshold).`,
      verified: true,
    });
  }

  if (reasonCodes.includes("stalled_opportunity") && features.availability.pipeline) {
    const stalled = ctx.opportunities
      .filter(
        (opp) => !opp.isClosed && (opp.stage === "proposal" || opp.stage === "negotiation"),
      )
      .slice()
      .sort((left, right) => compareOrdinal(left.id, right.id));
    for (const opp of stalled) {
      addSignal("stalled_opportunity", {
        kind: "opportunity",
        refId: opp.id,
        description: `Open opportunity "${opp.name}" is in ${opp.stage} stage and is worth ${formatUsdAmount(opp.amountUsd, opp.id, opp.amountUsdExact)}.`,
        verified: true,
      });
    }
  }

  if (reasonCodes.includes("new_executive_buyer") && contactEvidenceIsSupported(ctx)) {
    const engagedEconomicBuyers = ctx.contacts
      .filter(
        (contact) => contact.role === "economic_buyer" && contact.lastEngagedAt !== undefined,
      )
      .slice()
      .sort((left, right) => compareOrdinal(left.id, right.id));
    for (const contact of engagedEconomicBuyers) {
      addSignal("new_executive_buyer", {
        kind: "contact",
        refId: contact.id,
        description: `Economic buyer ${contact.firstName} ${contact.lastName} has recorded engagement.`,
        verified: true,
      });
    }
  }

  if (reasonCodes.includes("data_quality_blocked")) {
    for (const flag of [...a.dataQualityFlags].sort()) {
      addSignal("data_quality_blocked", {
        kind: "account",
        refId: a.id,
        description: `Account data-quality flag: ${flag}.`,
        verified: true,
      });
    }
  }

  if (reasonCodes.includes("no_qualifying_signal")) {
    addSignal("no_qualifying_signal", {
      kind: "derived",
      refId: a.id,
      description: "No configured priority predicate was satisfied for this account.",
      verified: true,
    });
  }

  const unsupportedReasons = reasonCodes.filter((reason) => !supportedReasons.has(reason));
  if (unsupportedReasons.length > 0) {
    throw new Error(
      `Recommendation reason(s) have no direct source evidence for account ${a.id}: ${unsupportedReasons.join(",")}`,
    );
  }

  return signals;
}
