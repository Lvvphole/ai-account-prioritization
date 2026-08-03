import { RUNTIME_CONFIG } from "../../../config/runtime";
import {
  computeConfidence,
  extractFeatures,
  type AccountContext,
  type AccountFeatureName,
  type AccountFeatures,
} from "../prioritizer.policy";

/**
 * score-accounts — DETERMINISTIC scoring tool (Execution Rules #1, #2).
 *
 * The LLM never calls this with authority to change the result; the score is a
 * pure weighted sum of source-supported features. Same input -> same score.
 */
export interface ScoredAccount {
  accountId: string;
  ownerId: string;
  score: number;
  confidence: number;
  features: AccountFeatures;
  context: AccountContext;
}

const FEATURE_NAMES: AccountFeatureName[] = [
  "pipeline",
  "intent",
  "staleness",
  "tier",
  "lifecycle",
  "healthRisk",
];

export function scoreAccount(ctx: AccountContext): ScoredAccount {
  const features = extractFeatures(ctx);
  const weights = RUNTIME_CONFIG.scoringWeights;

  let weightedSum = 0;
  let availableWeight = 0;
  for (const featureName of FEATURE_NAMES) {
    if (!features.availability[featureName]) continue;
    weightedSum += features[featureName] * weights[featureName];
    availableWeight += weights[featureName];
  }

  if (availableWeight <= 0) {
    throw new Error("Cannot score an account without an available scoring feature.");
  }

  // Normalize only across source-supported features. Missing optional CRM data
  // cannot silently become a fabricated neutral or risk signal.
  const score = Math.round((weightedSum / availableWeight) * 10000) / 100;

  return {
    accountId: ctx.account.id,
    ownerId: ctx.account.ownerId,
    score,
    confidence: computeConfidence(ctx),
    features,
    context: ctx,
  };
}

export function scoreAccounts(contexts: AccountContext[]): ScoredAccount[] {
  return contexts.map(scoreAccount);
}
