import type { Recommendation } from "@repo/shared-schemas";
import {
  RuntimeModelError,
  attachHybridActionDraft,
  createRuntimeDraftRunBudget,
  type HybridDraftInvocationStart,
  type RuntimeDraftingPolicy,
  type RuntimeModelInvocationConfig,
  type RuntimeModelRequest,
  type RuntimeModelTelemetry,
} from "agent-runtime";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
  P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
  QualificationDependencyError,
  hashQualificationMaterial,
  type ModelQualificationConfig,
  type QualificationCandidate,
  type QualificationCandidateVerdict,
  type QualificationClientResolver,
  type QualificationOverallVerdict,
} from "./qualification-contract";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS,
  CURRENT_SPINE_QUALIFICATION_CORPUS_HASH,
  type CurrentSpineQualificationCase,
} from "./qualification-corpus";

export type QualificationRevisionEvidence =
  | "not_required"
  | "not_observed_no_call"
  | "matched"
  | "mismatched"
  | "missing";

export interface QualificationRunRecord {
  candidateId: string;
  caseId: string;
  runIndex: number;
  requestIdentityHash: string | null;
  invocationStartHash: string | null;
  inputTokenUpperBound: number | null;
  reservedRunTokens: number | null;
  effectiveProviderConfiguration: Record<string, unknown> | null;
  providerInvoked: boolean;
  source: "model" | "template" | "template_fallback" | "held";
  schemaValidation: "not_run" | "passed" | "failed";
  groundingValidation: "not_run" | "passed" | "failed";
  qualificationOracleCorrect: boolean | null;
  authorityImmutable: boolean;
  verifierPass: boolean;
  falseAccept: boolean;
  failureCode?: string;
  providerErrorCode?: string;
  latencyMs: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  acceptedArtifactHash: string | null;
  observedModelRevisionOrFingerprint: string | null;
  revisionEvidence: QualificationRevisionEvidence;
}

export interface QualificationMetrics {
  totalRuns: number;
  modelVerifierPasses: number;
  modelVerifierPassRate: number;
  fallbackOrHoldRuns: number;
  fallbackRate: number;
  falseAccepts: number;
  falseAcceptRate: number;
  authorityViolations: number;
  qualificationOracleCorrectRuns: number;
  schemaPassRate: number;
  groundingPassRate: number;
  requestIdentityStable: boolean;
  acceptedArtifactVariantsByCase: Record<string, number>;
  measuredLatencyRuns: number;
  p95LatencyMs: number | null;
  measuredTokenRuns: number;
  totalInputTokens: number | null;
  totalCachedInputTokens: number | null;
  totalOutputTokens: number | null;
  measuredCostRuns: number;
  totalCostUsd: number | null;
  costPerVerifiedPassUsd: number | null;
  canonicalWhatCorrectness: null;
  canonicalWhatAgreement: null;
  howAdmissibility: null;
  toolSelectionCorrectness: null;
  delegationValidity: null;
}

export interface QualificationCandidateReport {
  candidate: QualificationCandidate;
  verdict: QualificationCandidateVerdict;
  reasons: string[];
  metrics: QualificationMetrics;
  runs: QualificationRunRecord[];
}

export interface ModelQualificationReport {
  contractVersion: typeof P4_MODEL_QUALIFICATION_CONTRACT_VERSION;
  corpusVersion: typeof CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION;
  corpusHash: string;
  qualificationPolicyHash: string;
  executionMode: "serial_offline";
  currentProductionWhatOwner: "deterministic";
  targetWhatHowMetricsStatus: "not_applicable_until_separately_authorized";
  generatedAt: string;
  verdict: QualificationOverallVerdict;
  candidates: QualificationCandidateReport[];
}

const orderedObject = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(orderedObject);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return Object.fromEntries(entries.map(([key, child]) => [key, orderedObject(child)]));
};

const authorityProjection = (recommendation: Recommendation): unknown => {
  const { draft: _draft, ...nextBestAction } = recommendation.nextBestAction;
  return orderedObject({ ...recommendation, nextBestAction });
};

const authorityIsImmutable = (before: Recommendation, after: Recommendation): boolean =>
  hashQualificationMaterial(authorityProjection(before)) ===
  hashQualificationMaterial(authorityProjection(after));

const normalizedText = (value: string): string =>
  value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();

const acceptedDraftMatchesOracle = (
  item: CurrentSpineQualificationCase,
  citations: readonly { text: string; sourceSignalIds: string[] }[],
): boolean => {
  if (citations.length === 0) return false;
  const citedEvidence = new Set(citations.flatMap((citation) => citation.sourceSignalIds));
  if (item.oracle.requiredEvidenceIds.some((id) => !citedEvidence.has(id))) return false;
  const text = normalizedText(citations.map((citation) => citation.text).join(" "));
  if (
    item.oracle.requiredTextFragments.some(
      (fragment) => !text.includes(normalizedText(fragment)),
    )
  ) {
    return false;
  }
  return item.oracle.forbiddenTextFragments.every(
    (fragment) => !text.includes(normalizedText(fragment)),
  );
};

const revisionEvidenceFor = (
  candidate: QualificationCandidate,
  providerInvoked: boolean,
  observed: string | undefined,
): QualificationRevisionEvidence => {
  if (!candidate.modelRevisionOrFingerprint) return "not_required";
  if (!providerInvoked) return "not_observed_no_call";
  if (!observed) return "missing";
  return observed === candidate.modelRevisionOrFingerprint ? "matched" : "mismatched";
};

const roundMoney = (value: number): number => Number(value.toFixed(12));

const costForRun = (
  candidate: QualificationCandidate,
  telemetry: RuntimeModelTelemetry | undefined,
): number | null => {
  if (!candidate.pricing || telemetry?.inputTokens === undefined || telemetry.outputTokens === undefined) {
    return null;
  }
  const cached = telemetry.cachedInputTokens ?? 0;
  if (cached > telemetry.inputTokens) return null;
  if (cached > 0 && candidate.pricing.cachedInputUsdPerMillionTokens === undefined) return null;
  const uncached = telemetry.inputTokens - cached;
  const inputCost =
    (uncached * candidate.pricing.inputUsdPerMillionTokens) / 1_000_000;
  const cachedCost =
    cached === 0
      ? 0
      : (cached * (candidate.pricing.cachedInputUsdPerMillionTokens as number)) / 1_000_000;
  const outputCost =
    (telemetry.outputTokens * candidate.pricing.outputUsdPerMillionTokens) / 1_000_000;
  return roundMoney(inputCost + cachedCost + outputCost);
};

const percentile95 = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
};

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const emptyMetrics = (): QualificationMetrics => ({
  totalRuns: 0,
  modelVerifierPasses: 0,
  modelVerifierPassRate: 0,
  fallbackOrHoldRuns: 0,
  fallbackRate: 0,
  falseAccepts: 0,
  falseAcceptRate: 0,
  authorityViolations: 0,
  qualificationOracleCorrectRuns: 0,
  schemaPassRate: 0,
  groundingPassRate: 0,
  requestIdentityStable: false,
  acceptedArtifactVariantsByCase: {},
  measuredLatencyRuns: 0,
  p95LatencyMs: null,
  measuredTokenRuns: 0,
  totalInputTokens: null,
  totalCachedInputTokens: null,
  totalOutputTokens: null,
  measuredCostRuns: 0,
  totalCostUsd: null,
  costPerVerifiedPassUsd: null,
  canonicalWhatCorrectness: null,
  canonicalWhatAgreement: null,
  howAdmissibility: null,
  toolSelectionCorrectness: null,
  delegationValidity: null,
});

const aggregateMetrics = (
  runs: QualificationRunRecord[],
  cases: readonly CurrentSpineQualificationCase[],
): QualificationMetrics => {
  if (runs.length === 0) return emptyMetrics();
  const modelPasses = runs.filter((run) => run.verifierPass).length;
  const fallbackRuns = runs.filter((run) => run.source !== "model").length;
  const falseAccepts = runs.filter((run) => run.falseAccept).length;
  const authorityViolations = runs.filter((run) => !run.authorityImmutable).length;
  const oracleCorrect = runs.filter((run) => run.qualificationOracleCorrect === true).length;
  const schemaPasses = runs.filter((run) => run.schemaValidation === "passed").length;
  const groundingPasses = runs.filter((run) => run.groundingValidation === "passed").length;
  const latencies = runs.flatMap((run) => (run.latencyMs === null ? [] : [run.latencyMs]));
  const tokenRuns = runs.filter(
    (run) => run.inputTokens !== null && run.outputTokens !== null,
  );
  const costRuns = runs.filter((run) => run.costUsd !== null);
  const variants: Record<string, number> = {};
  let requestIdentityStable = true;

  for (const item of cases) {
    const caseRuns = runs.filter((run) => run.caseId === item.id);
    const invokedRuns = caseRuns.filter((run) => run.providerInvoked);
    const identities = new Set(
      invokedRuns.flatMap((run) => (run.requestIdentityHash ? [run.requestIdentityHash] : [])),
    );
    if (
      invokedRuns.length > 0 &&
      (identities.size !== 1 || invokedRuns.some((run) => run.requestIdentityHash === null))
    ) {
      requestIdentityStable = false;
    }
    variants[item.id] = new Set(
      caseRuns.flatMap((run) => (run.acceptedArtifactHash ? [run.acceptedArtifactHash] : [])),
    ).size;
  }

  const totalCost =
    costRuns.length === runs.length
      ? roundMoney(costRuns.reduce((sum, run) => sum + (run.costUsd as number), 0))
      : null;

  return {
    totalRuns: runs.length,
    modelVerifierPasses: modelPasses,
    modelVerifierPassRate: ratio(modelPasses, runs.length),
    fallbackOrHoldRuns: fallbackRuns,
    fallbackRate: ratio(fallbackRuns, runs.length),
    falseAccepts,
    falseAcceptRate: ratio(falseAccepts, runs.length),
    authorityViolations,
    qualificationOracleCorrectRuns: oracleCorrect,
    schemaPassRate: ratio(schemaPasses, runs.length),
    groundingPassRate: ratio(groundingPasses, runs.length),
    requestIdentityStable,
    acceptedArtifactVariantsByCase: variants,
    measuredLatencyRuns: latencies.length,
    p95LatencyMs: percentile95(latencies),
    measuredTokenRuns: tokenRuns.length,
    totalInputTokens:
      tokenRuns.length === runs.length
        ? tokenRuns.reduce((sum, run) => sum + (run.inputTokens as number), 0)
        : null,
    totalCachedInputTokens:
      tokenRuns.length === runs.length
        ? tokenRuns.reduce((sum, run) => sum + (run.cachedInputTokens ?? 0), 0)
        : null,
    totalOutputTokens:
      tokenRuns.length === runs.length
        ? tokenRuns.reduce((sum, run) => sum + (run.outputTokens as number), 0)
        : null,
    measuredCostRuns: costRuns.length,
    totalCostUsd: totalCost,
    costPerVerifiedPassUsd:
      totalCost !== null && modelPasses > 0 ? roundMoney(totalCost / modelPasses) : null,
    canonicalWhatCorrectness: null,
    canonicalWhatAgreement: null,
    howAdmissibility: null,
    toolSelectionCorrectness: null,
    delegationValidity: null,
  };
};

const classifyCandidate = (
  config: ModelQualificationConfig,
  runs: QualificationRunRecord[],
  metrics: QualificationMetrics,
): { verdict: QualificationCandidateVerdict; reasons: string[] } => {
  const reasons: string[] = [];
  const expectedRuns = config.k * CURRENT_SPINE_QUALIFICATION_CORPUS.length;
  if (runs.length !== expectedRuns) {
    return { verdict: "BLOCKED", reasons: ["QUALIFICATION_RUN_SET_INCOMPLETE"] };
  }
  if (
    runs.length > 0 &&
    runs.every(
      (run) =>
        run.providerErrorCode === "DRAFT_MODEL_CONFIG_ERROR" ||
        run.providerErrorCode === "DRAFT_MODEL_HTTP_ERROR" ||
        run.providerErrorCode === "DRAFT_MODEL_TIMEOUT",
    )
  ) {
    return { verdict: "BLOCKED", reasons: ["PROVIDER_OR_MODEL_UNAVAILABLE"] };
  }

  if (runs.some((run) => run.revisionEvidence === "missing")) {
    return { verdict: "BLOCKED", reasons: ["MODEL_REVISION_EVIDENCE_MISSING"] };
  }
  if (runs.some((run) => run.revisionEvidence === "mismatched")) {
    reasons.push("MODEL_REVISION_MISMATCH");
  }
  if (metrics.falseAcceptRate > config.thresholds.maxFalseAcceptRate) {
    reasons.push("FALSE_ACCEPT_BOUND_FAILED");
  }
  if (metrics.authorityViolations > 0) reasons.push("AUTHORITY_IMMUTABILITY_FAILED");
  if (!metrics.requestIdentityStable) reasons.push("REQUEST_IDENTITY_UNSTABLE");
  if (metrics.modelVerifierPassRate < config.thresholds.minModelVerifierPassRate) {
    reasons.push("MODEL_VERIFIER_PASS_RATE_FAILED");
  }
  if (metrics.fallbackRate > config.thresholds.maxFallbackRate) {
    reasons.push("FALLBACK_RATE_FAILED");
  }

  if (
    config.thresholds.requireCompleteTokenTelemetry &&
    metrics.measuredTokenRuns !== metrics.totalRuns
  ) {
    return { verdict: "BLOCKED", reasons: [...reasons, "TOKEN_TELEMETRY_INCOMPLETE"] };
  }
  if (config.thresholds.maxP95LatencyMs !== undefined) {
    if (metrics.p95LatencyMs === null) {
      return { verdict: "BLOCKED", reasons: [...reasons, "LATENCY_TELEMETRY_INCOMPLETE"] };
    }
    if (metrics.p95LatencyMs > config.thresholds.maxP95LatencyMs) {
      reasons.push("P95_LATENCY_BOUND_FAILED");
    }
  }
  if (config.thresholds.maxCostPerVerifiedPassUsd !== undefined) {
    if (metrics.costPerVerifiedPassUsd === null) {
      return { verdict: "BLOCKED", reasons: [...reasons, "COST_EVIDENCE_INCOMPLETE"] };
    }
    if (metrics.costPerVerifiedPassUsd > config.thresholds.maxCostPerVerifiedPassUsd) {
      reasons.push("COST_PER_VERIFIED_PASS_BOUND_FAILED");
    }
  }

  return reasons.length > 0
    ? { verdict: "DISQUALIFIED", reasons }
    : { verdict: "QUALIFIED", reasons: [] };
};

const runCandidate = async (
  config: ModelQualificationConfig,
  candidate: QualificationCandidate,
  resolveClient: QualificationClientResolver,
): Promise<QualificationCandidateReport> => {
  let resolved;
  try {
    resolved = resolveClient(candidate);
  } catch (error) {
    const reason =
      error instanceof QualificationDependencyError ? error.code : "QUALIFICATION_DEPENDENCY_ERROR";
    return {
      candidate,
      verdict: "BLOCKED",
      reasons: [reason],
      metrics: emptyMetrics(),
      runs: [],
    };
  }

  const policy: RuntimeDraftingPolicy = {
    enabled: true,
    provider: candidate.provider,
    apiKey: resolved.credential,
    model: candidate.modelId,
    timeoutMs: config.budgets.timeoutMs,
    maxTokens: config.budgets.maxOutputTokens,
    maxInputTokens: config.budgets.maxInputTokens,
    maxSignals: config.budgets.maxSignals,
    maxConcurrent: config.budgets.maxConcurrent,
    maxRunTokens: config.budgets.maxRunTokens,
    maxEvidenceAgeDays: config.budgets.maxEvidenceAgeDays,
    maxAttempts: 1,
    fallback: config.fallback,
    reasoningEffort: candidate.reasoningProfile,
    outputFormat: "json_schema",
  };

  const runs: QualificationRunRecord[] = [];
  const cases = [...CURRENT_SPINE_QUALIFICATION_CORPUS].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  // One candidate receives one shared reservation budget for the complete frozen
  // case set and all repeated runs. A repeated call cannot reset spend authority.
  const runBudget = createRuntimeDraftRunBudget(config.budgets.maxRunTokens);

  for (const item of cases) {
    for (let runIndex = 1; runIndex <= config.k; runIndex += 1) {
      let request: RuntimeModelRequest | undefined;
      let invocationConfig: RuntimeModelInvocationConfig | undefined;
      let providerConfig: Record<string, unknown> | null = null;
      let invocationStart: HybridDraftInvocationStart | undefined;
      let providerErrorCode: string | undefined;
      let observedCallLatencyMs: number | null = null;

      const capturingClient = {
        async generate(modelRequest: RuntimeModelRequest, callConfig: RuntimeModelInvocationConfig) {
          request = modelRequest;
          invocationConfig = callConfig;
          providerConfig = resolved.effectiveProviderConfiguration(modelRequest, callConfig);
          const started = Date.now();
          try {
            return await resolved.client.generate(modelRequest, callConfig);
          } catch (error) {
            if (error instanceof RuntimeModelError) providerErrorCode = error.code;
            throw error;
          } finally {
            observedCallLatencyMs = Date.now() - started;
          }
        },
      };

      const result = await attachHybridActionDraft(item.recommendation, item.context, {
        policy,
        now: item.now,
        runBudget,
        modelClient: capturingClient,
        beforeModelInvoke: async (start) => {
          invocationStart = start;
        },
      });

      const telemetry = result.outcome.telemetry;
      const immutable = authorityIsImmutable(item.recommendation, result.recommendation);
      const oracleCorrect =
        result.outcome.source === "model"
          ? acceptedDraftMatchesOracle(item, result.outcome.claimCitations)
          : null;
      const verifierPass =
        result.outcome.source === "model" &&
        result.outcome.schemaValidation === "passed" &&
        result.outcome.groundingValidation === "passed" &&
        immutable;
      const falseAccept =
        result.outcome.source === "model" && verifierPass && oracleCorrect === false;
      const providerInvoked = request !== undefined && invocationConfig !== undefined;
      const observedRevision = telemetry?.modelRevisionOrFingerprint;
      const revisionEvidence = revisionEvidenceFor(
        candidate,
        providerInvoked,
        observedRevision,
      );
      const nonSecretInvocation =
        request && invocationConfig
          ? {
              request,
              config: {
                provider: invocationConfig.provider,
                model: invocationConfig.model,
                timeoutMs: invocationConfig.timeoutMs,
                maxOutputTokens: invocationConfig.maxOutputTokens,
                reasoningEffort: invocationConfig.reasoningEffort,
              },
              candidateRevision: candidate.modelRevisionOrFingerprint ?? null,
              corpusVersion: config.corpusVersion,
              caseId: item.id,
            }
          : null;
      const acceptedArtifactHash =
        result.outcome.source === "model"
          ? hashQualificationMaterial({
              actionType: result.recommendation.nextBestAction.type,
              draft: result.recommendation.nextBestAction.draft ?? null,
              citations: result.outcome.claimCitations
                .map((citation) => ({
                  text: citation.text.replace(/\s+/g, " ").trim(),
                  sourceSignalIds: [...citation.sourceSignalIds].sort(),
                }))
                .sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0)),
            })
          : null;

      runs.push({
        candidateId: candidate.id,
        caseId: item.id,
        runIndex,
        requestIdentityHash: nonSecretInvocation
          ? hashQualificationMaterial(nonSecretInvocation)
          : null,
        invocationStartHash: invocationStart ? hashQualificationMaterial(invocationStart) : null,
        inputTokenUpperBound: invocationStart?.inputTokenUpperBound ?? null,
        reservedRunTokens: invocationStart?.reservedRunTokens ?? null,
        effectiveProviderConfiguration: providerConfig,
        providerInvoked,
        source: result.outcome.source,
        schemaValidation: result.outcome.schemaValidation,
        groundingValidation: result.outcome.groundingValidation,
        qualificationOracleCorrect: oracleCorrect,
        authorityImmutable: immutable,
        verifierPass,
        falseAccept,
        failureCode: result.outcome.failureCode,
        providerErrorCode,
        latencyMs: telemetry?.latencyMs ?? observedCallLatencyMs,
        inputTokens: telemetry?.inputTokens ?? null,
        cachedInputTokens: telemetry?.cachedInputTokens ?? null,
        outputTokens: telemetry?.outputTokens ?? null,
        costUsd: costForRun(candidate, telemetry),
        acceptedArtifactHash,
        observedModelRevisionOrFingerprint: observedRevision ?? null,
        revisionEvidence,
      });
    }
  }

  const metrics = aggregateMetrics(runs, cases);
  const classification = classifyCandidate(config, runs, metrics);
  return {
    candidate,
    verdict: classification.verdict,
    reasons: classification.reasons,
    metrics,
    runs,
  };
};

export async function runCurrentSpineModelQualification(
  config: ModelQualificationConfig,
  resolveClient: QualificationClientResolver,
  now: () => string = () => new Date().toISOString(),
): Promise<ModelQualificationReport> {
  const sortedCandidates = [...config.candidates].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const candidateReports: QualificationCandidateReport[] = [];
  for (const candidate of sortedCandidates) {
    candidateReports.push(await runCandidate(config, candidate, resolveClient));
  }

  const verdict: QualificationOverallVerdict = candidateReports.some(
    (candidate) => candidate.verdict === "BLOCKED",
  )
    ? "BLOCKED"
    : candidateReports.some((candidate) => candidate.verdict === "QUALIFIED")
      ? "PASS"
      : "FAIL";

  return {
    contractVersion: P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    corpusVersion: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    corpusHash: CURRENT_SPINE_QUALIFICATION_CORPUS_HASH,
    qualificationPolicyHash: hashQualificationMaterial({
      ...config,
      candidates: sortedCandidates,
    }),
    executionMode: "serial_offline",
    currentProductionWhatOwner: "deterministic",
    targetWhatHowMetricsStatus: "not_applicable_until_separately_authorized",
    generatedAt: now(),
    verdict,
    candidates: candidateReports,
  };
}
