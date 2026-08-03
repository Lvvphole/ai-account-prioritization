import { createHash } from "node:crypto";

export type NotificationChannel = "email" | "in_app";
export type NotificationStatus = "pending" | "sending" | "sent" | "failed" | "dead";

export interface NotificationJob {
  idempotencyKey: string;
  workspaceId: string;
  recipientId: string;
  recommendationId: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  attemptCount: number;
  availableAt: string;
  createdAt: string;
  sentAt: string | null;
  lastErrorCode: string | null;
}

export interface CreateNotificationJobInput {
  workspaceId: string;
  recipientId: string;
  recommendationId: string;
  channel: NotificationChannel;
  now: string;
}

export function notificationIdempotencyKey(
  input: Omit<CreateNotificationJobInput, "now">,
): string {
  return createHash("sha256")
    .update(
      [input.workspaceId, input.recipientId, input.recommendationId, input.channel].join(":"),
      "utf8",
    )
    .digest("hex");
}

export function createNotificationJob(input: CreateNotificationJobInput): NotificationJob {
  return {
    idempotencyKey: notificationIdempotencyKey(input),
    workspaceId: input.workspaceId,
    recipientId: input.recipientId,
    recommendationId: input.recommendationId,
    channel: input.channel,
    status: "pending",
    attemptCount: 0,
    availableAt: input.now,
    createdAt: input.now,
    sentAt: null,
    lastErrorCode: null,
  };
}

/** Deterministic exponential backoff. Attempt 1 waits 60 seconds; cap is 1 hour. */
export function nextNotificationAttemptAt(now: string, attemptCount: number): string {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new Error("attemptCount must be a positive integer.");
  }
  const delaySeconds = Math.min(3600, 60 * 2 ** (attemptCount - 1));
  return new Date(new Date(now).getTime() + delaySeconds * 1000).toISOString();
}
