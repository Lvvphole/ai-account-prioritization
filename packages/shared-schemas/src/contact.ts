import { z } from "zod";

/** Contact — a person associated with an account. */
export const ContactRole = z.enum([
  "economic_buyer",
  "champion",
  "technical_evaluator",
  "influencer",
  "blocker",
  "unknown",
]);
export type ContactRole = z.infer<typeof ContactRole>;

export const ContactSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  title: z.string().optional(),
  email: z.string().email().optional(),
  role: ContactRole.default("unknown"),
  isPrimary: z.boolean().default(false),
  lastEngagedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Contact = z.infer<typeof ContactSchema>;
