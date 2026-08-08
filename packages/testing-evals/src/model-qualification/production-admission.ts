import {
  IMPLEMENTED_RUNTIME_MODEL_PROVIDERS,
  P4_PRODUCTION_MODEL_ADMISSION_CONTRACT_VERSION,
  parseProductionModelAdmission,
  type ProductionModelAdmission,
} from "agent-runtime";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
  P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
  hashQualificationMaterial,
  type ModelQualificationConfig,
} from "./qualification-contract";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS,
  CURRENT_SPINE_QUALIFICATION_CORPUS_HASH,
} from "./qualification-corpus";
import type {
  ModelQualificationReport,
  QualificationCandidateReport,
} from "./qualification-runner";

export interface ProductionModelAdmissionDecision {
  candidateId: string;
  decisionOwner: string;
  decisionRef: string;
}

const asRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const nonEmptyString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
};

/**
 * Admission consumes only a report from the versioned Unit 2 runner. The parser
 * checks the fields that can authorize production admission. The admission
 * builder then recomputes the locked policy identity and threshold predicates.
 */
export function parseQualificationReportForAdmission(
  value: unknown,
): ModelQualificationReport {
  const raw = asRecord(value, "qualification report");
  if (raw.contractVersion !== P4_MODEL_QUALIFICATION_CONTRACT_VERSION) {
    throw new Error("Qualification report contract version does not match the current runner.");
  }
  if (raw.corpusVersion !== CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION) {
    throw new Error("Qualification report corpus version does not match the current runner.");
  }
  if (raw.corpusHash !== CURRENT_SPINE_QUALIFICATION_CORPUS_HASH) {
    throw new Error("Qualification report corpus hash does not match the frozen corpus.");
  }
  if (raw.verdict !== "PASS" && raw.verdict !== "FAIL" && raw.verdict !== "BLOCKED") {
    throw new Error("Qualification report verdict is invalid.");
  }
  if (typeof raw.qualificationPolicyHash !== "string" || !/^[a-f0-9]{64}$/.test(raw.qualificationPolicyHash)) {
    throw new Error("Qualification report policy hash is invalid.");
  }
  if (typeof raw.generatedAt !== "string" || raw.generatedAt.length === 0) {
    throw new Error("Qualification report generatedAt is required.");
  }
  if (!Array.isArray(raw.candidates)) {
    throw new Error("Qualification report candidates must be an array.");
  }
  for (const [index, item] of raw.candidates.entries()) {
    const candidateReport = asRecord(item, `qualification report candidates[${index}]`);
    const candidate = asRecord(
      candidateReport.candidate,
      `qualification report candidates[${index}].candidate`,
    );
    nonEmptyString(candidate.id, `qualification report candidates[${index}].candidate.id`);
    if (
      candidateReport.verdict !== "QUALIFIED" &&
      candidateReport.verdict !== "DISQUALIFIED" &&
      candidateReport.verdict !== "BLOCKED"
    ) {
      throw new Error(`qualification report candidates[${index}].verdict is invalid.`);
    }
    if (!Array.isArray(candidateReport.reasons)) {
      throw new Error(`qualification report candidates[${index}].reasons must be an array.`);
    }
    asRecord(candidateReport.metrics, `qualification report candidates[${index}].metrics`);
    if (!Array.isArray(candidateReport.runs)) {
      throw new Error(`qualification report candidates[${index}].runs must be an array.`);
    }
  }
  return value as ModelQualificationReport;
}

export function qualificationPolicyHashForConfig(config: ModelQualificationConfig): string {
  const candidates = [...config.candidates].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return hashQualificationMaterial({ ...config, candidates });
}

const assertCandidateStillQualifies = (
  config: ModelQualificationConfig,
  report: QualificationCandidateReport,
): void => {
  const metrics = report.metrics;
  const expectedRuns = config.k * CURRENT_SPINE_QUALIFICATION_CORPUS.length;
  if (metrics.totalRuns !== expectedRuns || report.runs.length !== expectedRuns) {
    throw new Error("Selected candidate qualification run set is incomplete.");
  }
  if (metrics.falseAcceptRate !== 0 || metrics.falseAccepts !== 0) {
    throw new Error("Selected candidate violates the zero false-accept boundary.");
  }
  if (metrics.authorityViolations !== 0) {
    throw new Error("Selected candidate violated deterministic authority immutability.");
  }
  if (!metrics.requestIdentityStable) {
    throw new Error("Selected candidate request identity was not stable.");
  }
  if (metrics.modelVerifierPassRate < config.thresholds.minModelVerifierPassRate) {
    throw new Error("Selected candidate no longer satisfies the model verifier pass threshold.");
  }
  if (metrics.fallbackRate > config.thresholds.maxFallbackRate) {
    throw new Error("Selected candidate no longer satisfies the fallback threshold.");
  }
  if (
    config.thresholds.requireCompleteTokenTelemetry &&
    metrics.measuredTokenRuns !== metrics.totalRuns
  ) {
    throw new Error("Selected candidate token telemetry is incomplete.");
  }
  if (config.thresholds.maxP95LatencyMs !== undefined) {
    if (metrics.p95LatencyMs === null) {
      throw new Error("Selected candidate latency telemetry is incomplete.");
    }
    if (metrics.p95LatencyMs > config.thresholds.maxP95LatencyMs) {
      throw new Error("Selected candidate exceeds the admitted p95 latency threshold.");
    }
  }
  if (config.thresholds.maxCostPerVerifiedPassUsd !== undefined) {
    if (metrics.costPerVerifiedPassUsd === null) {
      throw new Error("Selected candidate cost evidence is incomplete.");
    }
    if (metrics.costPerVerifiedPassUsd > config.thresholds.maxCostPerVerifiedPassUsd) {
      throw new Error("Selected candidate exceeds the admitted cost-per-verified-PASS threshold.");
    }
  }
}

export function buildProductionModelAdmission(
  config: ModelQualificationConfig,
  report: ModelQualificationReport,
  decision: ProductionModelAdmissionDecision,
): ProductionModelAdmission {
  const candidateId = nonEmptyString(decision.candidateId, "decision.candidateId");
  const decisionOwner = nonEmptyString(decision.decisionOwner, "decision.decisionOwner");
  const decisionRef = nonEmptyString(decision.decisionRef, "decision.decisionRef");

  if (report.verdict !== "PASS") {
    throw new Error(`Qualification epoch must PASS before admission; received ${report.verdict}.`);
  }
  if (report.corpusHash !== CURRENT_SPINE_QUALIFICATION_CORPUS_HASH) {
    throw new Error("Qualification report does not use the current frozen corpus hash.");
  }
  const policyHash = qualificationPolicyHashForConfig(config);
  if (report.qualificationPolicyHash !== policyHash) {
    throw new Error("Qualification report policy hash does not match the locked qualification contract.");
  }

  const configuredCandidate = config.candidates.find((candidate) => candidate.id === candidateId);
  if (!configuredCandidate) {
    throw new Error(`Admission candidate ${candidateId} is not present in the locked qualification contract.`);
  }
  const candidateReport = report.candidates.find(
    (candidate) => candidate.candidate.id === candidateId,
  );
  if (!candidateReport) {
    throw new Error(`Admission candidate ${candidateId} is not present in the qualification report.`);
  }
  if (
    hashQualificationMaterial(candidateReport.candidate) !==
    hashQualificationMaterial(configuredCandidate)
  ) {
    throw new Error("Qualification report candidate identity differs from the locked contract.");
  }
  if (candidateReport.verdict !== "QUALIFIED" || candidateReport.reasons.length !== 0) {
    throw new Error(`Admission candidate ${candidateId} is not QUALIFIED.`);
  }

  assertCandidateStillQualifies(config, candidateReport);

  if (
    !IMPLEMENTED_RUNTIME_MODEL_PROVIDERS.includes(
      configuredCandidate.provider as (typeof IMPLEMENTED_RUNTIME_MODEL_PROVIDERS)[number],
    )
  ) {
    throw new Error(
      `Qualified candidate ${candidateId} uses ${configuredCandidate.provider}, but that provider has no admitted production adapter. Implement only the selected provider adapter before admission.`,
    );
  }

  return parseProductionModelAdmission({
    contractVersion: P4_PRODUCTION_MODEL_ADMISSION_CONTRACT_VERSION,
    decision: "ADMITTED",
    decisionOwner,
    decisionRef,
    candidateId,
    provider: configuredCandidate.provider,
    modelId: configuredCandidate.modelId,
    modelRevisionOrFingerprint: configuredCandidate.modelRevisionOrFingerprint ?? null,
    reasoningProfile: configuredCandidate.reasoningProfile,
    structuredOutputProfile: configuredCandidate.structuredOutputProfile,
    toolSchemaProfile: configuredCandidate.toolSchemaProfile,
    samplingProfile: configuredCandidate.samplingProfile,
    currentProductionWhatOwner: "deterministic",
    fallback: config.fallback,
    budgets: {
      timeoutMs: config.budgets.timeoutMs,
      maxOutputTokens: config.budgets.maxOutputTokens,
      maxInputTokens: config.budgets.maxInputTokens,
      maxSignals: config.budgets.maxSignals,
      maxConcurrent: config.budgets.maxConcurrent,
      maxRunTokens: config.budgets.maxRunTokens,
      maxEvidenceAgeDays: config.budgets.maxEvidenceAgeDays,
    },
    qualification: {
      contractVersion: report.contractVersion,
      corpusVersion: report.corpusVersion,
      corpusHash: report.corpusHash,
      qualificationPolicyHash: report.qualificationPolicyHash,
      reportHash: hashQualificationMaterial(report),
      generatedAt: report.generatedAt,
    },
  });
}
