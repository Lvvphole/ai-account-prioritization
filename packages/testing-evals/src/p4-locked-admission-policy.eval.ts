import { describe, expect, it } from "vitest";
import type { RuntimeModelRequest } from "agent-runtime";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
  P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
  parseModelQualificationConfig,
  type QualificationClientResolver,
} from "./model-qualification/qualification-contract";
import {
  applyLockedP4QualificationPolicy,
  assertLockedP4QualificationPolicy,
  selectLockedP4AdmissionCandidateId,
} from "./model-qualification/locked-admission-policy";
import { runCurrentSpineModelQualification } from "./model-qualification/qualification-runner";

const lockedConfig = () =>
  parseModelQualificationConfig({
    contractVersion: P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    corpusVersion: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    k: 30,
    fallback: "template",
    qualificationEpochMaxRunTokens: 172650,
    budgets: {
      timeoutMs: 15000,
      maxOutputTokens: 1200,
      maxInputTokens: 8000,
      maxSignals: 12,
      maxConcurrent: 1,
      maxRunTokens: 20000,
      maxEvidenceAgeDays: 30,
    },
    thresholds: {
      minModelVerifierPassRate: 1,
      maxFallbackRate: 0,
      maxFalseAcceptRate: 0,
      requireCompleteTokenTelemetry: true,
    },
    candidates: [
      {
        id: "anthropic-haiku-4-5-default",
        provider: "anthropic",
        modelId: "claude-haiku-4-5",
        reasoningProfile: "default",
        structuredOutputProfile: "json_schema",
        toolSchemaProfile: "not_applicable_current_spine",
        samplingProfile: "provider_default",
        credentialEnv: "P4_QUALIFICATION_ANTHROPIC_API_KEY",
        pricing: {
          inputUsdPerMillionTokens: 1,
          cachedInputUsdPerMillionTokens: 0.1,
          outputUsdPerMillionTokens: 5,
          effectiveDate: "2026-08-09",
          source: "https://docs.anthropic.com/en/docs/about-claude/pricing",
        },
      },
      {
        id: "anthropic-sonnet-4-6-low",
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        reasoningProfile: "low",
        structuredOutputProfile: "json_schema",
        toolSchemaProfile: "not_applicable_current_spine",
        samplingProfile: "provider_default",
        credentialEnv: "P4_QUALIFICATION_ANTHROPIC_API_KEY",
        pricing: {
          inputUsdPerMillionTokens: 3,
          cachedInputUsdPerMillionTokens: 0.3,
          outputUsdPerMillionTokens: 15,
          effectiveDate: "2026-08-09",
          source: "https://docs.anthropic.com/en/docs/about-claude/pricing",
        },
      },
    ],
  });

const visibleContext = (request: RuntimeModelRequest) => {
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
    reasoning: config.reasoningEffort,
  }),
  client: {
    async generate(request, config) {
      const visible = visibleContext(request);
      const signal = visible.signals[0]!;
      return {
        output: {
          schemaVersion: "1.0",
          actionType: visible.actionType,
          sentences: [{ text: signal.description, sourceSignalIds: [signal.id] }],
        },
        telemetry: {
          provider: config.provider,
          model: config.model,
          latencyMs: 10,
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 20,
        },
      };
    },
  },
});

describe("locked P4 qualification and admission policy", () => {
  it("qualifies each locked candidate only after 60 of 60 verifier passes", async () => {
    const config = lockedConfig();
    assertLockedP4QualificationPolicy(config);
    const report = applyLockedP4QualificationPolicy(
      config,
      await runCurrentSpineModelQualification(config, passingResolver),
    );

    expect(report.verdict).toBe("PASS");
    expect(report.candidates).toHaveLength(2);
    for (const candidate of report.candidates) {
      expect(candidate.verdict).toBe("QUALIFIED");
      expect(candidate.metrics.totalRuns).toBe(60);
      expect(candidate.metrics.modelVerifierPasses).toBe(60);
      expect(candidate.metrics.modelVerifierPassRate).toBe(1);
      expect(candidate.metrics.fallbackRate).toBe(0);
      expect(candidate.metrics.falseAcceptRate).toBe(0);
      expect(candidate.metrics.authorityViolations).toBe(0);
      expect(candidate.metrics.measuredTokenRuns).toBe(60);
      expect(candidate.metrics.requestIdentityStable).toBe(true);
    }
    expect(selectLockedP4AdmissionCandidateId(config, report)).toBe(
      "anthropic-haiku-4-5-default",
    );
  });

  it("selects Sonnet when Haiku is DISQUALIFIED and Sonnet is QUALIFIED", async () => {
    const config = lockedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const haiku = report.candidates.find(
      (candidate) => candidate.candidate.id === "anthropic-haiku-4-5-default",
    )!;
    haiku.verdict = "DISQUALIFIED";
    haiku.reasons = ["MODEL_VERIFIER_PASS_RATE_FAILED"];
    const governed = applyLockedP4QualificationPolicy(config, report);

    expect(governed.verdict).toBe("PASS");
    expect(selectLockedP4AdmissionCandidateId(config, governed)).toBe(
      "anthropic-sonnet-4-6-low",
    );
  });

  it("selects Sonnet when Haiku is BLOCKED and Sonnet is QUALIFIED", async () => {
    const config = lockedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const haiku = report.candidates.find(
      (candidate) => candidate.candidate.id === "anthropic-haiku-4-5-default",
    )!;
    haiku.verdict = "BLOCKED";
    haiku.reasons = ["MISSING_CREDENTIAL"];
    const governed = applyLockedP4QualificationPolicy(config, report);

    expect(governed.verdict).toBe("PASS");
    expect(selectLockedP4AdmissionCandidateId(config, governed)).toBe(
      "anthropic-sonnet-4-6-low",
    );
  });

  it("blocks admission when neither locked candidate is QUALIFIED", async () => {
    const config = lockedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    report.candidates[0]!.verdict = "BLOCKED";
    report.candidates[0]!.reasons = ["MISSING_CREDENTIAL"];
    report.candidates[1]!.verdict = "DISQUALIFIED";
    report.candidates[1]!.reasons = ["MODEL_VERIFIER_PASS_RATE_FAILED"];
    const governed = applyLockedP4QualificationPolicy(config, report);

    expect(governed.verdict).toBe("BLOCKED");
    expect(selectLockedP4AdmissionCandidateId(config, governed)).toBeNull();
  });

  it("rejects a third provider or model before qualification spend begins", () => {
    const config = lockedConfig();
    config.candidates.push({
      ...config.candidates[0]!,
      id: "unauthorized-third-candidate",
      modelId: "unauthorized-model",
    });

    expect(() => assertLockedP4QualificationPolicy(config)).toThrow(
      "exactly Haiku and Sonnet",
    );
  });
});
