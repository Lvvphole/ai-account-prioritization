import { FeedbackVerdict } from "@repo/shared-schemas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FEEDBACK_CODES = FeedbackVerdict.options;
export const OUTCOME_CODES = [
  "meeting_booked",
  "opportunity_advanced",
  "renewal_completed",
  "expansion",
  "closed_won",
  "closed_lost",
  "churned",
  "no_response",
] as const;

export type RecommendationFollowupKind = "feedback" | "outcome" | "unknown";
export type RecommendationFeedbackCode = (typeof FEEDBACK_CODES)[number];
export type RecommendationOutcomeCode = (typeof OUTCOME_CODES)[number];
export type RecommendationFollowupCode = RecommendationFeedbackCode | RecommendationOutcomeCode | "unknown";

export interface RecommendationFollowupRequest {
  workspaceId: string;
  recommendationId: string;
  kind: RecommendationFollowupKind;
  code: RecommendationFollowupCode;
  expectedEventId: string | null;
}

export type RecommendationFollowupState =
  | {
      status: "none";
      kind: null;
      code: null;
      eventId: null;
      recordedAt: null;
      replayed: false;
    }
  | {
      status: "recorded";
      kind: RecommendationFollowupKind;
      code: RecommendationFollowupCode;
      eventId: string;
      recordedAt: string;
      replayed: boolean;
    };

function isOutcomeCode(value: string): value is RecommendationOutcomeCode {
  return (OUTCOME_CODES as readonly string[]).includes(value);
}

export function isRecommendationFollowupCode(
  kind: RecommendationFollowupKind,
  code: string,
): code is RecommendationFollowupCode {
  if (kind === "feedback") return FeedbackVerdict.safeParse(code).success;
  if (kind === "outcome") return isOutcomeCode(code);
  return code === "unknown";
}

export function parseRecommendationFollowupRequest(value: unknown): RecommendationFollowupRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RECOMMENDATION_FOLLOWUP_INVALID_REQUEST");
  }

  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "workspaceId",
    "recommendationId",
    "kind",
    "code",
    "expectedEventId",
  ]);
  const keys = Object.keys(input);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
    throw new Error("RECOMMENDATION_FOLLOWUP_INVALID_REQUEST");
  }

  const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId.trim() : "";
  const recommendationId =
    typeof input.recommendationId === "string" ? input.recommendationId.trim() : "";
  const kind = input.kind;
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const expectedEventId =
    input.expectedEventId === null
      ? null
      : typeof input.expectedEventId === "string"
        ? input.expectedEventId.trim()
        : "";

  if (!UUID.test(workspaceId)) {
    throw new Error("RECOMMENDATION_FOLLOWUP_INVALID_WORKSPACE");
  }
  if (!recommendationId || recommendationId.length > 512) {
    throw new Error("RECOMMENDATION_FOLLOWUP_INVALID_RECOMMENDATION");
  }
  if (kind !== "feedback" && kind !== "outcome" && kind !== "unknown") {
    throw new Error("RECOMMENDATION_FOLLOWUP_INVALID_KIND");
  }
  if (!isRecommendationFollowupCode(kind, code)) {
    throw new Error("RECOMMENDATION_FOLLOWUP_INVALID_CODE");
  }
  if (expectedEventId !== null && !UUID.test(expectedEventId)) {
    throw new Error("RECOMMENDATION_FOLLOWUP_INVALID_EXPECTED_EVENT");
  }

  return { workspaceId, recommendationId, kind, code, expectedEventId };
}

export function parseRecommendationFollowupState(value: unknown): RecommendationFollowupState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RECOMMENDATION_FOLLOWUP_RESULT_INVALID");
  }

  const result = value as Record<string, unknown>;
  const allowed = new Set(["status", "kind", "code", "eventId", "recordedAt", "replayed"]);
  const keys = Object.keys(result);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
    throw new Error("RECOMMENDATION_FOLLOWUP_RESULT_INVALID");
  }

  if (result.status === "none") {
    if (
      result.kind !== null ||
      result.code !== null ||
      result.eventId !== null ||
      result.recordedAt !== null ||
      result.replayed !== false
    ) {
      throw new Error("RECOMMENDATION_FOLLOWUP_RESULT_INVALID");
    }
    return {
      status: "none",
      kind: null,
      code: null,
      eventId: null,
      recordedAt: null,
      replayed: false,
    };
  }

  if (result.status !== "recorded") {
    throw new Error("RECOMMENDATION_FOLLOWUP_RESULT_INVALID");
  }

  const kind = result.kind;
  const code = typeof result.code === "string" ? result.code : "";
  const eventId = typeof result.eventId === "string" ? result.eventId : "";
  const recordedAt = typeof result.recordedAt === "string" ? result.recordedAt : "";
  const replayed = result.replayed;

  if (kind !== "feedback" && kind !== "outcome" && kind !== "unknown") {
    throw new Error("RECOMMENDATION_FOLLOWUP_RESULT_INVALID");
  }
  if (!isRecommendationFollowupCode(kind, code)) {
    throw new Error("RECOMMENDATION_FOLLOWUP_RESULT_INVALID");
  }
  if (!UUID.test(eventId) || Number.isNaN(Date.parse(recordedAt)) || typeof replayed !== "boolean") {
    throw new Error("RECOMMENDATION_FOLLOWUP_RESULT_INVALID");
  }

  return { status: "recorded", kind, code, eventId, recordedAt, replayed };
}
