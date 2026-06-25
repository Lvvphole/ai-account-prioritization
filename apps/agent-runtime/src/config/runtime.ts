/**
 * Deterministic runtime configuration.
 *
 * Every constant that influences scoring, ranking, and gating lives here so the
 * core loop is auditable and reproducible. Changing a weight is a config change,
 * never a code change inside the scorer. The LLM has NO access to these values.
 */

export interface ScoringWeights {
  pipeline: number;
  intent: number;
  staleness: number;
  tier: number;
  lifecycle: number;
  healthRisk: number;
}

export interface RuntimeConfig {
  /** Max recommendations published per run (after ranking). */
  maxRecommendations: number;
  /** USD pipeline value that saturates the pipeline feature to 1.0. */
  pipelineSaturationUsd: number;
  /** Days-since-contact that saturates the staleness feature to 1.0. */
  stalenessSaturationDays: number;
  /** Days-since-contact above which `stale_no_contact` reason code applies. */
  staleContactThresholdDays: number;
  /** Open pipeline at/above which `high_open_pipeline` reason code applies. */
  highPipelineThresholdUsd: number;
  /** Health score below which `churn_risk_detected` reason code applies. */
  churnRiskHealthThreshold: number;
  /** Intent signal count that saturates the intent feature to 1.0. */
  intentSaturationCount: number;
  /** Minimum confidence below which a recommendation is held (no_action_hold). */
  minPublishableConfidence: number;
  scoringWeights: ScoringWeights;
  tierWeights: Record<string, number>;
  lifecycleWeights: Record<string, number>;
}

export const RUNTIME_CONFIG: RuntimeConfig = {
  maxRecommendations: 25,
  pipelineSaturationUsd: 250_000,
  stalenessSaturationDays: 30,
  staleContactThresholdDays: 14,
  highPipelineThresholdUsd: 50_000,
  churnRiskHealthThreshold: 40,
  intentSaturationCount: 3,
  minPublishableConfidence: 0.2,
  scoringWeights: {
    pipeline: 0.25,
    intent: 0.2,
    staleness: 0.15,
    tier: 0.15,
    lifecycle: 0.15,
    healthRisk: 0.1,
  },
  tierWeights: {
    strategic: 1.0,
    enterprise: 0.8,
    mid_market: 0.5,
    smb: 0.3,
  },
  lifecycleWeights: {
    churn_risk: 1.0,
    renewal: 0.9,
    open_opportunity: 0.8,
    prospect: 0.5,
    customer: 0.4,
    dormant: 0.2,
  },
};

/** Cron expression for the daily prioritization schedule (07:00 on weekdays). */
export const DAILY_PRIORITIZATION_CRON = "0 7 * * 1-5";
