import { RUNTIME_CONFIG } from "agent-runtime";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTrajectoryCorpus } from "./trajectory/corpus";
import { loadTrajectoryProvenance } from "./trajectory/provenance";
import {
  runTrajectoryEval,
  type TrajectoryEvalSummary,
} from "./trajectory/trajectory-runner";

describe("current-input-contract-v2 trajectory policy regression", () => {
  let summary: TrajectoryEvalSummary;

  beforeAll(async () => {
    summary = await runTrajectoryEval();
  });

  it("loads the complete hashed 500-case policy-lock corpus", () => {
    const { manifest, cases } = loadTrajectoryCorpus();
    const provenance = loadTrajectoryProvenance();

    expect(manifest.seed).toBe(23);
    expect(cases).toHaveLength(500);
    expect(cases).toHaveLength(manifest.caseCount);
    expect(provenance.manifest.corpusKind).toBe(
      "synthetic-canonical-state-policy-regression",
    );
    expect(provenance.manifest.inputContractVersion).toBe(
      "current-input-contract-v2",
    );
    expect(provenance.manifest.oracleClass).toBe(
      "policy-lock-regression-not-independent-ground-truth",
    );
    expect(provenance.manifest.sourceDataset.role).toBe(
      "shape-reference-only",
    );
    expect(
      provenance.manifest.sourceDataset.reproducibleFromCommittedArtifacts,
    ).toBe(false);
  });

  it("matches every deterministic current-policy oracle", () => {
    expect(
      summary.authorityCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.totalCases);
  });

  it("locks the production recommendation cap at exactly 25", () => {
    expect(RUNTIME_CONFIG.maxRecommendations).toBe(25);
    expect(summary.topRankingCasesExpected).toBe(25);
    expect(
      summary.topRankingCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(25);
  });

  it("preserves every non-draft recommendation field during template drafting", () => {
    expect(
      summary.templateDraftCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.totalCases);
  });

  it("reaches the expected publish-eligibility or hold decision", () => {
    expect(
      summary.verificationCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.totalCases);
    expect(summary.publishEligibleCases + summary.heldCases).toBe(
      summary.totalCases,
    );
    expect(summary.heldCases).toBeGreaterThan(0);
  });

  it("holds pending and rejected approvals and permits approved eligibility", () => {
    expect(summary.approvalGateCases).toBe(3);
    expect(
      summary.approvalGateCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.approvalGateCases);
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
        "no_qualifying_signal",
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

  it("keeps customer-controlled CRM note text outside deterministic authority", () => {
    expect(summary.promptInjectionCases).toBeGreaterThan(0);
    expect(
      summary.promptInjectionCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.promptInjectionCases);
  });

  it("carries an injection case through verified context, model rejection, fallback, and final verification", () => {
    expect(summary.hybridInjectionCases).toBe(1);
    expect(
      summary.hybridInjectionCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.hybridInjectionCases);
  });

  it("blocks targeted fabricated claims and permits the safe control", () => {
    expect(summary.guardrailCases).toBeGreaterThan(0);
    expect(
      summary.guardrailCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.guardrailCases);
  });

  it("rejects model authority fields and exercises schema, grounding, fallback, and hold", () => {
    expect(summary.hybridDraftCases).toBeGreaterThan(0);
    expect(
      summary.hybridDraftCasesPassed,
      summary.failures.slice(0, 20).join("\n"),
    ).toBe(summary.hybridDraftCases);
  });

  it("passes the complete current-contract trajectory suite", () => {
    expect(
      summary.passed,
      summary.failures.slice(0, 50).join("\n"),
    ).toBe(true);
  });
});
