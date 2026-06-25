import { z } from "zod";

/**
 * Account — the core B2B entity that gets prioritized.
 *
 * This is read-only domain data sourced from the CRM. The deterministic scorer
 * consumes a normalized view of these fields; the LLM never sees raw account
 * data without it first passing schema validation.
 */
export const AccountTier = z.enum(["strategic", "enterprise", "mid_market", "smb"]);
export type AccountTier = z.infer<typeof AccountTier>;

export const AccountLifecycleStage = z.enum([
  "prospect",
  "open_opportunity",
  "customer",
  "renewal",
  "churn_risk",
  "dormant",
]);
export type AccountLifecycleStage = z.infer<typeof AccountLifecycleStage>;

export const AccountSchema = z.object({
  id: z.string().min(1).describe("Stable CRM account id."),
  name: z.string().min(1).describe("Account display name."),
  domain: z.string().optional().describe("Primary web domain, if known."),
  ownerId: z.string().min(1).describe("CRM id of the owning sales rep."),
  tier: AccountTier,
  lifecycleStage: AccountLifecycleStage,
  industry: z.string().optional(),
  employeeCount: z.number().int().nonnegative().optional(),
  annualRevenueUsd: z.number().nonnegative().optional(),
  openPipelineUsd: z
    .number()
    .nonnegative()
    .default(0)
    .describe("Sum of open opportunity amounts in USD."),
  lastContactedAt: z
    .string()
    .datetime()
    .optional()
    .describe("ISO timestamp of last logged outbound activity."),
  daysSinceLastContact: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Derived staleness signal used by the deterministic scorer."),
  healthScore: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Externally-provided account health (0-100), if available."),
  intentSignals: z
    .array(z.string())
    .default([])
    .describe("Verified intent signal codes (e.g. pricing_page_visit)."),
  dataQualityFlags: z
    .array(z.string())
    .default([])
    .describe("Data quality issues detected by the Python data-quality service."),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Account = z.infer<typeof AccountSchema>;
