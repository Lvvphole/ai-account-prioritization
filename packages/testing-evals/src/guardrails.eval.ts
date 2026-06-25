import { describe, it, expect } from "vitest";
import { guardrailEvalCases } from "agent-runtime";

/**
 * Deterministic guardrail evals (Epic 4 acceptance criteria).
 *
 * Executes the co-located guardrail eval cases: unsupported claims blocked,
 * unverified evidence blocked, approval required for customer-facing/CRM actions,
 * clean recommendations pass.
 */
describe("guardrails (deterministic safety)", () => {
  for (const evalCase of guardrailEvalCases) {
    it(evalCase.id, () => {
      const result = evalCase.run();
      expect(result.passed, `${evalCase.id}: ${result.details ?? ""}`).toBe(true);
    });
  }
});
