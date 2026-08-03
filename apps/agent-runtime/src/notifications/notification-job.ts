import { createHash } from "node:crypto";

export type NotificationChannel = "email" | "in_app";
export type NotificationDeliveryStatus = "requested" | "sent" | "failed" | "cancelled";

/**
 * Durable business evidence for one notification delivery.
 *
 * This record does not schedule work and does not own retry state. The durable
 * workflow runtime owns provider-call retries. Supabase owns the delivery
 * evidence and idempotency boundary.
 */
export interface NotificationDeliveryRecord {
  idempotencyKey: string;
  workspaceId: string;
  recipientId: string;
  recommendationId: string;
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
  recommendationId: string;
  channel: NotificationChannel;
  workflowRunId?: string | null;
  now: string;
}

export function notificationIdempotencyKey(
  input: Omit<CreateNotificationDeliveryInput, "now" | "workflowRunId">,
): string {
  // A JSON array gives one unambiguous encoding for the ordered fields.
  const canonical = JSON.stringify([
    input.workspaceId,
    input.recipientId,
    input.recommendationId,
    input.channel,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createNotificationDelivery(
  input: CreateNotificationDeliveryInput,
): NotificationDeliveryRecord {
  return {
    idempotencyKey: notificationIdempotencyKey(input),
    workspaceId: input.workspaceId,
    recipientId: input.recipientId,
    recommendationId: input.recommendationId,
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
