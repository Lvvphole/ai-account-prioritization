import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeRuntimeDraftingPolicy,
  productionModelAdmissionHash,
  runtimeDraftingPolicyAuditSnapshot,
  runtimeDraftingPolicyFromEnv,
  type RuntimeDraftingPolicy,
} from "agent-runtime";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
  P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
  parseModelQualificationConfig,
  type ModelQualificationConfig,
  type QualificationCandidate,
} from "./model-qualification/qualification-contract";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS,
  CURRENT_SPINE_QUALIFICATION_CORPUS_HASH,
} from "./model-qualification/qualification-corpus";
import {
  buildProductionModelAdmission,
  qualificationPolicyHashForConfig,
} from "./model-qualification/production-admission";
import type {
  ModelQualificationReport,
  QualificationRunRecord,
} from "./model-qualification/qualification-runner";

const fixedConfig = (provider: "anthropic" | "xai" = "anthropic"): ModelQualificationConfig =>
  parseModelQualificationConfig({
    contractVersion: P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    corpusVersion: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    k: 2,
    fallback: "template",
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
        provider,
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
  candidate: QualificationCandidate,
  caseId: string,
  runIndex: number,
): QualificationRunRecord => ({
  candidateId: candidate.id,
  caseId,
  runIndex,
  requestIdentityHash: "1".repeat(64),
  invocationStartHash: "2".repeat(64),
  inputTokenUpperBound: 100,
  reservedRunTokens: 300,
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
});

const qualifiedReport = (config: ModelQualificationConfig): ModelQualificationReport => {
  const candidate = config.candidates[0]!;
  const runs = CURRENT_SPINE_QUALIFICATION_CORPUS.flatMap((item) =>
    Array.from({ length: config.k }, (_, index) => runRecord(candidate, item.id, index + 1)),
  );
  return {
    contractVersion: P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    corpusVersion: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    corpusHash: CURRENT_SPINE_QUALIFICATION_CORPUS_HASH,
    qualificationPolicyHash: qualificationPolicyHashForConfig(config),
    executionMode: "serial_offline",
    currentProductionWhatOwner: "deterministic",
    targetWhatHowMetricsStatus: "not_applicable_until_separately_authorized",
    generatedAt: "2026-08-08T03:00:00.000Z",
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

const withAdmissionFile = <T>(
  admission: ReturnType<typeof buildProductionModelAdmission>,
  fn: (path: string) => T,
): T => {
  const dir = mkdtempSync(join(tmpdir(), "p4-admission-"));
  const path = join(dir, "admission.json");
  writeFileSync(path, `${JSON.stringify(admission, null, 2)}\n`, "utf8");
  try {
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const productionEnv = (path: string): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  RUNTIME_DRAFTING_ENABLED: "true",
  RUNTIME_DRAFT_PROVIDER: "anthropic",
  RUNTIME_DRAFT_API_KEY: "test-secret",
  RUNTIME_DRAFT_MODEL: "pinned-test-model",
  RUNTIME_DRAFT_REASONING_EFFORT: "medium",
  RUNTIME_DRAFT_TIMEOUT_MS: "1000",
  RUNTIME_DRAFT_MAX_TOKENS: "200",
  RUNTIME_DRAFT_MAX_INPUT_TOKENS: "4000",
  RUNTIME_DRAFT_MAX_SIGNALS: "2",
  RUNTIME_DRAFT_MAX_CONCURRENT: "1",
  RUNTIME_DRAFT_MAX_RUN_TOKENS: "20000",
  RUNTIME_DRAFT_MAX_EVIDENCE_AGE_DAYS: "90",
  RUNTIME_DRAFT_FALLBACK: "template",
  P4_PRODUCTION_MODEL_ADMISSION: path,
});

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

describe("P4 production model admission", () => {
  it("builds one explicit human-selected admission from a matching QUALIFIED report", () => {
    const config = fixedConfig();
    const admission = buildProductionModelAdmission(config, qualifiedReport(config), {
      candidateId: "candidate-a",
      decisionOwner: "product-owner",
      decisionRef: "decision://p4/unit3/test",
    });

    expect(admission.provider).toBe("anthropic");
    expect(admission.modelId).toBe("pinned-test-model");
    expect(admission.currentProductionWhatOwner).toBe("deterministic");
    expect(admission.qualification.qualificationPolicyHash).toBe(
      qualificationPolicyHashForConfig(config),
    );
    expect(productionModelAdmissionHash(admission)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects fabricated aggregate metrics when run evidence does not cover the epoch", () => {
    const config = fixedConfig();
    const report = qualifiedReport(config);
    const firstRun = report.candidates[0]!.runs[0]!;
    report.candidates[0]!.runs = Array.from(
      { length: report.candidates[0]!.runs.length },
      () => ({ ...firstRun }),
    );
    report.candidates[0]!.metrics.modelVerifierPassRate = 1;
    report.candidates[0]!.metrics.falseAcceptRate = 0;

    expect(() =>
      buildProductionModelAdmission(config, report, {
        candidateId: "candidate-a",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/unit3/test",
      }),
    ).toThrow("run coverage is invalid");
  });

  it("recomputes verifier and false-accept evidence from each run", () => {
    const config = fixedConfig();
    const report = qualifiedReport(config);
    report.candidates[0]!.runs[0] = {
      ...report.candidates[0]!.runs[0]!,
      qualificationOracleCorrect: false,
      falseAccept: false,
    };
    report.candidates[0]!.metrics.falseAcceptRate = 0;

    expect(() =>
      buildProductionModelAdmission(config, report, {
        candidateId: "candidate-a",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/unit3/test",
      }),
    ).toThrow("inconsistent false-accept evidence");
  });

  it("does not admit a candidate that is not qualified", () => {
    const config = fixedConfig();
    const report = qualifiedReport(config);
    report.candidates[0]!.verdict = "DISQUALIFIED";
    report.candidates[0]!.reasons = ["MODEL_VERIFIER_PASS_RATE_FAILED"];
    expect(() =>
      buildProductionModelAdmission(config, report, {
        candidateId: "candidate-a",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/unit3/test",
      }),
    ).toThrow("is not QUALIFIED");
  });

  it("does not admit an otherwise qualified provider before its production adapter exists", () => {
    const config = fixedConfig("xai");
    expect(() =>
      buildProductionModelAdmission(config, qualifiedReport(config), {
        candidateId: "candidate-a",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/unit3/test",
      }),
    ).toThrow("no admitted production adapter");
  });

  it("requires a production admission before enabled production drafting can start", () => {
    expect(() =>
      runtimeDraftingPolicyFromEnv({
        ...productionEnv("unused"),
        P4_PRODUCTION_MODEL_ADMISSION: "",
      }),
    ).toThrow("requires P4_PRODUCTION_MODEL_ADMISSION");
  });

  it("blocks an admission-less policy injected directly into a production process", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => normalizeRuntimeDraftingPolicy(injectedRuntimePolicy())).toThrow(
        "requires a qualified production model admission",
      );
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("fails closed when runtime configuration differs from the admitted configuration", () => {
    const config = fixedConfig();
    const admission = buildProductionModelAdmission(config, qualifiedReport(config), {
      candidateId: "candidate-a",
      decisionOwner: "product-owner",
      decisionRef: "decision://p4/unit3/test",
    });

    withAdmissionFile(admission, (path) => {
      expect(() =>
        runtimeDraftingPolicyFromEnv({
          ...productionEnv(path),
          RUNTIME_DRAFT_MAX_TOKENS: "201",
        }),
      ).toThrow("does not match the admitted production model configuration");
    });
  });

  it("records admission and qualification identity without recording credentials", () => {
    const config = fixedConfig();
    const admission = buildProductionModelAdmission(config, qualifiedReport(config), {
      candidateId: "candidate-a",
      decisionOwner: "product-owner",
      decisionRef: "decision://p4/unit3/test",
    });

    withAdmissionFile(admission, (path) => {
      const policy = runtimeDraftingPolicyFromEnv(productionEnv(path));
      const snapshot = runtimeDraftingPolicyAuditSnapshot(policy);
      expect(snapshot.productionAdmission).toMatchObject({
        candidateId: "candidate-a",
        decisionRef: "decision://p4/unit3/test",
        qualificationPolicyHash: admission.qualification.qualificationPolicyHash,
        qualificationReportHash: admission.qualification.reportHash,
      });
      expect(JSON.stringify(snapshot)).not.toContain("test-secret");
    });
  });
});
