import type { Account, Activity, Contact, Opportunity } from "@repo/shared-schemas";
import { RUNTIME_CONFIG } from "../../config/runtime";

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

export interface AccountFeatures {
  pipeline: number;
  intent: number;
  staleness: number;
  tier: number;
  lifecycle: number;
  healthRisk: number;
}

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export function extractFeatures(ctx: AccountContext): AccountFeatures {
  const cfg = RUNTIME_CONFIG;
  const a = ctx.account;

  const pipeline = clamp01(a.openPipelineUsd / cfg.pipelineSaturationUsd);
  const intent = clamp01(a.intentSignals.length / cfg.intentSaturationCount);

  // Missing contact data is treated as maximally stale (worst case) by design.
  const days =
    a.daysSinceLastContact ?? cfg.stalenessSaturationDays;
  const staleness = clamp01(days / cfg.stalenessSaturationDays);

  const tier = cfg.tierWeights[a.tier] ?? 0.3;
  const lifecycle = cfg.lifecycleWeights[a.lifecycleStage] ?? 0.4;

  // Lower health => higher priority. Unknown health is neutral (0.5).
  const healthRisk =
    a.healthScore === undefined ? 0.5 : clamp01((100 - a.healthScore) / 100);

  return { pipeline, intent, staleness, tier, lifecycle, healthRisk };
}

/**
 * Confidence reflects how much we trust this recommendation given data
 * completeness and signal verification. Deterministic, bounded [0,1].
 */
export function computeConfidence(ctx: AccountContext): number {
  const a = ctx.account;
  const completenessChecks: boolean[] = [
    a.employeeCount !== undefined,
    a.annualRevenueUsd !== undefined,
    a.lastContactedAt !== undefined,
    a.healthScore !== undefined,
    ctx.contacts.length > 0,
    ctx.activities.some((x) => x.verified),
  ];
  const present = completenessChecks.filter(Boolean).length;
  let confidence = present / completenessChecks.length;

  // Each data-quality flag erodes confidence; never below a small floor.
  confidence -= a.dataQualityFlags.length * 0.15;
  return clamp01(Math.max(0.05, confidence));
}
