/**
 * UI-facing types re-exported from the shared schema contract.
 * This is the single import surface that proves the web app consumes
 * @repo/shared-schemas (Epic 5 acceptance criterion: "web imports
 * @repo/shared-schemas").
 */
export type {
  Recommendation,
  NextBestAction,
  SourceSignal,
  ReasonCode,
} from "@repo/shared-schemas";

/** A flattened, serializable view of the deterministic scoring config. */
export interface RuntimeConfigView {
  maxRecommendations: number;
  pipelineSaturationUsd: number;
  staleContactThresholdDays: number;
  highPipelineThresholdUsd: number;
  churnRiskHealthThreshold: number;
  minPublishableConfidence: number;
  weights: {
    pipeline: number;
    intent: number;
    staleness: number;
    tier: number;
    lifecycle: number;
    healthRisk: number;
  };
}
