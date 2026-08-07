import {
  FeedbackVerdict,
  RecommendationFollowupRequestSchema,
  RecommendationFollowupStateSchema,
  RecommendationOutcomeCodeSchema,
  type RecommendationFollowupCode as SharedRecommendationFollowupCode,
  type RecommendationFollowupKind as SharedRecommendationFollowupKind,
  type RecommendationFollowupRequest as SharedRecommendationFollowupRequest,
  type RecommendationFollowupState as SharedRecommendationFollowupState,
} from "@repo/shared-schemas";

export const FEEDBACK_CODES = FeedbackVerdict.options;
export const OUTCOME_CODES = RecommendationOutcomeCodeSchema.options;

export type RecommendationFollowupKind = SharedRecommendationFollowupKind;
export type RecommendationFollowupCode = SharedRecommendationFollowupCode;
export type RecommendationFollowupRequest = SharedRecommendationFollowupRequest;
export type RecommendationFollowupState = SharedRecommendationFollowupState;

export function parseRecommendationFollowupRequest(value: unknown): RecommendationFollowupRequest {
  const parsed = RecommendationFollowupRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("RECOMMENDATION_FOLLOWUP_INVALID_REQUEST");
  }
  return parsed.data;
}

export function parseRecommendationFollowupState(value: unknown): RecommendationFollowupState {
  const parsed = RecommendationFollowupStateSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("RECOMMENDATION_FOLLOWUP_RESULT_INVALID");
  }
  return parsed.data;
}

/**
 * HTTP 409 is reserved for the database's optimistic-concurrency refusal.
 * Unknown database/PostgREST failures are server failures, not stale-state
 * conflicts, so the UI must use its generic recording-failure path.
 */
export function recommendationFollowupRpcStatus(code: string | undefined): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "22023") return 400;
  if (code === "40001") return 409;
  return 500;
}
