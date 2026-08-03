import { beforeAll, describe, expect, it } from "vitest";
import { loadTrajectoryCorpus } from "./trajectory/corpus";
import {
  runTrajectoryEval,
  type TrajectoryEvalSummary,
} from "./trajectory/trajectory-runner";

describe("trajectory-prioritization corpus", () => {
  let summary: TrajectoryEvalSummary;

  beforeAll(async () => {
    summary = await runTrajectoryEval();
  });

  it("loads the complete hashed 500-case corpus", () => {
    const { manifest, cases } = loadTrajectoryCorpus();
    expect(manifest.seed).toBe(23);
    expect(cases).toHaveLength(500);
    expect(cases).toHaveLength(manifest.caseCount);
  });

  it("matches every deterministic authority oracle", () => {
    expect(
      summary.authorityCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.totalCases);
  });

  it("preserves authority through deterministic template drafting", () => {
    expect(
      summary.templateDraftCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.totalCases);
  });

  it("reaches the expected publish-or-hold verification decision", () => {
    expect(
      summary.verificationCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.totalCases);
    expect(summary.publishableCases + summary.heldCases).toBe(
      summary.totalCases,
    );
    expect(summary.heldCases).toBeGreaterThan(0);
  });

  it("covers the current reachable reason-code and action branches", () => {
    expect(summary.reasonCodeCoverage).toEqual(
      expect.arrayContaining([
        "high_open_pipeline",
        "verified_intent_signal",
        "stale_no_contact",
        "renewal_approaching",
        "churn_risk_detected",
        "new_executive_buyer",
        "strategic_tier_account",
        "stalled_opportunity",
        "data_quality_blocked",
      ]),
    );
    expect(summary.actionCoverage).toEqual(
      expect.arrayContaining([
        "call",
        "send_email",
        "schedule_meeting",
        "log_research_note",
        "no_action_hold",
      ]),
    );
  });

  it("keeps customer-controlled injection text outside authority", () => {
    expect(summary.promptInjectionCases).toBeGreaterThan(0);
    expect(
      summary.promptInjectionCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.promptInjectionCases);
  });

  it("blocks targeted fabricated claims and permits the safe control", () => {
    expect(summary.guardrailCases).toBeGreaterThan(0);
    expect(
      summary.guardrailCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.guardrailCases);
  });

  it("exercises bounded model success, grounding rejection, fallback, and hold", () => {
    expect(summary.hybridDraftCases).toBeGreaterThan(0);
    expect(
      summary.hybridDraftCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.hybridDraftCases);
  });

  it("passes the complete trajectory suite", () => {
    expect(
      summary.passed,
      summary.failures.slice(0, 50).join("\n"),
    ).toBe(true);
  });
});
