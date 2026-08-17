import { describe, expect, it } from "vitest";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
  P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
  parseModelQualificationConfig,
} from "./qualification-contract";
import { selectP4ProductionAdmissionCandidate } from "./locked-qualification";

const config = () =>
  parseModelQualificationConfig({
    contractVersion: P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    corpusVersion: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    k: 1,
    fallback: "template",
    qualificationEpochMaxRunTokens: 50000,
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
      minModelVerifierPassRate: 0,
      maxFallbackRate: 1,
      maxFalseAcceptRate: 0,
      requireCompleteTokenTelemetry: true,
    },
    candidates: [
      {
        id: "anthropic-admission-eligible",
        provider: "anthropic",
        modelId: "anthropic-test-model",
        reasoningProfile: "provider_default",
        structuredOutputProfile: "json_schema",
        toolSchemaProfile: "not_applicable_current_spine",
        samplingProfile: "provider_default",
        admissionMode: "eligible",
        credentialEnv: "ANTHROPIC_API_KEY",
      },
      {
        id: "openai-qualification-only",
        provider: "openai",
        modelId: "openai-test-model",
        reasoningProfile: "provider_default",
        structuredOutputProfile: "json_schema",
        toolSchemaProfile: "not_applicable_current_spine",
        samplingProfile: "provider_default",
        admissionMode: "qualification_only",
        credentialEnv: "OPENAI_API_KEY",
      },
    ],
  });

describe("P4 production admission candidate selection", () => {
  it("does not admit a qualification-only OpenAI candidate when it is the only qualified candidate", () => {
    expect(
      selectP4ProductionAdmissionCandidate(
        config(),
        new Set(["openai-qualification-only"]),
      ),
    ).toEqual({
      selectedCandidateId: null,
      nonAdmittableQualifiedCandidateIds: ["openai-qualification-only"],
    });
  });

  it("keeps configured admission priority among qualified admission-eligible candidates", () => {
    expect(
      selectP4ProductionAdmissionCandidate(
        config(),
        new Set(["anthropic-admission-eligible", "openai-qualification-only"]),
      ),
    ).toEqual({
      selectedCandidateId: "anthropic-admission-eligible",
      nonAdmittableQualifiedCandidateIds: ["openai-qualification-only"],
    });
  });
});
