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
  type QualificationCandidate,
} from "./qualification-contract";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS,
  CURRENT_SPINE_QUALIFICATION_CORPUS_HASH,
} from "./qualification-corpus";
import type {
  ModelQualificationReport,
  QualificationCandidateReport,
  QualificationRunRecord,
  QualificationRevisionEvidence,
} from "./qualification-runner";

export interface ProductionModelAdmissionDecision {
  candidateId: string;
  decisionOwner: string;
  decisionRef: string;
}

interface RecomputedAdmissionMetrics {
  totalRuns: number;
  providerInvokedRuns: number;
  modelVerifierPasses: number;
  modelVerifierPassRate: number;
  fallbackRate: number;
  falseAccepts: number;
  falseAcceptRate: number;
  authorityViolations: number;
  requestIdentityStable: boolean;
  measuredTokenRuns: number;
  p95LatencyMs: number | null;
  costPerVerifiedPassUsd: number | null;
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

const optionalString = (value: unknown, path: string): string | undefined =>
  value === undefined ? undefined : nonEmptyString(value, path);

const nullableString = (value: unknown, path: string): string | null => {
  if (value === null) return null;
  return nonEmptyString(value, path);
};

const booleanValue = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean.`);
  return value;
};

const nullableBoolean = (value: unknown, path: string): boolean | null => {
  if (value === null) return null;
  return booleanValue(value, path);
};

const nonNegativeNumber = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a finite non-negative number.`);
  }
  return value;
};

const nullableNonNegativeNumber = (value: unknown, path: string): number | null => {
  if (value === null) return null;
  return nonNegativeNumber(value, path);
};

const positiveInteger = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive safe integer.`);
  }
  return value as number;
};

const nullableNonNegativeInteger = (value: unknown, path: string): number | null => {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative safe integer or null.`);
  }
  return value as number;
};

const nullableHash = (value: unknown, path: string): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${path} must be a lowercase SHA-256 hex string or null.`);
  }
  return value;
};

const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T => {
  if (!allowed.includes(value as T)) {
    throw new Error(`${path} has an unsupported value.`);
  }
  return value as T;
};

const nullableRecord = (value: unknown, path: string): Record<string, unknown> | null => {
  if (value === null) return null;
  return asRecord(value, path);
};

const parseRunRecord = (value: unknown, index: number): QualificationRunRecord => {
  const path = `qualification report run[${index}]`;
  const raw = asRecord(value, path);
  return {
    candidateId: nonEmptyString(raw.candidateId, `${path}.candidateId`),
    caseId: nonEmptyString(raw.caseId, `${path}.caseId`),
    runIndex: positiveInteger(raw.runIndex, `${path}.runIndex`),
    requestIdentityHash: nullableHash(raw.requestIdentityHash, `${path}.requestIdentityHash`),
    invocationStartHash: nullableHash(raw.invocationStartHash, `${path}.invocationStartHash`),
    inputTokenUpperBound: nullableNonNegativeInteger(
      raw.inputTokenUpperBound,
      `${path}.inputTokenUpperBound`,
    ),
    reservedRunTokens: nullableNonNegativeInteger(raw.reservedRunTokens, `${path}.reservedRunTokens`),
    effectiveProviderConfiguration: nullableRecord(
      raw.effectiveProviderConfiguration,
      `${path}.effectiveProviderConfiguration`,
    ),
    providerInvoked: booleanValue(raw.providerInvoked, `${path}.providerInvoked`),
    source: enumValue(
      raw.source,
      ["model", "template", "template_fallback", "held"] as const,
      `${path}.source`,
    ),
    schemaValidation: enumValue(
      raw.schemaValidation,
      ["not_run", "passed", "failed"] as const,
      `${path}.schemaValidation`,
    ),
    groundingValidation: enumValue(
      raw.groundingValidation,
      ["not_run", "passed", "failed"] as const,
      `${path}.groundingValidation`,
    ),
    qualificationOracleCorrect: nullableBoolean(
      raw.qualificationOracleCorrect,
      `${path}.qualificationOracleCorrect`,
    ),
    authorityImmutable: booleanValue(raw.authorityImmutable, `${path}.authorityImmutable`),
    verifierPass: booleanValue(raw.verifierPass, `${path}.verifierPass`),
    falseAccept: booleanValue(raw.falseAccept, `${path}.falseAccept`),
    failureCode: optionalString(raw.failureCode, `${path}.failureCode`),
    providerErrorCode: optionalString(raw.providerErrorCode, `${path}.providerErrorCode`),
    latencyMs: nullableNonNegativeNumber(raw.latencyMs, `${path}.latencyMs`),
    inputTokens: nullableNonNegativeInteger(raw.inputTokens, `${path}.inputTokens`),
    cachedInputTokens: nullableNonNegativeInteger(
      raw.cachedInputTokens,
      `${path}.cachedInputTokens`,
    ),
    outputTokens: nullableNonNegativeInteger(raw.outputTokens, `${path}.outputTokens`),
    costUsd: nullableNonNegativeNumber(raw.costUsd, `${path}.costUsd`),
    acceptedArtifactHash: nullableHash(raw.acceptedArtifactHash, `${path}.acceptedArtifactHash`),
    observedModelRevisionOrFingerprint: nullableString(
      raw.observedModelRevisionOrFingerprint,
      `${path}.observedModelRevisionOrFingerprint`,
    ),
    revisionEvidence: enumValue<QualificationRevisionEvidence>(
      raw.revisionEvidence,
      ["not_required", "not_observed_no_call", "matched", "mismatched", "missing"],
      `${path}.revisionEvidence`,
    ),
  };
};

/**
 * Admission consumes only a report from the versioned Unit 2 runner. Parse every
 * run record because admission recomputes the safety and effectiveness evidence
 * from those records instead of trusting aggregate metrics in a persisted JSON
 * report.
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
  if (
    typeof raw.qualificationPolicyHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.qualificationPolicyHash)
  ) {
    throw new Error("Qualification report policy hash is invalid.");
  }
  if (typeof raw.generatedAt !== "string" || raw.generatedAt.length === 0) {
    throw new Error("Qualification report generatedAt is required.");
  }
  if (!Array.isArray(raw.candidates)) {
    throw new Error("Qualification report candidates must be an array.");
  }

  const candidates = raw.candidates.map((item, index) => {
    const candidateReport = asRecord(item, `qualification report candidates[${index}]`);
    const candidate = asRecord(
      candidateReport.candidate,
      `qualification report candidates[${index}].candidate`,
    );
    nonEmptyString(candidate.id, `qualification report candidates[${index}].candidate.id`);
    const verdict = enumValue(
      candidateReport.verdict,
      ["QUALIFIED", "DISQUALIFIED", "BLOCKED"] as const,
      `qualification report candidates[${index}].verdict`,
    );
    if (!Array.isArray(candidateReport.reasons)) {
      throw new Error(`qualification report candidates[${index}].reasons must be an array.`);
    }
    const reasons = candidateReport.reasons.map((reason, reasonIndex) =>
      nonEmptyString(reason, `qualification report candidates[${index}].reasons[${reasonIndex}]`),
    );
    const metrics = asRecord(
      candidateReport.metrics,
      `qualification report candidates[${index}].metrics`,
    );
    if (!Array.isArray(candidateReport.runs)) {
      throw new Error(`qualification report candidates[${index}].runs must be an array.`);
    }
    const runs = candidateReport.runs.map(parseRunRecord);
    return {
      candidate: candidate as unknown as QualificationCandidate,
      verdict,
      reasons,
      metrics: metrics as unknown as QualificationCandidateReport["metrics"],
      runs,
    };
  });

  return {
    contractVersion: P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    corpusVersion: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    corpusHash: CURRENT_SPINE_QUALIFICATION_CORPUS_HASH,
    qualificationPolicyHash: raw.qualificationPolicyHash,
    executionMode: enumValue(
      raw.executionMode,
      ["serial_offline"] as const,
      "qualification report.executionMode",
    ),
    currentProductionWhatOwner: enumValue(
      raw.currentProductionWhatOwner,
      ["deterministic"] as const,
      "qualification report.currentProductionWhatOwner",
    ),
    targetWhatHowMetricsStatus: enumValue(
      raw.targetWhatHowMetricsStatus,
      ["not_applicable_until_separately_authorized"] as const,
      "qualification report.targetWhatHowMetricsStatus",
    ),
    generatedAt: raw.generatedAt,
    verdict: raw.verdict,
    candidates,
  };
}

export function qualificationPolicyHashForConfig(config: ModelQualificationConfig): string {
  const candidates = [...config.candidates].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return hashQualificationMaterial({ ...config, candidates });
}

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const percentile95 = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
};

const roundMoney = (value: number): number => Number(value.toFixed(12));

const recomputeRunCost = (
  candidate: QualificationCandidate,
  run: QualificationRunRecord,
): number | null => {
  if (!candidate.pricing || run.inputTokens === null || run.outputTokens === null) return null;
  const cached = run.cachedInputTokens ?? 0;
  if (cached > run.inputTokens) return null;
  if (cached > 0 && candidate.pricing.cachedInputUsdPerMillionTokens === undefined) return null;
  const uncachedInput = run.inputTokens - cached;
  const inputCost =
    (uncachedInput * candidate.pricing.inputUsdPerMillionTokens) / 1_000_000;
  const cachedCost =
    cached === 0
      ? 0
      : (cached * (candidate.pricing.cachedInputUsdPerMillionTokens as number)) / 1_000_000;
  const outputCost =
    (run.outputTokens * candidate.pricing.outputUsdPerMillionTokens) / 1_000_000;
  return roundMoney(inputCost + cachedCost + outputCost);
};

const expectedRevisionEvidence = (
  candidate: QualificationCandidate,
  run: QualificationRunRecord,
): QualificationRevisionEvidence => {
  if (!candidate.modelRevisionOrFingerprint) return "not_required";
  if (!run.providerInvoked) return "not_observed_no_call";
  if (!run.observedModelRevisionOrFingerprint) return "missing";
  return run.observedModelRevisionOrFingerprint === candidate.modelRevisionOrFingerprint
    ? "matched"
    : "mismatched";
};

const recomputeAdmissionMetrics = (
  config: ModelQualificationConfig,
  candidate: QualificationCandidate,
  report: QualificationCandidateReport,
): RecomputedAdmissionMetrics => {
  const expectedKeys = new Set<string>();
  for (const item of CURRENT_SPINE_QUALIFICATION_CORPUS) {
    for (let runIndex = 1; runIndex <= config.k; runIndex += 1) {
      expectedKeys.add(`${item.id}:${runIndex}`);
    }
  }
  if (report.runs.length !== expectedKeys.size) {
    throw new Error("Selected candidate qualification run set is incomplete.");
  }

  const seen = new Set<string>();
  for (const [index, run] of report.runs.entries()) {
    if (run.candidateId !== candidate.id) {
      throw new Error(`Qualification run ${index} belongs to a different candidate.`);
    }
    const key = `${run.caseId}:${run.runIndex}`;
    if (!expectedKeys.has(key) || seen.has(key)) {
      throw new Error("Selected candidate qualification run coverage is invalid.");
    }
    seen.add(key);

    const verifierPass =
      run.source === "model" &&
      run.schemaValidation === "passed" &&
      run.groundingValidation === "passed" &&
      run.authorityImmutable;
    if (run.verifierPass !== verifierPass) {
      throw new Error(`Qualification run ${key} has inconsistent verifier evidence.`);
    }
    if (run.source === "model" && run.qualificationOracleCorrect === null) {
      throw new Error(`Qualification run ${key} is missing the frozen-case oracle result.`);
    }
    if (run.source !== "model" && run.qualificationOracleCorrect !== null) {
      throw new Error(`Qualification run ${key} has an oracle result without an accepted model draft.`);
    }
    const falseAccept = verifierPass && run.qualificationOracleCorrect === false;
    if (run.falseAccept !== falseAccept) {
      throw new Error(`Qualification run ${key} has inconsistent false-accept evidence.`);
    }
    if (run.providerInvoked && (!run.requestIdentityHash || !run.invocationStartHash)) {
      throw new Error(`Qualification run ${key} is missing invocation identity evidence.`);
    }
    if (run.source === "model" && !run.providerInvoked) {
      throw new Error(`Qualification run ${key} claims model output without a provider invocation.`);
    }
    if (run.revisionEvidence !== expectedRevisionEvidence(candidate, run)) {
      throw new Error(`Qualification run ${key} has inconsistent model revision evidence.`);
    }
  }
  if (seen.size !== expectedKeys.size) {
    throw new Error("Selected candidate qualification run coverage is incomplete.");
  }

  const totalRuns = report.runs.length;
  const providerInvokedRuns = report.runs.filter((run) => run.providerInvoked).length;
  const modelVerifierPasses = report.runs.filter((run) => run.verifierPass).length;
  const fallbackRuns = report.runs.filter((run) => run.source !== "model").length;
  const falseAccepts = report.runs.filter((run) => run.falseAccept).length;
  const authorityViolations = report.runs.filter((run) => !run.authorityImmutable).length;
  const tokenRuns = report.runs.filter(
    (run) => run.inputTokens !== null && run.outputTokens !== null,
  );
  const latencies = report.runs.flatMap((run) =>
    run.latencyMs === null ? [] : [run.latencyMs],
  );

  let requestIdentityStable = true;
  for (const item of CURRENT_SPINE_QUALIFICATION_CORPUS) {
    const invokedRuns = report.runs.filter(
      (run) => run.caseId === item.id && run.providerInvoked,
    );
    if (invokedRuns.length === 0) continue;
    const identities = new Set(invokedRuns.map((run) => run.requestIdentityHash));
    if (identities.size !== 1 || identities.has(null)) requestIdentityStable = false;
  }

  const costs = report.runs.map((run) => recomputeRunCost(candidate, run));
  const totalCost = costs.every((cost) => cost !== null)
    ? roundMoney(costs.reduce((sum, cost) => sum + (cost as number), 0))
    : null;

  return {
    totalRuns,
    providerInvokedRuns,
    modelVerifierPasses,
    modelVerifierPassRate: ratio(modelVerifierPasses, totalRuns),
    fallbackRate: ratio(fallbackRuns, totalRuns),
    falseAccepts,
    falseAcceptRate: ratio(falseAccepts, totalRuns),
    authorityViolations,
    requestIdentityStable,
    measuredTokenRuns: tokenRuns.length,
    p95LatencyMs: percentile95(latencies),
    costPerVerifiedPassUsd:
      totalCost !== null && modelVerifierPasses > 0
        ? roundMoney(totalCost / modelVerifierPasses)
        : null,
  };
};

const assertCandidateStillQualifies = (
  config: ModelQualificationConfig,
  candidate: QualificationCandidate,
  report: QualificationCandidateReport,
): void => {
  const metrics = recomputeAdmissionMetrics(config, candidate, report);

  if (metrics.providerInvokedRuns === 0 || metrics.modelVerifierPasses === 0) {
    throw new Error("Selected candidate has no successful real model qualification evidence.");
  }
  if (report.runs.some((run) => run.revisionEvidence === "missing")) {
    throw new Error("Selected candidate is missing required model revision evidence.");
  }
  if (report.runs.some((run) => run.revisionEvidence === "mismatched")) {
    throw new Error("Selected candidate model revision evidence mismatched the locked contract.");
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
};

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

  assertCandidateStillQualifies(config, configuredCandidate, candidateReport);

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
