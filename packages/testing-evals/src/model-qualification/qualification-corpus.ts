import type { Account, Opportunity, Recommendation } from "@repo/shared-schemas";
import type { attachHybridActionDraft } from "agent-runtime";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
  hashQualificationMaterial,
} from "./qualification-contract";

type AccountContext = Parameters<typeof attachHybridActionDraft>[1];

export interface CurrentSpineQualificationCase {
  id: string;
  recommendation: Recommendation;
  context: AccountContext;
  now: string;
}

const ISO = "2026-08-01T05:00:00.000Z";

const pipelineAccount: Account = {
  id: "qual_acc_pipeline",
  name: "Qualification Pipeline Account",
  ownerId: "qual_rep",
  tier: "strategic",
  lifecycleStage: "open_opportunity",
  openPipelineUsd: 50000,
  intentSignals: [],
  dataQualityFlags: [],
  createdAt: ISO,
  updatedAt: ISO,
};

const pipelineOpportunity: Opportunity = {
  id: "qual_opp_pipeline",
  accountId: pipelineAccount.id,
  name: "Qualification expansion",
  stage: "discovery",
  amountUsd: 50000,
  probability: 0.5,
  isClosed: false,
  isWon: false,
  createdAt: ISO,
  updatedAt: ISO,
};

const pipelineRecommendation: Recommendation = {
  id: "qual_rec_pipeline",
  runId: "qual_run",
  accountId: pipelineAccount.id,
  ownerId: pipelineAccount.ownerId,
  score: 80,
  rank: 1,
  confidence: 0.9,
  reasonCodes: ["high_open_pipeline"],
  reasonNarrative: "Qualification Pipeline Account has 50000 in open pipeline.",
  sourceSignals: [
    {
      kind: "opportunity",
      refId: pipelineOpportunity.id,
      description: "Qualification Pipeline Account has 50000 in open pipeline",
      verified: true,
    },
  ],
  nextBestAction: {
    type: "call",
    customerFacing: true,
    crmWriteBack: false,
    objective: "Review the open opportunity.",
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
  approvalStatus: "pending_approval",
  published: false,
  createdAt: ISO,
};

const staleAccount: Account = {
  id: "qual_acc_stale",
  name: "Qualification Stale Account",
  ownerId: "qual_rep",
  tier: "mid_market",
  lifecycleStage: "customer",
  openPipelineUsd: 0,
  intentSignals: [],
  dataQualityFlags: [],
  createdAt: ISO,
  updatedAt: ISO,
};

const staleRecommendation: Recommendation = {
  id: "qual_rec_stale",
  runId: "qual_run",
  accountId: staleAccount.id,
  ownerId: staleAccount.ownerId,
  score: 62,
  rank: 2,
  confidence: 0.8,
  reasonCodes: ["stale_no_contact"],
  reasonNarrative: "Qualification Stale Account has no logged contact for 45 days.",
  sourceSignals: [
    {
      kind: "derived",
      refId: staleAccount.id,
      description: "No logged contact for 45 days.",
      verified: true,
    },
  ],
  nextBestAction: {
    type: "log_research_note",
    customerFacing: false,
    crmWriteBack: true,
    objective: "Record the stale-contact risk before additional research.",
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
  approvalStatus: "pending_approval",
  published: false,
  createdAt: ISO,
};

export const CURRENT_SPINE_QUALIFICATION_CORPUS: readonly CurrentSpineQualificationCase[] = [
  {
    id: "open-pipeline-call",
    recommendation: pipelineRecommendation,
    context: {
      account: pipelineAccount,
      contacts: [],
      opportunities: [pipelineOpportunity],
      activities: [],
    },
    now: ISO,
  },
  {
    id: "stale-account-research-note",
    recommendation: staleRecommendation,
    context: {
      account: staleAccount,
      contacts: [],
      opportunities: [],
      activities: [],
    },
    now: ISO,
  },
] as const;

export const CURRENT_SPINE_QUALIFICATION_CORPUS_HASH = hashQualificationMaterial({
  version: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
  cases: CURRENT_SPINE_QUALIFICATION_CORPUS,
});
