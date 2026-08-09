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
  buildLockedP4ProductionModelAdmission,
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
      timeoutMs: 5000,
      maxOutputTokens: 600,
      maxInputTokens: 4000,
      maxSignals: 6,
      maxConcurrent: 4,
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
        id: "anthropic-haiku-4-5-default",
        provider: "anthropic",
        modelId: "claude-haiku-4-5-20251001",
        reasoningProfile: "provider_default",
        structuredOutputProfile: "json_schema",
        toolSchemaProfile: "not_applicable_current_spine",
        samplingProfile: "provider_default",
        credentialEnv: "ANTHROPIC_API_KEY",
        pricing: {
          inputUsdPerMillionTokens: 1,
          outputUsdPerMillionTokens: 5,
          effectiveDate: "2026-08-09",
          source: "Anthropic Claude Platform pricing verified 2026-08-09",
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
        credentialEnv: "ANTHROPIC_API_KEY",
        pricing: {
          inputUsdPerMillionTokens: 3,
          outputUsdPerMillionTokens: 15,
          effectiveDate: "2026-08-09",
          source: "Anthropic Claude Platform pricing verified 2026-08-09",
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
          outputTokens: 20,
        },
      };
    },
  },
});

const haikuReport = (report: Awaited<ReturnType<typeof runCurrentSpineModelQualification>>) =>
  report.candidates.find(
    (candidate) => candidate.candidate.id === "anthropic-haiku-4-5-default",
  )!;

const sonnetReport = (report: Awaited<ReturnType<typeof runCurrentSpineModelQualification>>) =>
  report.candidates.find(
    (candidate) => candidate.candidate.id === "anthropic-sonnet-4-6-low",
  )!;

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

  it("does not let a human decision override QUALIFIED Haiku with Sonnet", async () => {
    const config = lockedConfig();
    const report = applyLockedP4QualificationPolicy(
      config,
      await runCurrentSpineModelQualification(config, passingResolver),
    );

    expect(() =>
      buildLockedP4ProductionModelAdmission(config, report, {
        candidateId: "anthropic-sonnet-4-6-low",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/locked-priority",
      }),
    ).toThrow("requires candidate anthropic-haiku-4-5-default");
  });

  it("rejects a fabricated Haiku DISQUALIFIED verdict when its 60-run evidence qualifies", async () => {
    const config = lockedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const haiku = haikuReport(report);
    haiku.verdict = "DISQUALIFIED";
    haiku.reasons = ["MODEL_VERIFIER_PASS_RATE_FAILED"];

    expect(() => applyLockedP4QualificationPolicy(config, report)).toThrow(
      "does not match the locked 60/60 evidence boundary",
    );
  });

  it("selects Sonnet when Haiku is DISQUALIFIED by run evidence and Sonnet is QUALIFIED", async () => {
    const config = lockedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const haiku = haikuReport(report);
    haiku.runs[0]!.schemaValidation = "failed";
    haiku.runs[0]!.verifierPass = false;
    haiku.verdict = "DISQUALIFIED";
    haiku.reasons = ["MODEL_VERIFIER_PASS_RATE_FAILED"];
    const governed = applyLockedP4QualificationPolicy(config, report);

    expect(governed.verdict).toBe("PASS");
    expect(selectLockedP4AdmissionCandidateId(config, governed)).toBe(
      "anthropic-sonnet-4-6-low",
    );

    const admission = buildLockedP4ProductionModelAdmission(config, governed, {
      candidateId: "anthropic-sonnet-4-6-low",
      decisionOwner: "product-owner",
      decisionRef: "decision://p4/sonnet-after-haiku-disqualification",
    });
    expect(admission.budgets.maxRunTokens).toBe(20000);
    expect(JSON.stringify(admission)).not.toContain("qualificationEpochMaxRunTokens");
  });

  it("selects Sonnet when Haiku is BLOCKED by telemetry evidence and Sonnet is QUALIFIED", async () => {
    const config = lockedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const haiku = haikuReport(report);
    haiku.runs[0]!.inputTokens = null;
    haiku.verdict = "BLOCKED";
    haiku.reasons = ["TOKEN_TELEMETRY_INCOMPLETE"];
    const governed = applyLockedP4QualificationPolicy(config, report);

    expect(governed.verdict).toBe("PASS");
    expect(selectLockedP4AdmissionCandidateId(config, governed)).toBe(
      "anthropic-sonnet-4-6-low",
    );
  });

  it("blocks admission when neither locked candidate is QUALIFIED", async () => {
    const config = lockedConfig();
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const haiku = haikuReport(report);
    const sonnet = sonnetReport(report);
    haiku.runs[0]!.inputTokens = null;
    haiku.verdict = "BLOCKED";
    haiku.reasons = ["TOKEN_TELEMETRY_INCOMPLETE"];
    sonnet.runs[0]!.schemaValidation = "failed";
    sonnet.runs[0]!.verifierPass = false;
    sonnet.verdict = "DISQUALIFIED";
    sonnet.reasons = ["MODEL_VERIFIER_PASS_RATE_FAILED"];
    const governed = applyLockedP4QualificationPolicy(config, report);

    expect(governed.verdict).toBe("BLOCKED");
    expect(selectLockedP4AdmissionCandidateId(config, governed)).toBeNull();
    expect(() =>
      buildLockedP4ProductionModelAdmission(config, governed, {
        candidateId: "anthropic-haiku-4-5-default",
        decisionOwner: "product-owner",
        decisionRef: "decision://p4/no-qualified-candidate",
      }),
    ).toThrow("neither Haiku nor Sonnet is QUALIFIED");
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
