import { z } from "zod";

/** Activity — a logged interaction (call, email, meeting, note). */
export const ActivityType = z.enum([
  "call",
  "email_outbound",
  "email_inbound",
  "meeting",
  "note",
  "task",
  "intent_event",
]);
export type ActivityType = z.infer<typeof ActivityType>;

export const ActivitySchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  contactId: z.string().optional(),
  type: ActivityType,
  subject: z.string().optional(),
  body: z.string().optional(),
  occurredAt: z.string().datetime(),
  createdById: z.string().min(1),
  /**
   * Whether this activity is a verifiable source signal. Only verified
   * activities may be cited as evidence in a recommendation. Fabricated or
   * inferred interactions must never be marked verified.
   */
  verified: z.boolean().default(true),
});

export type Activity = z.infer<typeof ActivitySchema>;
