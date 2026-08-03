import type { ReasonCode, SourceSignal } from "@repo/shared-schemas";
import { RUNTIME_CONFIG } from "../../../config/runtime";
import {
  effectiveOpenPipelineUsd,
  type AccountContext,
  type AccountFeatures,
} from "../prioritizer.policy";
import { resolveVerifiedIntentObservations } from "./resolve-verified-intent-observations";

/**
 * discover-account-signals — builds the verified evidence set.
 *
 * Every signal is derived only from source-supported records. Feature
 * availability is authoritative. A normalized default must not become evidence
 * when the connector declared that feature unavailable.
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
    features.availability.pipeline &&
    openPipelineUsd >= cfg.highPipelineThresholdUsd
  ) {
    signals.push({
      kind: "account",
      refId: a.id,
      description: `Open pipeline of $${openPipelineUsd.toLocaleString("en-US")}.`,
      verified: true,
    });
  }

  if (features.availability.intent) {
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

  if (features.availability.pipeline) {
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
  }

  if (
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

  // Guarantee one verified signal. A neutral hold cites the deterministic policy
  // result. Other cases cite only source-supported account identity facts.
  if (signals.length === 0) {
    if (reasonCodes.includes("no_qualifying_signal")) {
      signals.push({
        kind: "derived",
        refId: a.id,
        description: "No configured priority predicate was satisfied for this account.",
        verified: true,
      });
    } else {
      signals.push({
        kind: "account",
        refId: a.id,
        description: `Account ${a.name} is owned by ${a.ownerId}.`,
        verified: true,
      });
    }
  }

  return signals;
}
