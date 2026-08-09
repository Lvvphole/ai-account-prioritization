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
  prepareProductionAdmissionOutput,
  prepareQualificationOutputPaths,
  writeProductionAdmissionOutput,
  writeQualificationReportOutput,
} from "./model-qualification/admission-output-lifecycle";
import {
  parseModelQualificationConfig,
  type ModelQualificationConfig,
  type QualificationClientResolver,
} from "./model-qualification/qualification-contract";
import { runLockedP4QualificationEpoch } from "./model-qualification/locked-qualification";

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
            sentences: [
              {
                text: visible.signals[0]!.description,
                sourceSignalIds: [visible.signals[0]!.id],
              },
            ],
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

const productionEnv = (
  path: string,
  admission: ProductionModelAdmission,
): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  RUNTIME_DRAFTING_ENABLED: "true",
  RUNTIME_DRAFT_PROVIDER: admission.provider,
  RUNTIME_DRAFT_API_KEY: "test-secret",
  RUNTIME_DRAFT_MODEL: admission.modelId,
  RUNTIME_DRAFT_REASONING_EFFORT: admission.reasoningProfile,
  RUNTIME_DRAFT_TIMEOUT_MS: String(admission.budgets.timeoutMs),
  RUNTIME_DRAFT_MAX_TOKENS: String(admission.budgets.maxOutputTokens),
  RUNTIME_DRAFT_MAX_INPUT_TOKENS: String(admission.budgets.maxInputTokens),
  RUNTIME_DRAFT_MAX_SIGNALS: String(admission.budgets.maxSignals),
  RUNTIME_DRAFT_MAX_CONCURRENT: String(admission.budgets.maxConcurrent),
  RUNTIME_DRAFT_MAX_RUN_TOKENS: String(admission.budgets.maxRunTokens),
  RUNTIME_DRAFT_MAX_EVIDENCE_AGE_DAYS: String(admission.budgets.maxEvidenceAgeDays),
  RUNTIME_DRAFT_FALLBACK: admission.fallback,
  P4_PRODUCTION_MODEL_ADMISSION: path,
});

const injectedRuntimePolicy = (): RuntimeDraftingPolicy => {
  const config = lockedConfig();
  const candidate = config.candidates[0]!;
  return {
    enabled: true,
    provider: candidate.provider,
    apiKey: "test-secret",
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
};

describe("P4 locked one-process qualification and admission", () => {
  it("admits the first configured qualified candidate", async () => {
    const config = lockedConfig();
    const first = config.candidates[0]!;

    const result = await runLockedP4QualificationEpoch(
      config,
      resolver(() => "pass"),
      decision,
      () => "2026-08-09T18:00:00.000Z",
    );

    expect(result.verdict).toBe("PASS");
    expect(result.selectedCandidateId).toBe(first.id);
    expect(result.admission?.candidateId).toBe(first.id);
    expect(result.admission?.modelId).toBe(first.modelId);
    expect(result.report.candidates.every((candidate) => candidate.verdict === "QUALIFIED")).toBe(true);
    expect(result.report.admissionSelection).toEqual({
      ...decision,
      selectedCandidateId: first.id,
      nonAdmittableQualifiedCandidateIds: [],
    });
    expect(productionModelAdmissionHash(result.admission!)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves candidate priority in the qualification policy identity", async () => {
    const config = lockedConfig();
    const reversed = { ...config, candidates: [...config.candidates].reverse() };
    const fixedNow = () => "2026-08-09T18:00:00.000Z";

    const originalResult = await runLockedP4QualificationEpoch(
      config,
      resolver(() => "pass"),
      decision,
      fixedNow,
    );
    const reversedResult = await runLockedP4QualificationEpoch(
      reversed,
      resolver(() => "pass"),
      decision,
      fixedNow,
    );

    expect(originalResult.selectedCandidateId).toBe(config.candidates[0]!.id);
    expect(reversedResult.selectedCandidateId).toBe(reversed.candidates[0]!.id);
    expect(originalResult.report.qualificationPolicyHash).not.toBe(
      reversedResult.report.qualificationPolicyHash,
    );
  });

  it("admits the next configured candidate when the first is not qualified", async () => {
    const config = lockedConfig();
    const first = config.candidates[0]!;
    const second = config.candidates[1]!;

    const result = await runLockedP4QualificationEpoch(
      config,
      resolver((candidateId) => (candidateId === first.id ? "fail" : "pass")),
      decision,
    );

    expect(result.verdict).toBe("PASS");
    expect(result.selectedCandidateId).toBe(second.id);
    expect(result.admission?.candidateId).toBe(second.id);
    expect(result.admission?.modelId).toBe(second.modelId);
  });

  it("preserves a qualified non-admittable candidate and selects the next admittable candidate", async () => {
    const config = lockedConfig();
    const admittable = config.candidates[0]!;
    const qualificationOnly = {
      ...admittable,
      id: "qualification-only-openai",
      provider: "openai" as const,
      modelId: "gpt-qualification-test",
      credentialEnv: "OPENAI_API_KEY",
    };
    const mixedConfig: ModelQualificationConfig = {
      ...config,
      candidates: [qualificationOnly, admittable],
    };

    const result = await runLockedP4QualificationEpoch(
      mixedConfig,
      resolver(() => "pass"),
      decision,
    );

    expect(
      result.report.candidates.find((candidate) => candidate.candidate.id === qualificationOnly.id)
        ?.verdict,
    ).toBe("QUALIFIED");
    expect(result.report.admissionSelection.nonAdmittableQualifiedCandidateIds).toEqual([
      qualificationOnly.id,
    ]);
    expect(result.selectedCandidateId).toBe(admittable.id);
    expect(result.admission?.candidateId).toBe(admittable.id);
  });

  it("returns BLOCK/template and retains decision attribution when no candidate qualifies", async () => {
    const result = await runLockedP4QualificationEpoch(
      lockedConfig(),
      resolver(() => "fail"),
      decision,
    );

    expect(result.verdict).toBe("BLOCKED");
    expect(result.selectedCandidateId).toBeNull();
    expect(result.admission).toBeNull();
    expect(result.report.admissionSelection).toEqual({
      ...decision,
      selectedCandidateId: null,
      nonAdmittableQualifiedCandidateIds: [],
    });
  });

  it("rejects colliding report and admission paths before qualification", () => {
    const dir = mkdtempSync(join(tmpdir(), "p4-output-collision-"));
    const path = join(dir, "artifact.json");

    try {
      expect(() => prepareQualificationOutputPaths(path, path)).toThrow(
        "must resolve to different paths",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps qualification reports immutable", () => {
    const dir = mkdtempSync(join(tmpdir(), "p4-report-output-"));
    const reportPath = join(dir, "report.json");
    const admissionPath = join(dir, "admission.json");

    try {
      prepareQualificationOutputPaths(reportPath, admissionPath);
      writeQualificationReportOutput(reportPath, "first-report\n");
      expect(() => prepareQualificationOutputPaths(reportPath, admissionPath)).toThrow(
        "Qualification report output already exists",
      );
      expect(() => writeQualificationReportOutput(reportPath, "second-report\n")).toThrow();
      expect(readFileSync(reportPath, "utf8")).toBe("first-report\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never overwrites or revokes an existing admission artifact", () => {
    const dir = mkdtempSync(join(tmpdir(), "p4-admission-output-"));
    const path = join(dir, "admission.json");
    writeFileSync(path, "existing-admission\n", "utf8");

    try {
      expect(() => prepareProductionAdmissionOutput(path)).toThrow(
        "does not hot-replace or revoke active admissions",
      );
      expect(() => writeProductionAdmissionOutput(path, "successor-admission\n")).toThrow();
      expect(readFileSync(path, "utf8")).toBe("existing-admission\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes a successor admission only to a new unused path", () => {
    const dir = mkdtempSync(join(tmpdir(), "p4-admission-output-"));
    const path = join(dir, "successor.json");

    try {
      expect(() => prepareProductionAdmissionOutput(path)).not.toThrow();
      writeProductionAdmissionOutput(path, "successor-admission\n");
      expect(readFileSync(path, "utf8")).toBe("successor-admission\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires a production admission before enabled production drafting can start", async () => {
    const result = await runLockedP4QualificationEpoch(
      lockedConfig(),
      resolver(() => "pass"),
      decision,
    );
    expect(result.admission).not.toBeNull();

    expect(() =>
      runtimeDraftingPolicyFromEnv({
        ...productionEnv("unused", result.admission!),
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
          ...productionEnv(path, result.admission!),
          RUNTIME_DRAFT_MAX_TOKENS: String(result.admission!.budgets.maxOutputTokens + 1),
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
      const policy = runtimeDraftingPolicyFromEnv(productionEnv(path, result.admission!));
      const snapshot = runtimeDraftingPolicyAuditSnapshot(policy);
      expect(snapshot.productionAdmission).toMatchObject({
        candidateId: result.admission!.candidateId,
        decisionRef: decision.decisionRef,
        qualificationPolicyHash: result.admission!.qualification.qualificationPolicyHash,
        qualificationReportHash: result.admission!.qualification.reportHash,
      });
      expect(JSON.stringify(snapshot)).not.toContain("test-secret");
    });
  });
});
