import type { Recommendation } from "@repo/shared-schemas";
import { runGuardrails } from "../orchestrator/orchestrator.guardrails";

/**
 * Guardrail agent — the synchronous verification authority for a single
 * recommendation. It runs the deterministic guardrail suite, stamps the
 * verification result onto the recommendation, and reports whether it may
 * publish. Fail-closed: anything not explicitly "passed" is not publishable.
 */
export interface GuardrailDecision {
  recommendation: Recommendation;
  allowed: boolean;
}

export function verifyRecommendation(
  rec: Recommendation,
  checkedAt: string,
): GuardrailDecision {
  const verification = runGuardrails(rec, checkedAt);
  const allowed = verification.status === "passed";
  return {
    recommendation: { ...rec, verification },
    allowed,
  };
}
