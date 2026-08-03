import type { Account, Activity, Contact, Opportunity } from "@repo/shared-schemas";
import { RUNTIME_CONFIG, type ScoringWeights } from "../../config/runtime";
import { resolveVerifiedIntentObservations } from "./tools/resolve-verified-intent-observations";

/**
 * Prioritizer policy — pure, deterministic feature extraction.
 *
 * This module is the boundary between messy CRM facts and the numeric features
 * the scorer consumes. NO LLM, NO randomness, NO clock reads. Everything is a
 * deterministic function of the inputs and the runtime config.
 */
export interface AccountContext {
  account: Account;
  contacts: Contact[];
  opportunities: Opportunity[];
  activities: Activity[];
}

export type AccountFeatureName = keyof ScoringWeights;

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

export function extractFeatures(ctx: AccountContext): AccountFeatures {
  const cfg = RUNTIME_CONFIG;
  const a = ctx.account;

  const pipeline = clamp01(a.openPipelineUsd / cfg.pipelineSaturationUsd);
  // Account intent codes influence authority only when each code can be traced
  // back to a matching verified intent-event observation.
  const verifiedIntentCount = resolveVerifiedIntentObservations(a, ctx.activities).length;
  const intent = clamp01(verifiedIntentCount / cfg.intentSaturationCount);

  // Missing contact history is unavailable evidence. It is not maximal staleness.
  const daysSinceLastContact = a.daysSinceLastContact;
  const stalenessAvailable = daysSinceLastContact !== undefined;
  const staleness =
    daysSinceLastContact === undefined
      ? 0
      : clamp01(daysSinceLastContact / cfg.stalenessSaturationDays);

  const tier = cfg.tierWeights[a.tier] ?? 0.3;
  const lifecycle = cfg.lifecycleWeights[a.lifecycleStage] ?? 0.4;

  // Health is not a common CRM field. Missing health is unavailable evidence,
  // not an invented neutral score. The scorer removes its weight for this row.
  const healthScore = a.healthScore;
  const healthAvailable = healthScore !== undefined;
  const healthRisk = healthScore === undefined ? 0 : clamp01((100 - healthScore) / 100);

  return {
    pipeline,
    intent,
    staleness,
    tier,
    lifecycle,
    healthRisk,
    availability: {
      pipeline: true,
      intent: true,
      staleness: stalenessAvailable,
      tier: true,
      lifecycle: true,
      healthRisk: healthAvailable,
    },
  };
}

/**
 * Confidence reflects how much we trust this recommendation given data
 * completeness and signal verification. Deterministic, bounded [0,1].
 *
 * Optional enrichment fields, such as an external health score, do not reduce
 * confidence merely because a CRM does not supply them. Core account evidence
 * remains fail-closed when contacts, activity, opportunity, and firmographic
 * context are too sparse.
 */
export function computeConfidence(ctx: AccountContext): number {
  const a = ctx.account;
  const hasVerifiedActivity = ctx.activities.some((x) => x.verified);
  const completenessChecks: boolean[] = [
    a.employeeCount !== undefined,
    a.annualRevenueUsd !== undefined,
    a.daysSinceLastContact !== undefined || a.lastContactedAt !== undefined,
    ctx.contacts.length > 0,
    hasVerifiedActivity,
    ctx.opportunities.length > 0 || hasVerifiedActivity,
  ];
  const present = completenessChecks.filter(Boolean).length;
  let confidence = present / completenessChecks.length;

  // Each data-quality flag erodes confidence; never below a small floor.
  confidence -= a.dataQualityFlags.length * 0.15;
  return clamp01(Math.max(0.05, confidence));
}
