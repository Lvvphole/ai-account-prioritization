import type {
  Recommendation,
  RuntimeConfigView,
} from "./types";

/**
 * Typed mock data for the UI.
 *
 * The web app is intentionally decoupled from the agent runtime: it renders the
 * shared `Recommendation` contract (from @repo/shared-schemas) so the type
 * boundary is enforced at build time, without importing runtime code into the
 * browser bundle. In production these come from the runtime's published runs.
 */
const ISO = "2026-06-25T07:00:00Z";

export const MOCK_RECOMMENDATIONS: Recommendation[] = [
  {
    id: "rec_1",
    runId: "run_demo",
    accountId: "acc_001",
    ownerId: "rep_alex",
    score: 73.63,
    rank: 1,
    confidence: 0.83,
    reasonCodes: ["high_open_pipeline", "verified_intent_signal", "stalled_opportunity"],
    reasonNarrative:
      "Priority #1 (score 73.63). Helios Manufacturing carries significant open pipeline, shows recent verified buying intent, has an open opportunity that needs a next step.",
    sourceSignals: [
      { kind: "account", refId: "acc_001", description: "Open pipeline of $180,000.", verified: true },
      { kind: "intent", refId: "act_002", description: "Verified intent signal: pricing_page_visit.", verified: true },
    ],
    nextBestAction: {
      type: "send_email",
      customerFacing: true,
      crmWriteBack: false,
      objective: "Re-engage the open opportunity at Helios Manufacturing with a concrete next step.",
      draft: "Subject: Reaching out from your account team — Helios Manufacturing\n\nHi Dana, ...",
    },
    verification: {
      status: "passed",
      schemaValid: true,
      guardrailsPassed: true,
      sourceSignalsVerified: true,
      permissionGranted: true,
      failedGates: [],
      checkedAt: ISO,
    },
    approvalStatus: "approved",
    published: true,
    createdAt: ISO,
  },
  {
    id: "rec_2",
    runId: "run_demo",
    accountId: "acc_003",
    ownerId: "rep_alex",
    score: 51.07,
    rank: 2,
    confidence: 0.62,
    reasonCodes: ["verified_intent_signal", "stale_no_contact", "churn_risk_detected"],
    reasonNarrative:
      "Priority #2 (score 51.07). Cobalt Analytics shows churn-risk indicators, has gone without logged contact.",
    sourceSignals: [
      { kind: "account", refId: "acc_003", description: "Account health score is 31 (below churn-risk threshold).", verified: true },
      { kind: "derived", refId: "acc_003", description: "No logged contact for 56 days.", verified: true },
    ],
    nextBestAction: {
      type: "call",
      customerFacing: true,
      crmWriteBack: false,
      objective: "Proactively call Cobalt Analytics to address churn-risk indicators.",
    },
    verification: {
      status: "passed",
      schemaValid: true,
      guardrailsPassed: true,
      sourceSignalsVerified: true,
      permissionGranted: true,
      failedGates: [],
      checkedAt: ISO,
    },
    approvalStatus: "approved",
    published: true,
    createdAt: ISO,
  },
  {
    id: "rec_3",
    runId: "run_demo",
    accountId: "acc_002",
    ownerId: "rep_alex",
    score: 40.2,
    rank: 3,
    confidence: 0.75,
    reasonCodes: ["renewal_approaching", "stalled_opportunity"],
    reasonNarrative:
      "Priority #3 (score 40.2). Northwind Retail has an approaching renewal, has an open opportunity that needs a next step.",
    sourceSignals: [
      { kind: "opportunity", refId: "opp_002", description: "Open opportunity \"Northwind Renewal FY26\" in negotiation stage worth $60,000.", verified: true },
    ],
    nextBestAction: {
      type: "schedule_meeting",
      customerFacing: true,
      crmWriteBack: false,
      objective: "Schedule a renewal-planning meeting with Northwind Retail.",
    },
    verification: {
      status: "passed",
      schemaValid: true,
      guardrailsPassed: true,
      sourceSignalsVerified: true,
      permissionGranted: true,
      failedGates: [],
      checkedAt: ISO,
    },
    approvalStatus: "approved",
    published: true,
    createdAt: ISO,
  },
];

/** A recommendation currently held by the guardrails (illustrates fail-closed). */
export const MOCK_BLOCKED: { accountId: string; name: string; failedGates: string[] }[] = [
  { accountId: "acc_004", name: "Pinecrest Logistics", failedGates: ["confidence_below_floor"] },
];

export const MOCK_SCORING_CONFIG: RuntimeConfigView = {
  maxRecommendations: 25,
  pipelineSaturationUsd: 250000,
  staleContactThresholdDays: 14,
  highPipelineThresholdUsd: 50000,
  churnRiskHealthThreshold: 40,
  minPublishableConfidence: 0.2,
  weights: {
    pipeline: 0.25,
    intent: 0.2,
    staleness: 0.15,
    tier: 0.15,
    lifecycle: 0.15,
    healthRisk: 0.1,
  },
};

export function getRecommendation(accountId: string): Recommendation | undefined {
  return MOCK_RECOMMENDATIONS.find((r) => r.accountId === accountId);
}
