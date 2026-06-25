import { z } from "zod";

/** AnalyticsEvent — product/usage telemetry and audit-adjacent signal. */
export const AnalyticsEventName = z.enum([
  "run_started",
  "run_completed",
  "recommendation_published",
  "recommendation_blocked",
  "approval_requested",
  "approval_granted",
  "approval_rejected",
  "crm_writeback_attempted",
  "email_send_attempted",
  "guardrail_triggered",
  "feedback_submitted",
]);
export type AnalyticsEventName = z.infer<typeof AnalyticsEventName>;

export const AnalyticsEventSchema = z.object({
  id: z.string().min(1),
  name: AnalyticsEventName,
  runId: z.string().optional(),
  accountId: z.string().optional(),
  userId: z.string().optional(),
  /** Free-form, JSON-serializable properties. Must not contain secrets/PII drafts. */
  properties: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.string().datetime(),
});

export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

/** AuditLogEntry — immutable record for every critical action (Execution Rule #12). */
export const AuditLogEntrySchema = z.object({
  id: z.string().min(1),
  runId: z.string().optional(),
  accountId: z.string().optional(),
  actorId: z.string().min(1).describe("User or system actor that performed the action."),
  action: z.string().min(1),
  decision: z.enum(["allowed", "blocked", "approved", "rejected"]),
  reason: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.string().datetime(),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
