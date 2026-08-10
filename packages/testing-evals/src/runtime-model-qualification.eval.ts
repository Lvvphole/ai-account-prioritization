import { describe, expect, it } from "vitest";
import {
  runtimeModelClientForProvider,
  type RuntimeModelClient,
  type RuntimeModelInvocationConfig,
  type RuntimeModelRequest,
} from "agent-runtime";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
  P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
  QualificationDependencyError,
  parseModelQualificationConfig,
  type ModelQualificationConfig,
  type QualificationClientResolver,
} from "./model-qualification/qualification-contract";
import {
  createOfflineQualificationModelClient,
  effectiveQualificationProviderConfiguration,
} from "./model-qualification/qualification-provider-clients";
import { runCurrentSpineModelQualification } from "./model-qualification/qualification-runner";

const fixedConfig = (): ModelQualificationConfig =>
  parseModelQualificationConfig({
    contractVersion: P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    corpusVersion: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    k: 2,
    fallback: "template",
    qualificationEpochMaxRunTokens: 40000,
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
        pricing: {
          inputUsdPerMillionTokens: 1,
          cachedInputUsdPerMillionTokens: 0.1,
          outputUsdPerMillionTokens: 2,
          effectiveDate: "2026-08-07",
          source: "test-fixture",
        },
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

const resolverWithFingerprint = (
  fingerprint: string | undefined,
): QualificationClientResolver => (candidate) => ({
  credential: "test-secret",
  effectiveProviderConfiguration: (request, config) => ({
    provider: candidate.provider,
    model: config.model,
    schema: request.outputFormat.schema,
    reasoning: config.reasoningEffort,
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
          cachedInputTokens: 20,
          outputTokens: 20,
          modelRevisionOrFingerprint: fingerprint,
        },
      };
    },
  },
});

const passingResolver = resolverWithFingerprint("test-fingerprint");

describe("P4 offline cross-model qualification", () => {
  it("runs exact k-runs and evaluates the complete qualification boundary at source", async () => {
    const report = await runCurrentSpineModelQualification(
      fixedConfig(),
      passingResolver,
      () => "2026-08-07T22:00:00.000Z",
    );

    expect(report.verdict).toBe("PASS");
    expect(report.currentProductionWhatOwner).toBe("deterministic");
    expect(report.targetWhatHowMetricsStatus).toBe("not_applicable_until_separately_authorized");
    const candidate = report.candidates[0]!;
    expect(candidate.verdict).toBe("QUALIFIED");
    expect(candidate.reasons).toEqual([]);
    expect(candidate.metrics.totalRuns).toBe(4);
    expect(candidate.metrics.providerInvokedRuns).toBe(4);
    expect(candidate.metrics.modelVerifierPassRate).toBe(1);
    expect(candidate.metrics.fallbackRate).toBe(0);
    expect(candidate.metrics.falseAcceptRate).toBe(0);
    expect(candidate.metrics.authorityViolations).toBe(0);
    expect(candidate.metrics.qualificationOracleCorrectRuns).toBe(4);
    expect(candidate.metrics.requestIdentityStable).toBe(true);
    expect(candidate.metrics.invocationStartIdentityStable).toBe(true);
    expect(candidate.metrics.effectiveProviderConfigurationComplete).toBe(true);
    expect(candidate.metrics.effectiveProviderConfigurationStable).toBe(true);
    expect(candidate.metrics.telemetryWithinReservation).toBe(true);
    expect(candidate.metrics.measuredTokenRuns).toBe(4);
    expect(candidate.metrics.costPerVerifiedPassUsd).not.toBeNull();
    expect(candidate.metrics.canonicalWhatCorrectness).toBeNull();
    expect(new Set(candidate.runs.map((run) => run.invocationStartHash)).has(null)).toBe(false);
  });

  it("detects an accepted grounded draft that violates the frozen-case oracle", async () => {
    const oracleFailingResolver: QualificationClientResolver = (candidate) => ({
      credential: "test-secret",
      effectiveProviderConfiguration: () => ({ provider: candidate.provider }),
      client: {
        async generate(request, config) {
          const visible = contextFromRequest(request);
          const selected = visible.signals[1] ?? visible.signals[0]!;
          return {
            output: {
              schemaVersion: "1.0",
              actionType: visible.actionType,
              sentences: [{ text: selected.description, sourceSignalIds: [selected.id] }],
            },
            telemetry: {
              provider: config.provider,
              model: config.model,
              latencyMs: 5,
              inputTokens: 10,
              outputTokens: 5,
            },
          };
        },
      },
    });

    const report = await runCurrentSpineModelQualification(fixedConfig(), oracleFailingResolver);
    const candidate = report.candidates[0]!;
    expect(candidate.metrics.modelVerifierPassRate).toBe(1);
    expect(candidate.metrics.falseAccepts).toBe(2);
    expect(candidate.verdict).toBe("DISQUALIFIED");
    expect(candidate.reasons).toContain("FALSE_ACCEPT_BOUND_FAILED");
  });

  it("disqualifies output that cannot satisfy deterministic action authority", async () => {
    const badResolver: QualificationClientResolver = (candidate) => ({
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
              outputTokens: 5,
            },
          };
        },
      },
    });

    const report = await runCurrentSpineModelQualification(fixedConfig(), badResolver);
    expect(report.verdict).toBe("FAIL");
    expect(report.candidates[0]?.verdict).toBe("DISQUALIFIED");
    expect(report.candidates[0]?.reasons).toContain("MODEL_VERIFIER_PASS_RATE_FAILED");
  });

  it("uses a fresh production run-token budget for each simulated batch", async () => {
    const baseline = await runCurrentSpineModelQualification(fixedConfig(), passingResolver);
    const firstBatch = baseline.candidates[0]!.runs.filter((run) => run.runIndex === 1);
    const singleCaseBudget = Math.max(...firstBatch.map((run) => run.reservedRunTokens ?? 0));
    expect(singleCaseBudget).toBeGreaterThan(0);

    const config = fixedConfig();
    config.budgets.maxRunTokens = singleCaseBudget;
    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const invokedByBatch = Array.from({ length: config.k }, (_, index) =>
      report.candidates[0]!.runs.filter(
        (run) => run.runIndex === index + 1 && run.providerInvoked,
      ).length,
    );

    expect(invokedByBatch).toEqual(Array.from({ length: config.k }, () => 1));
    expect(report.candidates[0]!.runs.some((run) => run.failureCode === "DRAFT_RUN_BUDGET_EXCEEDED")).toBe(true);
  });

  it("enforces the separate qualification epoch budget before provider spend", async () => {
    const baseline = await runCurrentSpineModelQualification(fixedConfig(), passingResolver);
    const firstReservation = baseline.candidates[0]!.runs[0]!.reservedRunTokens!;
    const config = fixedConfig();
    config.qualificationEpochMaxRunTokens = firstReservation;

    const report = await runCurrentSpineModelQualification(config, passingResolver);
    const candidate = report.candidates[0]!;
    expect(candidate.runs.filter((run) => run.providerInvoked)).toHaveLength(1);
    expect(candidate.verdict).toBe("BLOCKED");
    expect(candidate.reasons).toEqual(["QUALIFICATION_EPOCH_BUDGET_EXCEEDED"]);
  });

  it("blocks when provider telemetry exceeds the reserved request boundary", async () => {
    const resolver: QualificationClientResolver = (candidate) => ({
      credential: "test-secret",
      effectiveProviderConfiguration: () => ({ provider: candidate.provider }),
      client: {
        async generate(request, config) {
          const visible = contextFromRequest(request);
          return {
            output: {
              schemaVersion: "1.0",
              actionType: visible.actionType,
              sentences: [{
                text: visible.signals[0]!.description,
                sourceSignalIds: [visible.signals[0]!.id],
              }],
            },
            telemetry: {
              provider: config.provider,
              model: config.model,
              latencyMs: 5,
              inputTokens: 999999,
              cachedInputTokens: 0,
              outputTokens: 5,
            },
          };
        },
      },
    });

    const report = await runCurrentSpineModelQualification(fixedConfig(), resolver);
    expect(report.candidates[0]?.verdict).toBe("BLOCKED");
    expect(report.candidates[0]?.reasons).toEqual(["TOKEN_TELEMETRY_BOUND_FAILED"]);
  });

  it("blocks when effective provider configuration evidence is missing", async () => {
    const resolver: QualificationClientResolver = (candidate) => ({
      ...passingResolver(candidate),
      effectiveProviderConfiguration: () => ({}),
    });
    const report = await runCurrentSpineModelQualification(fixedConfig(), resolver);
    expect(report.candidates[0]?.verdict).toBe("BLOCKED");
    expect(report.candidates[0]?.reasons).toEqual([
      "EFFECTIVE_PROVIDER_CONFIGURATION_INCOMPLETE",
    ]);
  });

  it("blocks when a required model revision cannot be observed", async () => {
    const config = fixedConfig();
    config.candidates[0] = {
      ...config.candidates[0]!,
      modelRevisionOrFingerprint: "expected-fingerprint",
    };
    const report = await runCurrentSpineModelQualification(
      config,
      resolverWithFingerprint(undefined),
    );
    expect(report.verdict).toBe("BLOCKED");
    expect(report.candidates[0]?.reasons).toEqual(["MODEL_REVISION_EVIDENCE_MISSING"]);
  });

  it("disqualifies an explicit model revision mismatch", async () => {
    const config = fixedConfig();
    config.candidates[0] = {
      ...config.candidates[0]!,
      modelRevisionOrFingerprint: "expected-fingerprint",
    };
    const report = await runCurrentSpineModelQualification(
      config,
      resolverWithFingerprint("unexpected-fingerprint"),
    );
    expect(report.verdict).toBe("FAIL");
    expect(report.candidates[0]?.verdict).toBe("DISQUALIFIED");
    expect(report.candidates[0]?.reasons).toContain("MODEL_REVISION_MISMATCH");
  });

  it("returns BLOCKED when a configured candidate dependency is unavailable", async () => {
    const missing: QualificationClientResolver = () => {
      throw new QualificationDependencyError("MISSING_CREDENTIAL", "missing");
    };
    const report = await runCurrentSpineModelQualification(fixedConfig(), missing);
    expect(report.verdict).toBe("BLOCKED");
    expect(report.candidates[0]?.verdict).toBe("BLOCKED");
    expect(report.candidates[0]?.reasons).toEqual(["MISSING_CREDENTIAL"]);
  });

  it("refuses to weaken the mandatory false-accept threshold", () => {
    const raw = JSON.parse(JSON.stringify(fixedConfig())) as Record<string, unknown>;
    (raw.thresholds as Record<string, unknown>).maxFalseAcceptRate = 0.01;
    expect(() => parseModelQualificationConfig(raw)).toThrow("must be 0");
  });

  it("requires an independent qualification epoch budget", () => {
    const raw = JSON.parse(JSON.stringify(fixedConfig())) as Record<string, unknown>;
    delete raw.qualificationEpochMaxRunTokens;
    expect(() => parseModelQualificationConfig(raw)).toThrow(
      "qualificationEpochMaxRunTokens must be a positive safe integer",
    );
  });

  it("validates production qualification budgets against runtime bounds", () => {
    const raw = JSON.parse(JSON.stringify(fixedConfig())) as Record<string, unknown>;
    (raw.budgets as Record<string, unknown>).timeoutMs = 1;
    expect(() => parseModelQualificationConfig(raw)).toThrow("250 through 30000");
  });

  it("keeps xAI qualification-only until a production adapter is separately admitted", () => {
    expect(() => runtimeModelClientForProvider("xai")).toThrow(
      "has no admitted production adapter yet",
    );
  });
});

const providerRequest: RuntimeModelRequest = {
  system: "Return strict JSON.",
  user: "Return ok.",
  outputFormat: {
    type: "json_schema",
    schema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  },
};

const providerConfig = (
  provider: "openai" | "xai" | "google",
): RuntimeModelInvocationConfig => ({
  provider,
  model: `${provider}-test-model`,
  credential: "test-secret",
  timeoutMs: 1000,
  maxOutputTokens: 100,
  reasoningEffort: "medium",
});

describe("qualification-only provider adapters", () => {
  it.each(["openai", "xai"] as const)(
    "%s uses Responses structured output without universal sampling controls",
    async (provider) => {
      let capturedBody: Record<string, unknown> = {};
      const fakeFetch: typeof fetch = async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({ value: "ok" }),
            usage: {
              input_tokens: 10,
              input_tokens_details: { cached_tokens: 2 },
              output_tokens: 4,
            },
            system_fingerprint: "fp-test",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };
      const client: RuntimeModelClient = createOfflineQualificationModelClient(provider, fakeFetch);
      const result = await client.generate(providerRequest, providerConfig(provider));
      expect(result.output).toEqual({ value: "ok" });
      expect(JSON.stringify(capturedBody)).not.toContain("temperature");
      expect(JSON.stringify(capturedBody)).not.toContain("top_p");
      expect(JSON.stringify(capturedBody)).not.toContain("seed");
      expect(capturedBody.text).toEqual(
        expect.objectContaining({ format: expect.objectContaining({ type: "json_schema" }) }),
      );
      expect(capturedBody.reasoning).toEqual({ effort: "medium" });
    },
  );

  it("Google uses structured response format and thinking level without universal sampling controls", async () => {
    let capturedBody: Record<string, unknown> = {};
    const fakeFetch: typeof fetch = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          model: "google-test-model",
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: JSON.stringify({ value: "ok" }) }],
            },
          ],
          usage: { total_input_tokens: 10, total_cached_tokens: 2, total_output_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const client = createOfflineQualificationModelClient("google", fakeFetch);
    await client.generate(providerRequest, providerConfig("google"));
    expect(JSON.stringify(capturedBody)).not.toContain("temperature");
    expect(JSON.stringify(capturedBody)).not.toContain("top_p");
    expect(JSON.stringify(capturedBody)).not.toContain("seed");
    expect(capturedBody.response_format).toEqual(
      expect.objectContaining({ type: "text", mime_type: "application/json" }),
    );
    expect(capturedBody.generation_config).toEqual(
      expect.objectContaining({ max_output_tokens: 100, thinking_level: "medium" }),
    );
  });

  it("records the same non-secret output configuration that the qualification adapter uses", () => {
    expect(
      effectiveQualificationProviderConfiguration("xai", providerRequest, providerConfig("xai")),
    ).toEqual(
      expect.objectContaining({
        max_output_tokens: 100,
        reasoning: { effort: "medium" },
      }),
    );
  });
});
