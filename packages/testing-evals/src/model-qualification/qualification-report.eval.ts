import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
  P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
  hashQualificationMaterial,
  parseModelQualificationConfig,
  type ModelQualificationConfig,
  type QualificationClientResolver,
} from "./qualification-contract";
import { runQualificationReportOnly } from "./qualification-report";

const config = (): ModelQualificationConfig =>
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
        id: "openai-report-only-test",
        provider: "openai",
        modelId: "pinned-test-model",
        reasoningProfile: "provider_default",
        structuredOutputProfile: "json_schema",
        toolSchemaProfile: "not_applicable_current_spine",
        samplingProfile: "provider_default",
        credentialEnv: "P4_TEST_KEY",
      },
    ],
  });

const CANONICAL_POLICY_HASH = hashQualificationMaterial({
  candidates: [{ id: "integrated-test-candidate" }],
  qualificationOnlyCandidates: [{ id: "openai-report-only-test" }],
});

const resolver = (onCall: () => void): QualificationClientResolver => (candidate) => ({
  credential: "test-secret",
  effectiveProviderConfiguration: () => ({ provider: candidate.provider }),
  client: {
    async generate(_request, invocation) {
      onCall();
      return {
        output: {
          schemaVersion: "1.0",
          actionType: "send_email",
          sentences: [{ text: "Unsupported", sourceSignalIds: ["missing"] }],
        },
        telemetry: {
          provider: invocation.provider,
          model: invocation.model,
          latencyMs: 1,
          inputTokens: 10,
          cachedInputTokens: 0,
          outputTokens: 5,
        },
      };
    },
  },
});

describe("P4 qualification-only report boundary", () => {
  it("persists source identity with qualification evidence and creates no admission artifact", async () => {
    const directory = mkdtempSync(join(tmpdir(), "p4-qualification-report-"));
    const reportPath = join(directory, "report.json");
    let providerCalls = 0;

    try {
      const report = await runQualificationReportOnly(
        config(),
        resolver(() => {
          providerCalls += 1;
        }),
        reportPath,
        CANONICAL_POLICY_HASH,
        () => "2026-08-17T12:00:00.000Z",
      );

      expect(providerCalls).toBeGreaterThan(0);
      expect(report.generatedAt).toBe("2026-08-17T12:00:00.000Z");
      expect(report.qualificationSource).toEqual({
        mode: "qualification_only",
        candidateSet: "qualificationOnlyCandidates",
        canonicalPolicyHash: CANONICAL_POLICY_HASH,
      });
      expect(JSON.parse(readFileSync(reportPath, "utf8"))).toEqual(report);
      expect(readdirSync(directory)).toEqual(["report.json"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails before provider spend when the report destination is already used", async () => {
    const directory = mkdtempSync(join(tmpdir(), "p4-qualification-report-used-"));
    const reportPath = join(directory, "report.json");
    let providerCalls = 0;
    writeFileSync(reportPath, "existing\n", "utf8");

    try {
      await expect(
        runQualificationReportOnly(
          config(),
          resolver(() => {
            providerCalls += 1;
          }),
          reportPath,
          CANONICAL_POLICY_HASH,
        ),
      ).rejects.toThrow("Qualification report output already exists");
      expect(providerCalls).toBe(0);
      expect(readFileSync(reportPath, "utf8")).toBe("existing\n");
      expect(readdirSync(directory)).toEqual(["report.json"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
