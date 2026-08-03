import type {
  Account,
  Activity,
  Contact,
  CrmSourceCapabilities,
  FeatureStatus,
  Opportunity,
} from "@repo/shared-schemas";
import { RUNTIME_CONFIG, type ScoringWeights } from "../../config/runtime";
import { resolveVerifiedIntentObservations } from "./tools/resolve-verified-intent-observations";

/**
 * Prioritizer policy — pure, deterministic feature extraction.
 *
 * This module is the boundary between CRM facts and numeric decision features.
 * NO LLM, NO randomness, NO clock reads.
 */
export type AccountFeatureName = keyof ScoringWeights;
export type AccountFeatureModes = Readonly<Record<AccountFeatureName, FeatureStatus>>;

export const PIPELINE_DERIVATION_VERSION = "open-opportunity-sum-usd-cents-v2";
const USD_MINOR_UNITS_PER_DOLLAR = 100n;

export interface AccountContext {
  account: Account;
  contacts: Contact[];
  opportunities: Opportunity[];
  activities: Activity[];
  sourceCapabilities?: CrmSourceCapabilities;
  featureModes?: AccountFeatureModes;
}

export interface AccountFeatures {
  pipeline: number;
  intent: number;
  staleness: number;
  tier: number;
  lifecycle: number;
  healthRisk: number;
  availability: Record<AccountFeatureName, boolean>;
}

export interface DerivedPipelineContribution {
  opportunityId: string;
  amountMinorUnits: bigint;
}

export interface DerivedPipelineEvidence {
  derivationVersion: typeof PIPELINE_DERIVATION_VERSION;
  totalMinorUnits: bigint;
  totalUsd: number;
  contributions: DerivedPipelineContribution[];
}

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function featureModeAllows(ctx: AccountContext, featureName: AccountFeatureName): boolean {
  return ctx.featureModes?.[featureName] !== "unavailable";
}

export function contactEvidenceIsSupported(ctx: AccountContext): boolean {
  return ctx.sourceCapabilities?.contacts !== false;
}

function featureIsSupported(
  ctx: AccountContext,
  featureName: AccountFeatureName,
  inferredAvailability: boolean,
): boolean {
  return featureModeAllows(ctx, featureName) && inferredAvailability;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toUsdMinorUnits(amountUsd: number, evidenceId: string): bigint {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    throw new Error(`Pipeline amount for ${evidenceId} must be a finite non-negative USD value.`);
  }

  const decimal = amountUsd.toString();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!match) {
    throw new Error(`Pipeline amount for ${evidenceId} must use plain decimal USD notation.`);
  }

  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > 2) {
    throw new Error(`Pipeline amount for ${evidenceId} must have at most two decimal places.`);
  }

  const cents =
    BigInt(whole) * USD_MINOR_UNITS_PER_DOLLAR +
    BigInt(fraction.padEnd(2, "0") || "0");
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Derived open pipeline exceeds safe integer minor-unit precision.");
  }
  return cents;
}

/** Locale-independent display for authoritative USD evidence. */
export function formatUsdMinorUnits(amountMinorUnits: bigint): string {
  if (amountMinorUnits < 0n) throw new Error("USD evidence amount must be non-negative.");
  const whole = (amountMinorUnits / USD_MINOR_UNITS_PER_DOLLAR).toString();
  const fraction = (amountMinorUnits % USD_MINOR_UNITS_PER_DOLLAR).toString().padStart(2, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === "00" ? `$${grouped}` : `$${grouped}.${fraction}`;
}

/**
 * Compute derived pipeline and preserve the exact ordered opportunity references
 * that supplied the authoritative amount.
 */
export function deriveOpenPipelineEvidence(ctx: AccountContext): DerivedPipelineEvidence {
  const openOpportunities = ctx.opportunities
    .filter((opportunity) => !opportunity.isClosed)
    .slice()
    .sort((left, right) => compareOrdinal(left.id, right.id));

  const contributions = openOpportunities.map((opportunity) => ({
    opportunityId: opportunity.id,
    amountMinorUnits: toUsdMinorUnits(opportunity.amountUsd, opportunity.id),
  }));

  let totalMinorUnits = 0n;
  for (const contribution of contributions) {
    totalMinorUnits += contribution.amountMinorUnits;
    if (totalMinorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Derived open pipeline exceeds safe integer minor-unit precision.");
    }
  }

  return {
    derivationVersion: PIPELINE_DERIVATION_VERSION,
    totalMinorUnits,
    totalUsd: Number(totalMinorUnits) / Number(USD_MINOR_UNITS_PER_DOLLAR),
    contributions,
  };
}

export function effectiveOpenPipelineUsd(ctx: AccountContext): number {
  return ctx.featureModes?.pipeline === "derived"
    ? deriveOpenPipelineEvidence(ctx).totalUsd
    : ctx.account.openPipelineUsd;
}

export function extractFeatures(ctx: AccountContext): AccountFeatures {
  const cfg = RUNTIME_CONFIG;
  const a = ctx.account;
  const openPipelineUsd = effectiveOpenPipelineUsd(ctx);
  const pipeline = clamp01(openPipelineUsd / cfg.pipelineSaturationUsd);
  const verifiedIntentCount = resolveVerifiedIntentObservations(a, ctx.activities).length;
  const intent = clamp01(verifiedIntentCount / cfg.intentSaturationCount);
  const daysSinceLastContact = a.daysSinceLastContact;
  const staleness =
    daysSinceLastContact === undefined
      ? 0
      : clamp01(daysSinceLastContact / cfg.stalenessSaturationDays);
  const tier = cfg.tierWeights[a.tier] ?? 0.3;
  const lifecycle = cfg.lifecycleWeights[a.lifecycleStage] ?? 0.4;
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
      staleness: featureIsSupported(ctx, "staleness", daysSinceLastContact !== undefined),
      tier: featureIsSupported(ctx, "tier", true),
      lifecycle: featureIsSupported(ctx, "lifecycle", true),
      healthRisk: featureIsSupported(ctx, "healthRisk", healthScore !== undefined),
    },
  };
}

export function computeConfidence(ctx: AccountContext): number {
  const a = ctx.account;
  const hasVerifiedActivity = ctx.activities.some((x) => x.verified);
  const connectorAware = ctx.featureModes !== undefined || ctx.sourceCapabilities !== undefined;
  const stalenessAvailable = featureModeAllows(ctx, "staleness");
  const intentAvailable = featureModeAllows(ctx, "intent");
  const pipelineAvailable = featureModeAllows(ctx, "pipeline");
  const contactsAvailable = contactEvidenceIsSupported(ctx);

  const completenessChecks: boolean[] = [
    a.employeeCount !== undefined,
    a.annualRevenueUsd !== undefined,
    stalenessAvailable &&
      (a.daysSinceLastContact !== undefined || a.lastContactedAt !== undefined),
    contactsAvailable && ctx.contacts.length > 0,
    (intentAvailable || stalenessAvailable) && hasVerifiedActivity,
    connectorAware
      ? pipelineAvailable && ctx.opportunities.length > 0
      : ctx.opportunities.length > 0 || hasVerifiedActivity,
  ];
  const present = completenessChecks.filter(Boolean).length;
  let confidence = present / completenessChecks.length;
  confidence -= a.dataQualityFlags.length * 0.15;
  return clamp01(Math.max(0.05, confidence));
}
