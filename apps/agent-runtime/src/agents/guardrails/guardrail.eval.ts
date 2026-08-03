import type { Recommendation } from "@repo/shared-schemas";
import { verifyRecommendation } from "./guardrail.agent";
import type { DeterministicEvalCase } from "../account-prioritizer/prioritizer.eval";

/**
 * Deterministic guardrail eval cases (Epic 4 acceptance criteria).
 *
 * Assert the safety contract: unsupported claims blocked, unverified evidence
 * blocked, customer-facing/CRM actions require approval, and clean
 * recommendations pass. Plain functions (no vitest), run by @repo/testing-evals.
 */
const ISO = "2026-06-25T00:00:00Z";

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec_test",
    runId: "run_test",
    accountId: "acc_test",
    ownerId: "rep_x",
    score: 80,
    rank: 1,
    confidence: 0.8,
    reasonCodes: ["high_open_pipeline"],
    reasonNarrative: "Priority #1 (score 80). Test Account carries significant open pipeline.",
    sourceSignals: [
      { kind: "account", refId: "acc_test", description: "Open pipeline of $100,000.", verified: true },
    ],
    nextBestAction: {
      type: "log_research_note",
      customerFacing: false,
      crmWriteBack: false,
      objective: "Document the account plan.",
    },
    verification: {
      status: "pending",
      schemaValid: false,
      guardrailsPassed: false,
      sourceSignalsVerified: false,
      permissionGranted: false,
      failedGates: [],
      checkedAt: ISO,
    },
    approvalStatus: "not_required",
    published: false,
    createdAt: ISO,
    ...overrides,
  };
}

export const guardrailEvalCases: DeterministicEvalCase[] = [
  {
    id: "block_unsupported_claim",
    run: () => {
      const rec = makeRec({
        reasonNarrative: "As discussed on our call, we agreed a 20% discount is approved.",
      });
      const { allowed, recommendation } = verifyRecommendation(rec, ISO);
      const blockedForClaim = recommendation.verification.failedGates.some((g) =>
        g.startsWith("unsupported_claim:"),
      );
      return { passed: !allowed && blockedForClaim, details: recommendation.verification.failedGates.join(",") };
    },
  },
  {
    id: "block_unverified_source_signals",
    run: () => {
      const rec = makeRec({
        sourceSignals: [
          { kind: "intent", refId: "x", description: "Unverified intent.", verified: false },
        ],
      });
      const { allowed, recommendation } = verifyRecommendation(rec, ISO);
      return {
        passed: !allowed && recommendation.verification.failedGates.includes("source_signals_unverified"),
        details: recommendation.verification.failedGates.join(","),
      };
    },
  },
  {
    id: "customer_facing_requires_approval",
    run: () => {
      const rec = makeRec({
        nextBestAction: {
          type: "send_email",
          customerFacing: true,
          crmWriteBack: false,
          objective: "Reach out.",
          draft: "Hello, would you be open to a brief conversation?",
        },
        approvalStatus: "pending_approval",
      });
      const { allowed, recommendation } = verifyRecommendation(rec, ISO);
      return {
        passed: !allowed && recommendation.verification.failedGates.includes("approval_required"),
        details: recommendation.verification.failedGates.join(","),
      };
    },
  },
  {
    id: "approved_customer_facing_passes_permission",
    run: () => {
      const rec = makeRec({
        nextBestAction: {
          type: "send_email",
          customerFacing: true,
          crmWriteBack: false,
          objective: "Reach out.",
          draft: "Hello, would you be open to a brief conversation?",
        },
        approvalStatus: "approved",
      });
      const { recommendation } = verifyRecommendation(rec, ISO);
      return {
        passed: recommendation.verification.permissionGranted === true,
        details: recommendation.verification.failedGates.join(","),
      };
    },
  },
  {
    id: "clean_recommendation_passes",
    run: () => {
      const { allowed, recommendation } = verifyRecommendation(makeRec(), ISO);
      return { passed: allowed && recommendation.verification.status === "passed", details: recommendation.verification.failedGates.join(",") };
    },
  },
  {
    // Verification decides *publishable* (the `allowed` return value); it must
    // never itself set, clear, or otherwise depend on `published`, which is
    // the separate act of actually publishing. Starting from a recommendation
    // that already passes every gate is the case that would catch a
    // regression toward "guardrails passed, so mark it published": the
    // tempting shortcut, and the one an empirical "publish didn't happen in
    // this run" assertion cannot distinguish from the real guarantee.
    id: "verification_never_sets_published_even_when_clean",
    run: () => {
      const clean = makeRec({ published: false });
      const { allowed, recommendation } = verifyRecommendation(clean, ISO);
      return {
        passed: allowed && recommendation.published === false,
        details: `allowed=${allowed} published=${recommendation.published}`,
      };
    },
  },
  {
    // Symmetric direction: verification must not clear an already-published
    // flag either. `verifyRecommendation` has no publish/unpublish authority
    // in either direction — that belongs entirely to whatever calls it.
    id: "verification_never_clears_published",
    run: () => {
      const alreadyPublished = makeRec({ published: true });
      const { recommendation } = verifyRecommendation(alreadyPublished, ISO);
      return {
        passed: recommendation.published === true,
        details: `published=${recommendation.published}`,
      };
    },
  },
  {
    // Whole-object check beyond the single field above: verification's return
    // is `{ ...rec, verification }`, so no field but `verification` should
    // differ from the input. A structural check independent of `published`
    // specifically, so a future change touching some other authoritative
    // field (score, rank, approvalStatus, ownerId, ...) fails here too.
    id: "verification_touches_only_the_verification_field",
    run: () => {
      const rec = makeRec({ published: true, approvalStatus: "approved" });
      const { recommendation } = verifyRecommendation(rec, ISO);
      const { verification: _before, ...beforeRest } = rec;
      const { verification: _after, ...afterRest } = recommendation;
      const unchanged = JSON.stringify(beforeRest) === JSON.stringify(afterRest);
      return {
        passed: unchanged,
        details: unchanged ? "" : `before=${JSON.stringify(beforeRest)} after=${JSON.stringify(afterRest)}`,
      };
    },
  },
];
