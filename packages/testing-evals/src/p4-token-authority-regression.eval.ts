import { describe, expect, it } from "vitest";
import type { RuntimeModelRequest } from "agent-runtime";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
  P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
  parseModelQualificationConfig,
  type ModelQualificationConfig,
  type QualificationClientResolver,
} from "./model-qualification/qualification-contract";
import {
  buildProductionModelAdmission,
  qualificationPolicyHashForConfig,
} from "./model-qualification/production-admission";
import { runCurrentSpineModelQualification } from "./model-qualification/qualification-runner";

const fixedConfig = (): ModelQualificationConfig =>
  parseModelQualificationConfig({
    contractVersion: P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    corpusVersion: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    k: 2,
    fallback: "template",
    qualificationEpochMaxRunTokens: 500000,
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

const contextFromRequest = (request: RuntimeModelRequest) => {
  const start = "SOURCE_DATA_START\n";
  const end = "\nSOURCE_DATA_END";
  const json = request.user.slice(
    request.user.indexOf(start) + start.length,
    request.user.lastIndexOf(end),
  );
  return JSON.parse(json) as {
    actionType: string;
    signals: Array<{ id: string; description: string }>;
  };
};

const passingResolver: QualificationClientResolver = (candidate) => ({
  credential: "test-secret",
  effectiveProviderConfiguration: (_request, config) => ({
    provider: candidate.provider,
    model: config.model,
  }),
  client: {
    async generate(request, config) {
      const visible = contextFromRequest(request);
      return {
        output: {
          schemaVersion: "1.0",
          actionType: visible.actionType,
          sentences: [
            {
              text: visible.signals[0]?.description,
              sourceSignalIds: [visible.signals[0]?.id],
            },
          ],
        },
        telemetry: {
          provider: config.provider,
          model: config.model,
          latencyMs: 10,
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 20,
          modelRevisionOrFingerprint: "test-fingerprint",
        },
      };
    },
  },
});

describe("P4 token-authority regressions", () => {
  it("shares one production run budget across each repeated qualification batch", async () => {
    const baselineConfig = fixedConfig();
    baselineConfig.k = 1;
    const baseline = await runCurrentSpineModelQualification(baselineConfig, passingResolver);
    const reservations = baseline.candidates[0]!.runs.map((run) => run.reservedRunTokens);
    expect(reservations.every((value) => value !== null)).toBe(true);

    const config = fixedConfig();
    config.budgets.maxRunTokens = Math.max(...(reservations as number[]));
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const runs = report.candidates[0]!.runs;

    expect(runs.filter((run) => run.providerInvoked)).toHaveLength(config.k);
    for (let runIndex = 1; runIndex <= config.k; runIndex += 1) {
      const batch = runs.filter((run) => run.runIndex === runIndex);
      expect(batch.filter((run) => run.providerInvoked)).toHaveLength(1);
      expect(
        batch.filter((run) => run.failureCode === "DRAFT_RUN_BUDGET_EXCEEDED"),
      ).toHaveLength(1);
    }
  });

  it("rejects persisted evidence whose simulated production batch exceeds maxRunTokens", async () => {
    const config = fixedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const firstBatch = report.candidates[0]!.runs.filter((run) => run.runIndex === 1);
    const reservations = firstBatch.map((run) => run.reservedRunTokens);
    expect(reservations.every((value) => value !== null)).toBe(true);

    config.budgets.maxRunTokens = Math.max(...(reservations as number[]));
    report.qualificationPolicyHash = qualificationPolicyHashForConfig(config);

    expect(() =>
      buildProductionModelAdmission(config, report, {
        candidateId: "candidate-a",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/pr60/production-batch-budget",
      }),
    ).toThrow("Qualification batch 1 exceeds the locked production run budget");
  });

  it("rejects persisted invoked evidence above the locked input-token bound", async () => {
    const config = fixedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const run = report.candidates[0]!.runs[0]!;
    run.inputTokenUpperBound = config.budgets.maxInputTokens + 1;
    run.reservedRunTokens = run.inputTokenUpperBound + config.budgets.maxOutputTokens;

    expect(() =>
      buildProductionModelAdmission(config, report, {
        candidateId: "candidate-a",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/pr60/input-token-bound",
      }),
    ).toThrow("input-token bound does not match the deterministic frozen request");
  });

  it("rejects self-consistent lowered reservation evidence", async () => {
    const config = fixedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const run = report.candidates[0]!.runs[0]!;
    expect(run.inputTokenUpperBound).not.toBeNull();
    run.inputTokenUpperBound = (run.inputTokenUpperBound as number) - 1;
    run.reservedRunTokens = run.inputTokenUpperBound + config.budgets.maxOutputTokens;

    expect(() =>
      buildProductionModelAdmission(config, report, {
        candidateId: "candidate-a",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/pr60/lowered-reservation",
      }),
    ).toThrow("input-token bound does not match the deterministic frozen request");
  });

  it("rejects request identity that is stable but not the frozen request identity", async () => {
    const config = fixedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const caseId = report.candidates[0]!.runs[0]!.caseId;
    for (const run of report.candidates[0]!.runs.filter((candidateRun) => candidateRun.caseId === caseId)) {
      run.requestIdentityHash = "a".repeat(64);
    }

    expect(() =>
      buildProductionModelAdmission(config, report, {
        candidateId: "candidate-a",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/pr60/request-identity",
      }),
    ).toThrow("request identity does not match the deterministic frozen request");
  });

  it("rejects invocation-start identity that is not the frozen request identity", async () => {
    const config = fixedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    report.candidates[0]!.runs[0]!.invocationStartHash = "b".repeat(64);

    expect(() =>
      buildProductionModelAdmission(config, report, {
        candidateId: "candidate-a",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/pr60/invocation-start-identity",
      }),
    ).toThrow("invocation-start identity does not match the deterministic frozen request");
  });

  it("rejects provider telemetry on a qualification run that claims no invocation", async () => {
    const config = fixedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const run = report.candidates[0]!.runs[0]!;

    run.providerInvoked = false;
    run.requestIdentityHash = null;
    run.invocationStartHash = null;
    run.inputTokenUpperBound = null;
    run.reservedRunTokens = null;
    run.effectiveProviderConfiguration = null;
    run.source = "template";
    run.schemaValidation = "not_run";
    run.groundingValidation = "not_run";
    run.qualificationOracleCorrect = null;
    run.verifierPass = false;
    run.falseAccept = false;
    run.acceptedArtifactHash = null;

    expect(() =>
      buildProductionModelAdmission(config, report, {
        candidateId: "candidate-a",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/pr60/provider-telemetry",
      }),
    ).toThrow("records provider telemetry without a provider invocation");
  });
});
