import { z } from "zod";

/** Feedback — rep/manager response to a recommendation, used to tune scoring. */
export const FeedbackVerdict = z.enum([
  "accepted",
  "rejected",
  "snoozed",
  "completed",
  "edited",
]);
export type FeedbackVerdict = z.infer<typeof FeedbackVerdict>;

export const FeedbackSchema = z.object({
  id: z.string().min(1),
  recommendationId: z.string().min(1),
  accountId: z.string().min(1),
  userId: z.string().min(1),
  verdict: FeedbackVerdict,
  comment: z.string().optional(),
  /** If the rep edited a draft before sending, the corrected text (audited). */
  editedDraft: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type Feedback = z.infer<typeof FeedbackSchema>;
