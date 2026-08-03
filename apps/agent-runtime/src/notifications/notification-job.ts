import { createHash } from "node:crypto";
import { z } from "zod";

export type NotificationChannel = "email" | "in_app";
export type NotificationDeliveryStatus = "requested" | "sent" | "failed" | "cancelled";

declare const durableRecommendationIdBrand: unique symbol;
export type DurableRecommendationId = string & {
  readonly [durableRecommendationIdBrand]: "DurableRecommendationId";
};

const DurableRecommendationIdSchema = z.string().uuid();

/** Distinguish persisted recommendation UUIDs from deterministic candidate IDs. */
export function parseDurableRecommendationId(value: string): DurableRecommendationId {
  return DurableRecommendationIdSchema.parse(value) as DurableRecommendationId;
}

export interface NotificationDeliveryRecord {
  idempotencyKey: string;
  workspaceId: string;
  recipientId: string;
  recommendationId: DurableRecommendationId;
  channel: NotificationChannel;
  workflowRunId: string | null;
  status: NotificationDeliveryStatus;
  providerMessageId: string | null;
  requestedAt: string;
  sentAt: string | null;
  failedAt: string | null;
  failureCode: string | null;
}

export interface CreateNotificationDeliveryInput {
  workspaceId: string;
  recipientId: string;
  recommendationId: DurableRecommendationId;
  channel: NotificationChannel;
  workflowRunId?: string | null;
  now: string;
}

export function notificationIdempotencyKey(
  input: Omit<CreateNotificationDeliveryInput, "now" | "workflowRunId">,
): string {
  const recommendationId = parseDurableRecommendationId(input.recommendationId);
  const canonical = JSON.stringify([
    input.workspaceId,
    input.recipientId,
    recommendationId,
    input.channel,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createNotificationDelivery(
  input: CreateNotificationDeliveryInput,
): NotificationDeliveryRecord {
  const recommendationId = parseDurableRecommendationId(input.recommendationId);
  return {
    idempotencyKey: notificationIdempotencyKey({ ...input, recommendationId }),
    workspaceId: input.workspaceId,
    recipientId: input.recipientId,
    recommendationId,
    channel: input.channel,
    workflowRunId: input.workflowRunId ?? null,
    status: "requested",
    providerMessageId: null,
    requestedAt: input.now,
    sentAt: null,
    failedAt: null,
    failureCode: null,
  };
}
