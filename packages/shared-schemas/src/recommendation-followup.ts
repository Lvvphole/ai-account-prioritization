import { z } from "zod";
import { FeedbackVerdict } from "./feedback";

/** Version recorded with each durable recommendation follow-up event. */
export const RECOMMENDATION_FOLLOWUP_CONTRACT_VERSION = "recommendation-followup/v1" as const;

const PostgreSqlUuidSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
const RuntimeRecommendationIdSchema = z.string().trim().min(1).max(512);

export const RecommendationOutcomeCodeSchema = z.enum([
  "meeting_booked",
  "opportunity_advanced",
  "renewal_completed",
  "expansion",
  "closed_won",
  "closed_lost",
  "churned",
  "no_response",
]);
export type RecommendationOutcomeCode = z.infer<typeof RecommendationOutcomeCodeSchema>;

export const RecommendationFollowupKindSchema = z.enum(["feedback", "outcome", "unknown"]);
export type RecommendationFollowupKind = z.infer<typeof RecommendationFollowupKindSchema>;

const FollowupRequestScope = {
  workspaceId: PostgreSqlUuidSchema,
  recommendationId: RuntimeRecommendationIdSchema,
  expectedEventId: PostgreSqlUuidSchema.nullable(),
};

export const RecommendationFollowupRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...FollowupRequestScope,
      kind: z.literal("feedback"),
      code: FeedbackVerdict,
    })
    .strict(),
  z
    .object({
      ...FollowupRequestScope,
      kind: z.literal("outcome"),
      code: RecommendationOutcomeCodeSchema,
    })
    .strict(),
  z
    .object({
      ...FollowupRequestScope,
      kind: z.literal("unknown"),
      code: z.literal("unknown"),
    })
    .strict(),
]);
export type RecommendationFollowupRequest = z.infer<typeof RecommendationFollowupRequestSchema>;
export type RecommendationFollowupCode = RecommendationFollowupRequest["code"];

const RecommendationFollowupNoneStateSchema = z
  .object({
    status: z.literal("none"),
    kind: z.null(),
    code: z.null(),
    eventId: z.null(),
    recordedAt: z.null(),
    replayed: z.literal(false),
  })
  .strict();

const RecordedStateBase = {
  status: z.literal("recorded"),
  eventId: PostgreSqlUuidSchema,
  recordedAt: z.string().datetime(),
  replayed: z.boolean(),
};

const RecommendationFollowupRecordedStateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...RecordedStateBase,
      kind: z.literal("feedback"),
      code: FeedbackVerdict,
    })
    .strict(),
  z
    .object({
      ...RecordedStateBase,
      kind: z.literal("outcome"),
      code: RecommendationOutcomeCodeSchema,
    })
    .strict(),
  z
    .object({
      ...RecordedStateBase,
      kind: z.literal("unknown"),
      code: z.literal("unknown"),
    })
    .strict(),
]);

export const RecommendationFollowupStateSchema = z.union([
  RecommendationFollowupNoneStateSchema,
  RecommendationFollowupRecordedStateSchema,
]);
export type RecommendationFollowupState = z.infer<typeof RecommendationFollowupStateSchema>;
