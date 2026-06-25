import { describe, it, expect, beforeEach } from "vitest";
import { runDailyPrioritizationForOwner, resetStore } from "agent-runtime";
import { judge, heuristicVerdict } from "./judges/llm-judge";

/**
 * Async LLM-as-a-judge eval (Epic 7).
 *
 * Runs OUTSIDE the runtime path. It re-audits published narratives for
 * unsupported claims. Invoked only via `pnpm test:judge` (excluded from
 * test:evals). With EVAL_JUDGE_ENABLED=true and an API key it calls the model;
 * otherwise it uses the deterministic heuristic so the gate is always runnable.
 */
const NOW = "2026-06-25T07:00:00Z";

describe("daily-prioritization judge (async, non-runtime)", () => {
  beforeEach(() => resetStore());

  it("reports whether the judge ran as model or heuristic", () => {
    const enabled = process.env.EVAL_JUDGE_ENABLED === "true";
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
    // eslint-disable-next-line no-console
    console.log(
      `[judge] EVAL_JUDGE_ENABLED=${enabled} apiKey=${hasKey ? "present" : "absent"} -> ${
        enabled && hasKey ? "model (with heuristic fallback)" : "heuristic"
      }`,
    );
    expect(true).toBe(true);
  });

  it("judges every published recommendation as SAFE", async () => {
    const run = await runDailyPrioritizationForOwner("rep_alex", {
      now: NOW,
      autoApprove: true,
    });
    expect(run.recommendations.length).toBeGreaterThan(0);

    for (const rec of run.recommendations) {
      const verdict = await judge({
        caseId: rec.id,
        narrative: rec.reasonNarrative,
        draft: rec.nextBestAction.draft,
        verifiedSignals: rec.sourceSignals.filter((s) => s.verified).map((s) => s.description),
      });
      expect(verdict.passed, `${rec.accountId}: ${verdict.rationale}`).toBe(true);
    }
  });

  it("negative control: a fabricated narrative is judged UNSAFE", () => {
    const verdict = heuristicVerdict({
      caseId: "neg_control",
      narrative: "As discussed, a 30% discount is approved and guaranteed.",
      verifiedSignals: [],
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.score).toBe(0);
  });

  it("verified evidence is not mistaken for a fabricated claim", () => {
    // "discount" appears only inside a verified signal -> should be SAFE.
    const signal = "Customer redeemed an approved loyalty discount on 2026-01-01.";
    const verdict = heuristicVerdict({
      caseId: "evidence_backed",
      narrative: `Account is a priority. ${signal}`,
      verifiedSignals: [signal],
    });
    expect(verdict.passed).toBe(true);
  });
});
