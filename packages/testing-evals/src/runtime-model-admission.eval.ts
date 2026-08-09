import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeRuntimeDraftingPolicy,
  productionModelAdmissionHash,
  runtimeDraftingPolicyAuditSnapshot,
  runtimeDraftingPolicyFromEnv,
  type ProductionModelAdmission,
  type RuntimeDraftingPolicy,
  type RuntimeModelRequest,
} from "agent-runtime";
import {
  parseModelQualificationConfig,
  type ModelQualificationConfig,
  type QualificationClientResolver,
} from "./model-qualification/qualification-contract";
import {
  LOCKED_P4_ADMISSION_CANDIDATE_PRIORITY,
  assertLockedP4QualificationPolicy,
  runLockedP4QualificationEpoch,
} from "./model-qualification/locked-qualification";

const lockedConfig = (): ModelQualificationConfig =>
  parseModelQualificationConfig(
    JSON.parse(
      readFileSync(resolve(process.cwd(), "../../config/p4-qualification-policy.json"), "utf8"),
    ) as unknown,
  );

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

const resolver = (
  modeFor: (candidateId: string) => "pass" | "fail" | "blocked",
  calls?: string[],
): QualificationClientResolver => (candidate) => {
  const mode = modeFor(candidate.id);
  if (mode === "blocked") throw new Error("qualification dependency unavailable");
  return {
    credential: "test-secret",
    effectiveProviderConfiguration: (_request, config) => ({
      model: config.model,
      max_tokens: config.maxOutputTokens,
      reasoning: config.reasoningEffort,
      output_format: "json_schema",
    }),
    client: {
      async generate(request, config) {
        calls?.push(candidate.id);
        const visible = contextFromRequest(request);
        if (mode === "fail") {
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
              inputTokens: 100,
              cachedInputTokens: 0,
              outputTokens: 20,
            },
          };
        }
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
            inputTokens: 100,
            cachedInputTokens: 0,
            outputTokens: 20,
          },
        };
      },
    },
  };
};

const decision = {
  decisionOwner: "product-owner",
  decisionRef: "decision://p4/locked-policy/test",
};

const withAdmissionFile = <T>(
  admission: ProductionModelAdmission,
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

const productionEnv = (path: string, model: string, reasoning: string): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  RUNTIME_DRAFTING_ENABLED: "true",
  RUNTIME_DRAFT_PROVIDER: "anthropic",
  RUNTIME_DRAFT_API_KEY: "test-secret",
  RUNTIME_DRAFT_MODEL: model,
  RUNTIME_DRAFT_REASONING_EFFORT: reasoning,
  RUNTIME_DRAFT_TIMEOUT_MS: "5000",
  RUNTIME_DRAFT_MAX_TOKENS: "600",
  RUNTIME_DRAFT_MAX_INPUT_TOKENS: "4000",
  RUNTIME_DRAFT_MAX_SIGNALS: "6",
  RUNTIME_DRAFT_MAX_CONCURRENT: "4",
  RUNTIME_DRAFT_MAX_RUN_TOKENS: "20000",
  RUNTIME_DRAFT_MAX_EVIDENCE_AGE_DAYS: "90",
  RUNTIME_DRAFT_FALLBACK: "template",
  P4_PRODUCTION_MODEL_ADMISSION: path,
});

const injectedRuntimePolicy = (): RuntimeDraftingPolicy => ({
  enabled: true,
  provider: "anthropic",
  apiKey: "test-secret",
  model: "claude-haiku-4-5-20251001",
  timeoutMs: 5000,
  maxTokens: 600,
  maxInputTokens: 4000,
  maxSignals: 6,
  maxConcurrent: 4,
  maxRunTokens: 20000,
  maxEvidenceAgeDays: 90,
  maxAttempts: 1,
  fallback: "template",
  reasoningEffort: "provider_default",
  outputFormat: "json_schema",
});

describe("P4 locked one-process qualification and admission", () => {
  it("locks exactly Haiku then Sonnet and admits Haiku when both qualify", async () => {
    const config = lockedConfig();
    assertLockedP4QualificationPolicy(config);
    expect(LOCKED_P4_ADMISSION_CANDIDATE_PRIORITY).toEqual([
      "anthropic-haiku-4-5-default",
      "anthropic-sonnet-4-6-low",
    ]);

    const result = await runLockedP4QualificationEpoch(
      config,
      resolver(() => "pass"),
      decision,
      () => "2026-08-09T18:00:00.000Z",
    );

    expect(result.verdict).toBe("PASS");
    expect(result.selectedCandidateId).toBe("anthropic-haiku-4-5-default");
    expect(result.admission?.candidateId).toBe("anthropic-haiku-4-5-default");
    expect(result.admission?.modelId).toBe("claude-haiku-4-5-20251001");
    expect(result.report.candidates.every((candidate) => candidate.verdict === "QUALIFIED")).toBe(true);
    expect(productionModelAdmissionHash(result.admission!)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("admits Sonnet only when Haiku is not qualified", async () => {
    const result = await runLockedP4QualificationEpoch(
      lockedConfig(),
      resolver((candidateId) =>
        candidateId === "anthropic-haiku-4-5-default" ? "fail" : "pass",
      ),
      decision,
    );

    expect(result.verdict).toBe("PASS");
    expect(result.selectedCandidateId).toBe("anthropic-sonnet-4-6-low");
    expect(result.admission?.candidateId).toBe("anthropic-sonnet-4-6-low");
    expect(result.admission?.modelId).toBe("claude-sonnet-4-6");
  });

  it("returns BLOCK/template and creates no admission when neither candidate qualifies", async () => {
    const result = await runLockedP4QualificationEpoch(
      lockedConfig(),
      resolver(() => "fail"),
      decision,
    );

    expect(result.verdict).toBe("BLOCKED");
    expect(result.selectedCandidateId).toBeNull();
    expect(result.admission).toBeNull();
  });

  it("validates the locked policy before resolving a provider or spending tokens", async () => {
    const config = lockedConfig();
    config.candidates.push({ ...config.candidates[0]!, id: "third-model" });
    let resolverCalls = 0;
    const countingResolver: QualificationClientResolver = (candidate) => {
      resolverCalls += 1;
      return resolver(() => "pass")(candidate);
    };

    await expect(
      runLockedP4QualificationEpoch(config, countingResolver, decision),
    ).rejects.toThrow("exactly Haiku and Sonnet");
    expect(resolverCalls).toBe(0);
  });

  it("requires a production admission before enabled production drafting can start", () => {
    expect(() =>
      runtimeDraftingPolicyFromEnv({
        ...productionEnv("unused", "claude-haiku-4-5-20251001", "provider_default"),
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

  it("fails closed when runtime configuration differs from the admitted configuration", async () => {
    const result = await runLockedP4QualificationEpoch(
      lockedConfig(),
      resolver(() => "pass"),
      decision,
    );
    expect(result.admission).not.toBeNull();

    withAdmissionFile(result.admission!, (path) => {
      expect(() =>
        runtimeDraftingPolicyFromEnv({
          ...productionEnv(path, "claude-haiku-4-5-20251001", "provider_default"),
          RUNTIME_DRAFT_MAX_TOKENS: "601",
        }),
      ).toThrow("does not match the admitted production model configuration");
    });
  });

  it("records admission and audit-report identity without recording credentials", async () => {
    const result = await runLockedP4QualificationEpoch(
      lockedConfig(),
      resolver(() => "pass"),
      decision,
    );
    expect(result.admission).not.toBeNull();

    withAdmissionFile(result.admission!, (path) => {
      const policy = runtimeDraftingPolicyFromEnv(
        productionEnv(path, "claude-haiku-4-5-20251001", "provider_default"),
      );
      const snapshot = runtimeDraftingPolicyAuditSnapshot(policy);
      expect(snapshot.productionAdmission).toMatchObject({
        candidateId: "anthropic-haiku-4-5-default",
        decisionRef: decision.decisionRef,
        qualificationPolicyHash: result.admission!.qualification.qualificationPolicyHash,
        qualificationReportHash: result.admission!.qualification.reportHash,
      });
      expect(JSON.stringify(snapshot)).not.toContain("test-secret");
    });
  });
});
