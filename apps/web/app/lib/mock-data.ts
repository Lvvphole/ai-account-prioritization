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
const RUN = "run_demo";

/** The rep whose book the demo signs you into. */
export const DEMO_REP_ID = "rep_alex";

/**
 * Account directory. Recommendations reference accounts by id; the UI joins
 * against this to show the company a rep would actually recognize. In
 * production this join comes from the CRM `accounts` table.
 */
export interface AccountProfile {
  id: string;
  name: string;
  industry: string;
  tier: "Enterprise" | "Mid-market" | "SMB";
}

export const MOCK_ACCOUNTS: Record<string, AccountProfile> = {
  acc_001: {
    id: "acc_001",
    name: "Helios Manufacturing",
    industry: "Industrial Manufacturing",
    tier: "Enterprise",
  },
  acc_002: {
    id: "acc_002",
    name: "Northwind Retail",
    industry: "Retail & E-commerce",
    tier: "Mid-market",
  },
  acc_003: {
    id: "acc_003",
    name: "Cobalt Analytics",
    industry: "Data & Analytics",
    tier: "Mid-market",
  },
  acc_004: {
    id: "acc_004",
    name: "Pinecrest Logistics",
    industry: "Freight & Logistics",
    tier: "SMB",
  },
  acc_005: {
    id: "acc_005",
    name: "Vertex Health Systems",
    industry: "Healthcare",
    tier: "Enterprise",
  },
  acc_006: {
    id: "acc_006",
    name: "Larkspur Financial",
    industry: "Financial Services",
    tier: "Enterprise",
  },
  acc_007: {
    id: "acc_007",
    name: "Quarry Software",
    industry: "B2B Software",
    tier: "Mid-market",
  },
  acc_008: {
    id: "acc_008",
    name: "Bluepeak Energy",
    industry: "Energy & Utilities",
    tier: "Mid-market",
  },
  acc_009: {
    id: "acc_009",
    name: "Tidewater Foods",
    industry: "Food & Beverage",
    tier: "SMB",
  },
};

/** Rep directory, so coverage reports name people rather than owner ids. */
export const MOCK_REPS: Record<string, { id: string; name: string }> = {
  rep_alex: { id: "rep_alex", name: "Alex Rivera" },
  rep_priya: { id: "rep_priya", name: "Priya Raman" },
  rep_marco: { id: "rep_marco", name: "Marco Silva" },
};

/** Display name for an account id, falling back to the raw id. */
export function accountName(accountId: string): string {
  return MOCK_ACCOUNTS[accountId]?.name ?? accountId;
}

export function accountProfile(accountId: string): AccountProfile | undefined {
  return MOCK_ACCOUNTS[accountId];
}

/** Display name for a rep id, falling back to the raw id. */
export function repName(ownerId: string): string {
  return MOCK_REPS[ownerId]?.name ?? ownerId;
}

const passed = {
  status: "passed",
  schemaValid: true,
  guardrailsPassed: true,
  sourceSignalsVerified: true,
  permissionGranted: true,
  failedGates: [],
  checkedAt: ISO,
} as const;

export const MOCK_RECOMMENDATIONS: Recommendation[] = [
  {
    id: "rec_1",
    runId: RUN,
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
    verification: { ...passed, failedGates: [] },
    approvalStatus: "approved",
    published: true,
    createdAt: ISO,
  },
  {
    id: "rec_2",
    runId: RUN,
    accountId: "acc_006",
    ownerId: "rep_priya",
    score: 68.41,
    rank: 2,
    confidence: 0.79,
    reasonCodes: ["high_open_pipeline", "renewal_approaching"],
    reasonNarrative:
      "Priority #2 (score 68.41). Larkspur Financial carries significant open pipeline, has an approaching renewal.",
    sourceSignals: [
      { kind: "account", refId: "acc_006", description: "Open pipeline of $240,000.", verified: true },
      { kind: "opportunity", refId: "opp_006", description: "Renewal \"Larkspur FY26\" closes in 21 days.", verified: true },
    ],
    nextBestAction: {
      type: "schedule_meeting",
      customerFacing: true,
      crmWriteBack: false,
      objective: "Lock a renewal-planning session with Larkspur Financial before the term closes.",
    },
    verification: { ...passed, failedGates: [] },
    approvalStatus: "approved",
    published: true,
    createdAt: ISO,
  },
  {
    id: "rec_3",
    runId: RUN,
    accountId: "acc_005",
    ownerId: "rep_marco",
    score: 61.2,
    rank: 3,
    confidence: 0.71,
    reasonCodes: ["verified_intent_signal", "high_open_pipeline"],
    reasonNarrative:
      "Priority #3 (score 61.2). Vertex Health Systems shows recent verified buying intent, carries significant open pipeline.",
    sourceSignals: [
      { kind: "intent", refId: "act_011", description: "Verified intent signal: demo_request.", verified: true },
      { kind: "account", refId: "acc_005", description: "Open pipeline of $95,000.", verified: true },
    ],
    nextBestAction: {
      type: "call",
      customerFacing: true,
      crmWriteBack: false,
      objective: "Call Vertex Health Systems while the demo request is still warm.",
    },
    verification: { ...passed, failedGates: [] },
    approvalStatus: "approved",
    published: true,
    createdAt: ISO,
  },
  {
    id: "rec_4",
    runId: RUN,
    accountId: "acc_003",
    ownerId: "rep_alex",
    score: 51.07,
    rank: 4,
    confidence: 0.62,
    reasonCodes: ["verified_intent_signal", "stale_no_contact", "churn_risk_detected"],
    reasonNarrative:
      "Priority #4 (score 51.07). Cobalt Analytics shows churn-risk indicators, has gone without logged contact.",
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
    verification: { ...passed, failedGates: [] },
    approvalStatus: "approved",
    published: true,
    createdAt: ISO,
  },
  {
    id: "rec_5",
    runId: RUN,
    accountId: "acc_007",
    ownerId: "rep_priya",
    score: 47.86,
    rank: 5,
    confidence: 0.68,
    reasonCodes: ["stale_no_contact", "stalled_opportunity"],
    reasonNarrative:
      "Priority #5 (score 47.86). Quarry Software has gone without logged contact, has an open opportunity that needs a next step.",
    sourceSignals: [
      { kind: "derived", refId: "acc_007", description: "No logged contact for 31 days.", verified: true },
      { kind: "opportunity", refId: "opp_007", description: "Open opportunity \"Quarry Expansion\" worth $45,000 has not moved stage in 24 days.", verified: true },
    ],
    nextBestAction: {
      type: "send_email",
      customerFacing: true,
      crmWriteBack: false,
      objective: "Restart the stalled Quarry Software expansion with a specific next step.",
      draft: "Subject: Picking the expansion back up — Quarry Software\n\nHi Sam, ...",
    },
    verification: { ...passed, failedGates: [] },
    approvalStatus: "pending_approval",
    published: true,
    createdAt: ISO,
  },
  {
    id: "rec_6",
    runId: RUN,
    accountId: "acc_002",
    ownerId: "rep_alex",
    score: 40.2,
    rank: 6,
    confidence: 0.75,
    reasonCodes: ["renewal_approaching", "stalled_opportunity"],
    reasonNarrative:
      "Priority #6 (score 40.2). Northwind Retail has an approaching renewal, has an open opportunity that needs a next step.",
    sourceSignals: [
      { kind: "opportunity", refId: "opp_002", description: "Open opportunity \"Northwind Renewal FY26\" in negotiation stage worth $60,000.", verified: true },
    ],
    nextBestAction: {
      type: "schedule_meeting",
      customerFacing: true,
      crmWriteBack: false,
      objective: "Schedule a renewal-planning meeting with Northwind Retail.",
    },
    verification: { ...passed, failedGates: [] },
    approvalStatus: "approved",
    published: true,
    createdAt: ISO,
  },
  {
    id: "rec_7",
    runId: RUN,
    accountId: "acc_008",
    ownerId: "rep_marco",
    score: 36.54,
    rank: 7,
    confidence: 0.58,
    reasonCodes: ["renewal_approaching", "churn_risk_detected"],
    reasonNarrative:
      "Priority #7 (score 36.54). Bluepeak Energy has an approaching renewal, shows churn-risk indicators.",
    sourceSignals: [
      { kind: "account", refId: "acc_008", description: "Account health score is 38 (below churn-risk threshold).", verified: true },
      { kind: "opportunity", refId: "opp_008", description: "Renewal \"Bluepeak FY26\" worth $30,000 closes in 45 days.", verified: true },
    ],
    nextBestAction: {
      type: "call",
      customerFacing: true,
      crmWriteBack: false,
      objective: "Call Bluepeak Energy to get ahead of renewal risk.",
    },
    verification: { ...passed, failedGates: [] },
    approvalStatus: "pending_approval",
    published: true,
    createdAt: ISO,
  },
];

/** Recommendations currently held by the guardrails (illustrates fail-closed). */
export const MOCK_BLOCKED: {
  accountId: string;
  name: string;
  ownerId: string;
  failedGates: string[];
  detail: string;
}[] = [
  {
    accountId: "acc_004",
    name: "Pinecrest Logistics",
    ownerId: "rep_alex",
    failedGates: ["confidence_below_floor"],
    detail: "Confidence 0.14 is under the 0.2 publish floor.",
  },
  {
    accountId: "acc_009",
    name: "Tidewater Foods",
    ownerId: "rep_marco",
    failedGates: ["data_quality_blocked"],
    detail: "Owner id missing on two source records; evidence could not be verified.",
  },
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
