import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  NextBestActionType,
  ReasonCode,
  Recommendation,
} from "@repo/shared-schemas";
import { prioritizeAccounts, verifyRecommendation } from "agent-runtime";
import { loadTrajectoryCorpus } from "./corpus";

const REASON_CODES: readonly ReasonCode[] = [
  "high_open_pipeline",
  "verified_intent_signal",
  "stale_no_contact",
  "renewal_approaching",
  "churn_risk_detected",
  "strategic_tier_account",
  "stalled_opportunity",
  "new_executive_buyer",
  "no_qualifying_signal",
  "data_quality_blocked",
];
const ACTIONS: readonly NextBestActionType[] = [
  "call",
  "send_email",
  "schedule_meeting",
  "log_research_note",
  "no_action_hold",
];

type OracleRow = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  0 | 1,
];

const packageRoot = process.cwd();
const fixtureRoot = resolve(packageRoot, "src/fixtures/trajectory");
const outputRoot = resolve(packageRoot, "trajectory-generated");
const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const accountIdFor = (accountNumber: number): string =>
  `EVAL-ACC-${String(accountNumber).padStart(4, "0")}`;
const needsApproval = (recommendation: Recommendation): boolean =>
  recommendation.nextBestAction.customerFacing ||
  recommendation.nextBestAction.crmWriteBack;

const rawOracle = JSON.parse(
  readFileSync(resolve(fixtureRoot, "oracle.compact.json"), "utf8"),
) as { rows: OracleRow[]; tiers: string[]; lifecycles: string[] };
const rawManifest = JSON.parse(
  readFileSync(resolve(fixtureRoot, "manifest.json"), "utf8"),
) as Record<string, unknown>;
const rawProfile = JSON.parse(
  readFileSync(resolve(fixtureRoot, "dataset_profile.json"), "utf8"),
) as Record<string, unknown> & {
  synthetic_generation: Record<string, unknown>;
};
const { manifest, cases } = loadTrajectoryCorpus();

const candidatesByAccountId = new Map<string, Recommendation>();
for (const trajectoryCase of cases) {
  const candidate = prioritizeAccounts({
    runId: `trajectory_${trajectoryCase.caseId}`,
    contexts: [trajectoryCase.context],
    createdAt: manifest.evaluationNow,
  })[0];
  if (!candidate) {
    throw new Error(`No candidate for ${trajectoryCase.caseId}.`);
  }
  candidatesByAccountId.set(candidate.accountId, candidate);
}

const confidenceCodes = [
  ...new Set(
    [...candidatesByAccountId.values()].map(
      (candidate) => candidate.confidence,
    ),
  ),
].sort((left, right) => left - right);

const caseByAccountId = new Map(
  cases.map((trajectoryCase) => [
    trajectoryCase.context.account.id,
    trajectoryCase,
  ]),
);
const sourceRowByAccountId = new Map(
  rawOracle.rows.map((row) => [accountIdFor(row[0]), row]),
);

function regenerateRow(accountId: string): OracleRow {
  const source = sourceRowByAccountId.get(accountId);
  const candidate = candidatesByAccountId.get(accountId);
  if (!source || !candidate || !caseByAccountId.has(accountId)) {
    throw new Error(`Missing regeneration input for ${accountId}.`);
  }

  const confidenceCode = confidenceCodes.indexOf(candidate.confidence);
  const actionIndex = ACTIONS.indexOf(candidate.nextBestAction.type);
  if (confidenceCode < 0 || actionIndex < 0) {
    throw new Error(`Unmapped output for ${accountId}.`);
  }

  let reasonMask = 0;
  for (const reasonCode of candidate.reasonCodes) {
    const index = REASON_CODES.indexOf(reasonCode);
    if (index < 0) {
      throw new Error(`Unmapped reason code ${reasonCode} for ${accountId}.`);
    }
    reasonMask |= 1 << index;
  }

  const approved = needsApproval(candidate)
    ? { ...candidate, approvalStatus: "approved" as const }
    : candidate;
  const confidenceGatePasses = verifyRecommendation(
    approved,
    manifest.evaluationNow,
  ).allowed;

  return [
    source[0],
    Math.round(candidate.score * 100),
    confidenceCode,
    source[3],
    source[4],
    source[5],
    source[6],
    source[7],
    source[8],
    reasonMask,
    actionIndex,
    confidenceGatePasses ? 1 : 0,
  ];
}

const globalTop = prioritizeAccounts({
  runId: "trajectory_corpus_global_rank",
  contexts: cases.map((trajectoryCase) => trajectoryCase.context),
  createdAt: manifest.evaluationNow,
}).map((candidate) => candidate.accountId);
const topSet = new Set(globalTop);
const remaining = rawOracle.rows
  .map((row) => accountIdFor(row[0]))
  .filter((accountId) => !topSet.has(accountId));
const orderedAccountIds = [...globalTop, ...remaining];
const rows = orderedAccountIds.map(regenerateRow);

const oracle = {
  version: "trajectory-oracle-v2",
  seed: 23,
  evaluationNow: manifest.evaluationNow,
  columns: [
    "accountNumber",
    "scoreCents",
    "confidenceCode",
    "tierIndex",
    "lifecycleIndex",
    "openPipelineUsd",
    "daysSinceLastContact",
    "healthScore",
    "intentCount",
    "reasonMask",
    "actionIndex",
    "confidenceGatePasses",
  ],
  confidenceCodes,
  tiers: rawOracle.tiers,
  lifecycles: rawOracle.lifecycles,
  reasonCodes: REASON_CODES,
  actions: ACTIONS,
  rows,
};
const oracleText = `${JSON.stringify(oracle)}\n`;

const profile = {
  ...rawProfile,
  synthetic_generation: {
    ...rawProfile.synthetic_generation,
    input_contract_version: "current-input-contract-v2",
  },
};
const profileText = `${JSON.stringify(profile, null, 2)}\n`;

const outputManifest = {
  ...rawManifest,
  version: "trajectory-corpus-v2",
  inputContractVersion: "current-input-contract-v2",
  oracleSha256: sha256(oracleText),
  datasetProfileSha256: sha256(profileText),
  scoreRoundingCorrections: {},
};
const manifestText = `${JSON.stringify(outputManifest, null, 2)}\n`;

mkdirSync(outputRoot, { recursive: true });
writeFileSync(resolve(outputRoot, "oracle.compact.json"), oracleText);
writeFileSync(resolve(outputRoot, "dataset_profile.json"), profileText);
writeFileSync(resolve(outputRoot, "manifest.json"), manifestText);

console.log(
  JSON.stringify({
    outputRoot,
    rows: rows.length,
    confidenceCodes,
    top25: globalTop,
    oracleSha256: outputManifest.oracleSha256,
    datasetProfileSha256: outputManifest.datasetProfileSha256,
  }),
);
