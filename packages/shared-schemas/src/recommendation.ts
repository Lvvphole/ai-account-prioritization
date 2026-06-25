import { z } from "zod";

/**
 * Recommendation — the verified, daily, per-account action plan item.
 *
 * Hard product invariants encoded here:
 *  - score & rank are DETERMINISTIC (computed by the scorer, not the LLM).
 *  - every recommendation carries score, confidence, reasonCodes,
 *    sourceSignals, and nextBestAction (Execution Rule #8).
 *  - no recommendation may publish without passing verification
 *    (verification.status === "passed").
 *  - customer-facing actions require human approval before send.
 */

/** Enumerated reason codes — the LLM may only select from this closed set. */
export const ReasonCode = z.enum([
  "high_open_pipeline",
  "verified_intent_signal",
  "stale_no_contact",
  "renewal_approaching",
  "champion_engaged",
  "churn_risk_detected",
  "new_executive_buyer",
  "strategic_tier_account",
  "stalled_opportunity",
  "data_quality_blocked",
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const NextBestActionType = z.enum([
  "call",
  "send_email",
  "schedule_meeting",
  "log_research_note",
  "request_intro",
  "escalate_to_manager",
  "no_action_hold",
]);
export type NextBestActionType = z.infer<typeof NextBestActionType>;

/** A single cited piece of evidence backing a recommendation. */
export const SourceSignalSchema = z.object({
  kind: z.enum(["account", "contact", "opportunity", "activity", "intent", "derived"]),
  refId: z.string().min(1).describe("Id of the source record this signal points to."),
  description: z.string().min(1).describe("Human-readable, factual summary of the signal."),
  /** Verified signals only. Unverified evidence must fail closed at guardrails. */
  verified: z.boolean(),
});
export type SourceSignal = z.infer<typeof SourceSignalSchema>;

export const NextBestActionSchema = z.object({
  type: NextBestActionType,
  /** Whether this action is customer-facing and therefore approval-gated. */
  customerFacing: z.boolean(),
  /** Whether this action writes back to the CRM and is therefore approval-gated. */
  crmWriteBack: z.boolean().default(false),
  objective: z.string().min(1).describe("What the rep should accomplish."),
  draft: z
    .string()
    .optional()
    .describe("Optional generated draft (email/call objective/CRM note)."),
});
export type NextBestAction = z.infer<typeof NextBestActionSchema>;

export const VerificationStatus = z.enum(["passed", "failed", "pending"]);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const ApprovalStatus = z.enum([
  "not_required",
  "pending_approval",
  "approved",
  "rejected",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const VerificationResultSchema = z.object({
  status: VerificationStatus,
  schemaValid: z.boolean(),
  guardrailsPassed: z.boolean(),
  sourceSignalsVerified: z.boolean(),
  permissionGranted: z.boolean(),
  failedGates: z.array(z.string()).default([]),
  checkedAt: z.string().datetime(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const RecommendationSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1).describe("Id of the prioritization run that produced this."),
  accountId: z.string().min(1),
  ownerId: z.string().min(1),

  /** Deterministic outputs — never set by the LLM. */
  score: z.number().min(0).max(100).describe("Deterministic priority score (0-100)."),
  rank: z.number().int().positive().describe("Deterministic rank within the run (1 = first)."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Deterministic confidence derived from data completeness & signal strength."),

  reasonCodes: z.array(ReasonCode).min(1).describe("Why this account matters (closed set)."),
  reasonNarrative: z
    .string()
    .min(1)
    .describe("Guarded natural-language explanation; claims must map to sourceSignals."),
  sourceSignals: z
    .array(SourceSignalSchema)
    .min(1)
    .describe("Evidence backing the recommendation. Required & must be verified."),
  nextBestAction: NextBestActionSchema,

  verification: VerificationResultSchema,
  approvalStatus: ApprovalStatus.default("not_required"),
  published: z.boolean().default(false),

  createdAt: z.string().datetime(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

/** A full daily prioritization run: an ordered, verified list of recommendations. */
export const PrioritizationRunSchema = z.object({
  runId: z.string().min(1),
  ownerId: z.string().min(1),
  generatedAt: z.string().datetime(),
  recommendations: z.array(RecommendationSchema),
  totalAccountsConsidered: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative().default(0),
});
export type PrioritizationRun = z.infer<typeof PrioritizationRunSchema>;
