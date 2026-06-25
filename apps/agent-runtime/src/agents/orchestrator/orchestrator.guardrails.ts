import {
  RecommendationSchema,
  type Recommendation,
  type VerificationResult,
} from "@repo/shared-schemas";
import { getEnv } from "../../config/env";
import { RUNTIME_CONFIG } from "../../config/runtime";

/**
 * Deterministic, synchronous runtime guardrails (Execution Rules #5, #9, #10,
 * #11). NO LLM, NO network, NO async judge here. Every check is pure and fast.
 *
 * Fail-closed: any failed gate marks the recommendation unverified, which the
 * orchestrator treats as "do not publish".
 */

/**
 * Forbidden claim patterns. These represent unsupported customer-facing claims
 * and fabricated facts that must never appear in generated narratives/drafts
 * unless they are explicitly backed by a verified source signal.
 */
const FORBIDDEN_CLAIM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bas (?:we )?discussed\b/i, label: "fabricated_prior_conversation" },
  { pattern: /\bwe (?:spoke|talked|met|chatted|agreed)\b/i, label: "fabricated_prior_conversation" },
  { pattern: /\bper our (?:call|conversation|meeting)\b/i, label: "fabricated_prior_conversation" },
  { pattern: /\b\d{1,3}\s?% (?:discount|off)\b/i, label: "fabricated_discount" },
  { pattern: /\b(?:special|exclusive)?\s?discount\b/i, label: "fabricated_discount" },
  { pattern: /\b(?:already )?approved\b/i, label: "fabricated_approval" },
  { pattern: /\bguarantee(?:d|s)?\b/i, label: "unsupported_guarantee" },
  { pattern: /\bin stock\b|\bavailable (?:now|immediately|today)\b/i, label: "fabricated_availability" },
  { pattern: /\byou (?:asked|requested|wanted|mentioned)\b/i, label: "fabricated_customer_intent" },
];

/** Verbatim signal descriptions are allowed to contain otherwise-flagged words. */
function stripVerifiedEvidence(narrative: string, rec: Recommendation): string {
  let scrubbed = narrative;
  for (const sig of rec.sourceSignals) {
    if (sig.verified && sig.description) {
      scrubbed = scrubbed.split(sig.description).join(" ");
    }
  }
  return scrubbed;
}

export interface ClaimCheck {
  passed: boolean;
  violations: string[];
}

/** Check #10/#11: block unsupported customer-facing claims & fabricated facts. */
export function checkUnsupportedClaims(rec: Recommendation): ClaimCheck {
  const violations = new Set<string>();
  const textBlobs = [rec.reasonNarrative, rec.nextBestAction.draft ?? ""]
    .map((t) => stripVerifiedEvidence(t, rec))
    .join("\n");

  for (const { pattern, label } of FORBIDDEN_CLAIM_PATTERNS) {
    if (pattern.test(textBlobs)) violations.add(label);
  }
  return { passed: violations.size === 0, violations: [...violations] };
}

/** Check #9/#11: every cited source signal must be verified, and at least one. */
export function checkSourceSignalsVerified(rec: Recommendation): boolean {
  if (rec.sourceSignals.length === 0) return false;
  return rec.sourceSignals.every((s) => s.verified === true);
}

/**
 * Check #7: customer-facing sends and CRM write-backs require human approval.
 * Permission is granted only when approval is not required OR has been approved.
 */
export function checkPermission(rec: Recommendation): boolean {
  const env = getEnv();
  const needsApproval =
    rec.nextBestAction.customerFacing || rec.nextBestAction.crmWriteBack;

  if (!needsApproval) return true;
  if (!env.REQUIRE_HUMAN_APPROVAL) return true; // explicitly disabled (non-prod)
  return rec.approvalStatus === "approved";
}

/** Schema validity gate. */
export function checkSchemaValid(rec: Recommendation): boolean {
  return RecommendationSchema.safeParse(rec).success;
}

/** Confidence floor — low-confidence recs are held, not published as actions. */
export function checkConfidenceFloor(rec: Recommendation): boolean {
  return rec.confidence >= RUNTIME_CONFIG.minPublishableConfidence;
}

/**
 * Run the full synchronous guardrail suite and produce a VerificationResult.
 * This is the single fail-closed gate the orchestrator consults before publish.
 */
export function runGuardrails(rec: Recommendation, checkedAt: string): VerificationResult {
  const failedGates: string[] = [];

  const schemaValid = checkSchemaValid(rec);
  if (!schemaValid) failedGates.push("schema_invalid");

  const claims = checkUnsupportedClaims(rec);
  if (!claims.passed) {
    for (const v of claims.violations) failedGates.push(`unsupported_claim:${v}`);
  }

  const sourceSignalsVerified = checkSourceSignalsVerified(rec);
  if (!sourceSignalsVerified) failedGates.push("source_signals_unverified");

  const permissionGranted = checkPermission(rec);
  if (!permissionGranted) failedGates.push("approval_required");

  if (!checkConfidenceFloor(rec)) failedGates.push("confidence_below_floor");

  const guardrailsPassed = claims.passed && sourceSignalsVerified;

  return {
    status: failedGates.length === 0 ? "passed" : "failed",
    schemaValid,
    guardrailsPassed,
    sourceSignalsVerified,
    permissionGranted,
    failedGates,
    checkedAt,
  };
}
