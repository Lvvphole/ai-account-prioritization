import type {
  Account,
  Activity,
  Contact,
  FeatureStatus,
  Opportunity,
} from "@repo/shared-schemas";
import { RUNTIME_CONFIG, type ScoringWeights } from "../../config/runtime";
import { resolveVerifiedIntentObservations } from "./tools/resolve-verified-intent-observations";

/**
 * Prioritizer policy — pure, deterministic feature extraction.
 *
 * This module is the boundary between messy CRM facts and the numeric features
 * the scorer consumes. NO LLM, NO randomness, NO clock reads. Everything is a
 * deterministic function of the inputs and the runtime config.
 */
export type AccountFeatureName = keyof ScoringWeights;
export type AccountFeatureModes = Readonly<Record<AccountFeatureName, FeatureStatus>>;

export const PIPELINE_DERIVATION_VERSION = "open-opportunity-sum-v1";

export interface AccountContext {
  account: Account;
  contacts: Contact[];
  opportunities: Opportunity[];
  activities: Activity[];
  /**
   * Connector or record provenance for each scoring feature. When present,
   * `unavailable` removes the feature from scoring, confidence, and reason generation.
   */
  featureModes?: AccountFeatureModes;
}

export interface AccountFeatures {
  pipeline: number;
  intent: number;
  staleness: number;
  tier: number;
  lifecycle: number;
  healthRisk: number;
  /** False means that the source did not provide enough evidence for the feature. */
  availability: Record<AccountFeatureName, boolean>;
}

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function featureModeAllows(ctx: AccountContext, featureName: AccountFeatureName): boolean {
  return ctx.featureModes?.[featureName] !== "unavailable";
}

function featureIsSupported(
  ctx: AccountContext,
  featureName: AccountFeatureName,
  inferredAvailability: boolean,
): boolean {
  return featureModeAllows(ctx, featureName) && inferredAvailability;
}

/**
 * Resolve the authoritative open-pipeline amount for this scoring context.
 *
 * A connector that declares pipeline as `derived` supplies opportunity records,
 * not an authoritative account-level aggregate. In that mode, sum only open
 * opportunities. Direct/current-contract contexts keep the canonical account
 * aggregate so existing offline and regression inputs remain unchanged.
 */
export function effectiveOpenPipelineUsd(ctx: AccountContext): number {
  if (ctx.featureModes?.pipeline === "derived") {
    return ctx.opportunities
      .filter((opportunity) => !opportunity.isClosed)
      .reduce((sum, opportunity) => sum + opportunity.amountUsd, 0);
  }
  return ctx.account.openPipelineUsd;
}

export function extractFeatures(ctx: AccountContext): AccountFeatures {
  const cfg = RUNTIME_CONFIG;
  const a = ctx.account;

  const openPipelineUsd = effectiveOpenPipelineUsd(ctx);
  const pipeline = clamp01(openPipelineUsd / cfg.pipelineSaturationUsd);
  // Account intent codes influence authority only when each code can be traced
  // back to a matching verified intent-event observation.
  const verifiedIntentCount = resolveVerifiedIntentObservations(a, ctx.activities).length;
  const intent = clamp01(verifiedIntentCount / cfg.intentSaturationCount);

  // Missing contact history is unavailable evidence. It is not maximal staleness.
  const daysSinceLastContact = a.daysSinceLastContact;
  const staleness =
    daysSinceLastContact === undefined
      ? 0
      : clamp01(daysSinceLastContact / cfg.stalenessSaturationDays);

  const tier = cfg.tierWeights[a.tier] ?? 0.3;
  const lifecycle = cfg.lifecycleWeights[a.lifecycleStage] ?? 0.4;

  // Health is not a common CRM field. Missing health is unavailable evidence,
  // not an invented neutral score. The scorer removes its weight for this row.
  const healthScore = a.healthScore;
  const healthRisk = healthScore === undefined ? 0 : clamp01((100 - healthScore) / 100);

  return {
    pipeline,
    intent,
    staleness,
    tier,
    lifecycle,
    healthRisk,
    availability: {
      pipeline: featureIsSupported(ctx, "pipeline", true),
      intent: featureIsSupported(ctx, "intent", true),
      staleness: featureIsSupported(
        ctx,
        "staleness",
        daysSinceLastContact !== undefined,
      ),
      tier: featureIsSupported(ctx, "tier", true),
      lifecycle: featureIsSupported(ctx, "lifecycle", true),
      healthRisk: featureIsSupported(ctx, "healthRisk", healthScore !== undefined),
    },
  };
}

/**
 * Confidence reflects how much we trust this recommendation given data
 * completeness and signal verification. Deterministic, bounded [0,1].
 *
 * Optional or unsupported evidence cannot increase confidence. Current-contract
 * contexts without an explicit capability map keep the existing completeness
 * policy for deterministic regression compatibility. Connector-aware contexts
 * gate each affected completeness check with the same feature availability used
 * by scoring.
 */
export function computeConfidence(ctx: AccountContext): number {
  const a = ctx.account;
  const hasVerifiedActivity = ctx.activities.some((x) => x.verified);
  const connectorAware = ctx.featureModes !== undefined;
  const stalenessAvailable = featureModeAllows(ctx, "staleness");
  const intentAvailable = featureModeAllows(ctx, "intent");
  const pipelineAvailable = featureModeAllows(ctx, "pipeline");

  const completenessChecks: boolean[] = [
    a.employeeCount !== undefined,
    a.annualRevenueUsd !== undefined,
    stalenessAvailable &&
      (a.daysSinceLastContact !== undefined || a.lastContactedAt !== undefined),
    ctx.contacts.length > 0,
    (intentAvailable || stalenessAvailable) && hasVerifiedActivity,
    connectorAware
      ? pipelineAvailable && ctx.opportunities.length > 0
      : ctx.opportunities.length > 0 || hasVerifiedActivity,
  ];
  const present = completenessChecks.filter(Boolean).length;
  let confidence = present / completenessChecks.length;

  // Each data-quality flag erodes confidence; never below a small floor.
  confidence -= a.dataQualityFlags.length * 0.15;
  return clamp01(Math.max(0.05, confidence));
}
