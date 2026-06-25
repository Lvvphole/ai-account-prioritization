import { RUNTIME_CONFIG } from "../../../config/runtime";
import {
  computeConfidence,
  extractFeatures,
  type AccountContext,
  type AccountFeatures,
} from "../prioritizer.policy";

/**
 * score-accounts — DETERMINISTIC scoring tool (Execution Rules #1, #2).
 *
 * The LLM never calls this with authority to change the result; the score is a
 * pure weighted sum of features. Same input -> same score, always.
 */
export interface ScoredAccount {
  accountId: string;
  ownerId: string;
  score: number;
  confidence: number;
  features: AccountFeatures;
  context: AccountContext;
}

export function scoreAccount(ctx: AccountContext): ScoredAccount {
  const features = extractFeatures(ctx);
  const w = RUNTIME_CONFIG.scoringWeights;

  const weightedSum =
    features.pipeline * w.pipeline +
    features.intent * w.intent +
    features.staleness * w.staleness +
    features.tier * w.tier +
    features.lifecycle * w.lifecycle +
    features.healthRisk * w.healthRisk;

  const totalWeight =
    w.pipeline + w.intent + w.staleness + w.tier + w.lifecycle + w.healthRisk;

  // Normalize to 0-100 and round to 2 decimals for stable, comparable output.
  const score = Math.round((weightedSum / totalWeight) * 10000) / 100;

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
