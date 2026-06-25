import { describe, it, expect } from "vitest";
import { prioritizerEvalCases } from "agent-runtime";

/**
 * Deterministic scoring evals (Sprint 3 exit gate).
 *
 * Executes the co-located prioritizer eval cases (determinism, monotonicity,
 * stable ranking, "LLM cannot rank") through the eval harness.
 */
describe("scoring (deterministic invariants)", () => {
  for (const evalCase of prioritizerEvalCases) {
    it(evalCase.id, () => {
      const result = evalCase.run();
      expect(result.passed, `${evalCase.id}: ${result.details ?? ""}`).toBe(true);
    });
  }
});
