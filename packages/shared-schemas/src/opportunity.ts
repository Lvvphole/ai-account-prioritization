import { z } from "zod";

/** Opportunity — an open or closed deal attached to an account. */
export const OpportunityStage = z.enum([
  "discovery",
  "qualification",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
]);
export type OpportunityStage = z.infer<typeof OpportunityStage>;

export const OpportunitySchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  name: z.string().min(1),
  stage: OpportunityStage,
  amountUsd: z.number().nonnegative().default(0),
  probability: z.number().min(0).max(1).default(0),
  closeDate: z.string().datetime().optional(),
  isClosed: z.boolean().default(false),
  isWon: z.boolean().default(false),
  nextStep: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Opportunity = z.infer<typeof OpportunitySchema>;
