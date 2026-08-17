import { describe, expect, it } from "vitest";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
  P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
  parseModelQualificationConfig,
  type ModelQualificationConfig,
  type QualificationClientResolver,
} from "./qualification-contract";
import { runCurrentSpineModelQualification } from "./qualification-runner";

const permissiveConfig = (
  maxRunTokens: number,
  maxOutputTokens: number,
): ModelQualificationConfig =>
  parseModelQualificationConfig({
    contractVersion: P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    corpusVersion: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    k: 1,
    fallback: "template",
    qualificationEpochMaxRunTokens: 50000,
    budgets: {
      timeoutMs: 1000,
      maxOutputTokens,
      maxInputTokens: 4000,
      maxSignals: 2,
      maxConcurrent: 1,
      maxRunTokens,
      maxEvidenceAgeDays: 90,
    },
    thresholds: {
      minModelVerifierPassRate: 0,
      maxFallbackRate: 1,
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
        admissionMode: "qualification_only",
        credentialEnv: "P4_TEST_KEY",
      },
    ],
  });

describe("P4 mandatory model-evidence floor", () => {
  it("blocks qualification when no provider invocation occurs", async () => {
    let providerCalls = 0;
    const resolver: QualificationClientResolver = (candidate) => ({
      credential: "test-secret",
      effectiveProviderConfiguration: () => ({ provider: candidate.provider }),
      client: {
        async generate(_request, config) {
          providerCalls += 1;
          return {
            output: {
              schemaVersion: "1.0",
              actionType: "send_email",
              sentences: [{ text: "Unexpected call", sourceSignalIds: ["missing"] }],
            },
            telemetry: {
              provider: config.provider,
              model: config.model,
              latencyMs: 1,
              inputTokens: 1,
              cachedInputTokens: 0,
              outputTokens: 1,
            },
          };
        },
      },
    });

    const report = await runCurrentSpineModelQualification(
      permissiveConfig(256, 2000),
      resolver,
    );
    const candidate = report.candidates[0]!;

    expect(providerCalls).toBe(0);
    expect(candidate.metrics.providerInvokedRuns).toBe(0);
    expect(candidate.metrics.modelVerifierPasses).toBe(0);
    expect(candidate.verdict).toBe("BLOCKED");
    expect(candidate.reasons).toEqual(["MODEL_INVOCATION_EVIDENCE_MISSING"]);
    expect(report.verdict).toBe("BLOCKED");
  });

  it("disqualifies qualification when provider calls produce no verified model pass", async () => {
    const resolver: QualificationClientResolver = (candidate) => ({
      credential: "test-secret",
      effectiveProviderConfiguration: () => ({ provider: candidate.provider }),
      client: {
        async generate(_request, config) {
          return {
            output: {
              schemaVersion: "1.0",
              actionType: "send_email",
              sentences: [{ text: "Unsupported", sourceSignalIds: ["missing"] }],
            },
            telemetry: {
              provider: config.provider,
              model: config.model,
              latencyMs: 5,
              inputTokens: 10,
              cachedInputTokens: 0,
              outputTokens: 5,
            },
          };
        },
      },
    });

    const report = await runCurrentSpineModelQualification(
      permissiveConfig(20000, 200),
      resolver,
    );
    const candidate = report.candidates[0]!;

    expect(candidate.metrics.providerInvokedRuns).toBeGreaterThan(0);
    expect(candidate.metrics.modelVerifierPasses).toBe(0);
    expect(candidate.verdict).toBe("DISQUALIFIED");
    expect(candidate.reasons).toContain("MODEL_VERIFIER_PASS_EVIDENCE_MISSING");
    expect(report.verdict).toBe("FAIL");
  });
});
