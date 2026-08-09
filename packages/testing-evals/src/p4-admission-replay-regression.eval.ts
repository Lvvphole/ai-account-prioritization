import { describe, expect, it } from "vitest";
import {
  buildBudgetedDraftRequest,
  hybridDraftContractMetadata,
  normalizeRuntimeDraftingPolicy,
  runtimeModelInvocationConfigFromDraftingPolicy,
  type HybridDraftInvocationStart,
  type RuntimeDraftingPolicy,
} from "agent-runtime";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
  P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
  buildQualificationRuntimeDraftingPolicy,
  hashQualificationMaterial,
  parseModelQualificationConfig,
  type ModelQualificationConfig,
  type QualificationCandidate,
} from "./model-qualification/qualification-contract";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS,
  CURRENT_SPINE_QUALIFICATION_CORPUS_HASH,
  type CurrentSpineQualificationCase,
} from "./model-qualification/qualification-corpus";
import {
  buildProductionModelAdmission,
  qualificationPolicyHashForConfig,
} from "./model-qualification/production-admission";
import type {
  ModelQualificationReport,
  QualificationRunRecord,
} from "./model-qualification/qualification-runner";

const fixedConfig = (): ModelQualificationConfig =>
  parseModelQualificationConfig({
    contractVersion: P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    corpusVersion: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    k: 1,
    fallback: "template",
    qualificationEpochMaxRunTokens: 20000,
    budgets: {
      timeoutMs: 1000,
      maxOutputTokens: 200,
      maxInputTokens: 4000,
      maxSignals: 2,
      maxConcurrent: 1,
      maxRunTokens: 20000,
      maxEvidenceAgeDays: 90,
    },
    thresholds: {
      minModelVerifierPassRate: 1,
      maxFallbackRate: 0,
      maxFalseAcceptRate: 0,
      requireCompleteTokenTelemetry: true,
    },
    candidates: [
      {
        id: "candidate-a",
        provider: "anthropic",
        modelId: "pinned-test-model",
        reasoningProfile: "medium",
        structuredOutputProfile: "json_schema",
        toolSchemaProfile: "not_applicable_current_spine",
        samplingProfile: "provider_default",
        credentialEnv: "P4_TEST_KEY",
      },
    ],
  });

const runRecord = (
  config: ModelQualificationConfig,
  candidate: QualificationCandidate,
  item: CurrentSpineQualificationCase,
): QualificationRunRecord => {
  const policy = buildQualificationRuntimeDraftingPolicy(config, candidate, "test-secret");
  const prepared = buildBudgetedDraftRequest(item.recommendation, item.context, policy, item.now);
  const invocationConfig = runtimeModelInvocationConfigFromDraftingPolicy(policy);
  const contract = hybridDraftContractMetadata(policy);
  const reservedRunTokens = prepared.inputTokenUpperBound + config.budgets.maxOutputTokens;
  const selectedSourceSignalIds = [
    ...new Set(prepared.context.signals.map((signal) => signal.id)),
  ];
  const invocationStart: HybridDraftInvocationStart = {
    recommendationId: item.recommendation.id,
    accountId: item.recommendation.accountId,
    selectedSourceSignalIds,
    provider: policy.provider,
    model: policy.model ?? null,
    promptVersion: contract.promptVersion,
    promptHash: contract.promptHash,
    schemaVersion: contract.schemaVersion,
    policyVersion: contract.policyVersion,
    effectivePolicy: contract.effectivePolicy,
    effectivePolicyHash: contract.effectivePolicyHash,
    groundingVersion: contract.groundingVersion,
    inputTokenUpperBound: prepared.inputTokenUpperBound,
    reservedRunTokens,
  };

  return {
    candidateId: candidate.id,
    caseId: item.id,
    runIndex: 1,
    requestIdentityHash: hashQualificationMaterial({
      request: prepared.request,
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
    }),
    invocationStartHash: hashQualificationMaterial(invocationStart),
    inputTokenUpperBound: prepared.inputTokenUpperBound,
    reservedRunTokens,
    effectiveProviderConfiguration: { model: candidate.modelId },
    providerInvoked: true,
    source: "model",
    schemaValidation: "passed",
    groundingValidation: "passed",
    qualificationOracleCorrect: true,
    authorityImmutable: true,
    verifierPass: true,
    falseAccept: false,
    latencyMs: 10,
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 20,
    costUsd: null,
    acceptedArtifactHash: "3".repeat(64),
    observedModelRevisionOrFingerprint: null,
    revisionEvidence: "not_required",
  };
};

const qualifiedReport = (config: ModelQualificationConfig): ModelQualificationReport => {
  const candidate = config.candidates[0]!;
  const runs = CURRENT_SPINE_QUALIFICATION_CORPUS.map((item) =>
    runRecord(config, candidate, item),
  );

  return {
    contractVersion: P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    corpusVersion: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    corpusHash: CURRENT_SPINE_QUALIFICATION_CORPUS_HASH,
    qualificationPolicyHash: qualificationPolicyHashForConfig(config),
    executionMode: "serial_offline",
    currentProductionWhatOwner: "deterministic",
    targetWhatHowMetricsStatus: "not_applicable_until_separately_authorized",
    generatedAt: "2026-08-09T00:00:00.000Z",
    verdict: "PASS",
    candidates: [
      {
        candidate,
        verdict: "QUALIFIED",
        reasons: [],
        metrics: {
          totalRuns: runs.length,
          modelVerifierPasses: runs.length,
          modelVerifierPassRate: 1,
          fallbackOrHoldRuns: 0,
          fallbackRate: 0,
          falseAccepts: 0,
          falseAcceptRate: 0,
          authorityViolations: 0,
          qualificationOracleCorrectRuns: runs.length,
          schemaPassRate: 1,
          groundingPassRate: 1,
          requestIdentityStable: true,
          acceptedArtifactVariantsByCase: Object.fromEntries(
            CURRENT_SPINE_QUALIFICATION_CORPUS.map((item) => [item.id, 1]),
          ),
          measuredLatencyRuns: runs.length,
          p95LatencyMs: 10,
          measuredTokenRuns: runs.length,
          totalInputTokens: runs.length * 100,
          totalCachedInputTokens: 0,
          totalOutputTokens: runs.length * 20,
          measuredCostRuns: 0,
          totalCostUsd: null,
          costPerVerifiedPassUsd: null,
          canonicalWhatCorrectness: null,
          canonicalWhatAgreement: null,
          howAdmissibility: null,
          toolSelectionCorrectness: null,
          delegationValidity: null,
        },
        runs,
      },
    ],
  };
};

const injectedRuntimePolicy = (): RuntimeDraftingPolicy => ({
  enabled: true,
  provider: "anthropic",
  apiKey: "test-secret",
  model: "pinned-test-model",
  timeoutMs: 1000,
  maxTokens: 200,
  maxInputTokens: 4000,
  maxSignals: 2,
  maxConcurrent: 1,
  maxRunTokens: 20000,
  maxEvidenceAgeDays: 90,
  maxAttempts: 1,
  fallback: "template",
  reasoningEffort: "medium",
  outputFormat: "json_schema",
});

describe("P4 production admission replay boundary", () => {
  it("replays frozen qualification evidence under production before admission exists", () => {
    const config = fixedConfig();
    const report = qualifiedReport(config);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      expect(
        buildProductionModelAdmission(config, report, {
          candidateId: "candidate-a",
          decisionOwner: "product-owner",
          decisionRef: "decision://p4/pr60/admission-replay",
        }),
      ).toMatchObject({
        candidateId: "candidate-a",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/pr60/admission-replay",
      });

      expect(() => normalizeRuntimeDraftingPolicy(injectedRuntimePolicy())).toThrow(
        "requires a qualified production model admission",
      );
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
