import {
  IMPLEMENTED_RUNTIME_MODEL_PROVIDERS,
  P4_PRODUCTION_MODEL_ADMISSION_CONTRACT_VERSION,
  parseProductionModelAdmission,
  type ProductionModelAdmission,
} from "agent-runtime";
import {
  hashQualificationMaterial,
  type ModelQualificationConfig,
  type QualificationCandidate,
  type QualificationClientResolver,
  type QualificationOverallVerdict,
} from "./qualification-contract";
import {
  runCurrentSpineModelQualification,
  type ModelQualificationReport,
} from "./qualification-runner";

const LOCKED_CANDIDATES = [
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
] as const;

export const LOCKED_P4_ADMISSION_CANDIDATE_PRIORITY = LOCKED_CANDIDATES.map(
  (candidate) => candidate.id,
) as readonly string[];

export interface LockedP4AdmissionDecisionMetadata {
  decisionOwner: string;
  decisionRef: string;
}

export interface LockedP4QualificationEpochResult {
  verdict: Extract<QualificationOverallVerdict, "PASS" | "BLOCKED">;
  selectedCandidateId: string | null;
  report: ModelQualificationReport;
  admission: ProductionModelAdmission | null;
}

const nonEmpty = (value: string, path: string): string => {
  if (!value.trim()) throw new Error(`${path} must be a non-empty string.`);
  return value;
};

const exactNumber = (actual: number | undefined, expected: number, path: string): void => {
  if (actual !== expected) throw new Error(`${path} must equal the locked value ${expected}.`);
};

const comparableCandidate = (candidate: QualificationCandidate): unknown => ({
  id: candidate.id,
  provider: candidate.provider,
  modelId: candidate.modelId,
  reasoningProfile: candidate.reasoningProfile,
  structuredOutputProfile: candidate.structuredOutputProfile,
  toolSchemaProfile: candidate.toolSchemaProfile,
  samplingProfile: candidate.samplingProfile,
  credentialEnv: candidate.credentialEnv,
  pricing: candidate.pricing,
});

export function assertLockedP4QualificationPolicy(config: ModelQualificationConfig): void {
  if (config.k !== 30) throw new Error("k must equal the locked value 30.");
  if (config.fallback !== "template") {
    throw new Error("fallback must equal the locked value template.");
  }
  exactNumber(
    config.qualificationEpochMaxRunTokens,
    172650,
    "qualificationEpochMaxRunTokens",
  );

  const lockedBudgets = {
    timeoutMs: 5000,
    maxOutputTokens: 600,
    maxInputTokens: 4000,
    maxSignals: 6,
    maxConcurrent: 4,
    maxRunTokens: 20000,
    maxEvidenceAgeDays: 90,
  } as const;
  for (const [key, expected] of Object.entries(lockedBudgets)) {
    exactNumber(
      config.budgets[key as keyof typeof config.budgets],
      expected,
      `budgets.${key}`,
    );
  }

  exactNumber(config.thresholds.minModelVerifierPassRate, 1, "thresholds.minModelVerifierPassRate");
  exactNumber(config.thresholds.maxFallbackRate, 0, "thresholds.maxFallbackRate");
  exactNumber(config.thresholds.maxFalseAcceptRate, 0, "thresholds.maxFalseAcceptRate");
  if (config.thresholds.requireCompleteTokenTelemetry !== true) {
    throw new Error("thresholds.requireCompleteTokenTelemetry must equal the locked value true.");
  }
  if (config.thresholds.maxP95LatencyMs !== undefined) {
    throw new Error("thresholds.maxP95LatencyMs must be omitted by the locked policy.");
  }
  if (config.thresholds.maxCostPerVerifiedPassUsd !== undefined) {
    throw new Error("thresholds.maxCostPerVerifiedPassUsd must be omitted by the locked policy.");
  }

  if (config.candidates.length !== LOCKED_CANDIDATES.length) {
    throw new Error("Locked P4 qualification requires exactly Haiku and Sonnet.");
  }

  const configuredIds = new Set(config.candidates.map((candidate) => candidate.id));
  for (const locked of LOCKED_CANDIDATES) {
    if (!configuredIds.has(locked.id)) {
      throw new Error(`Locked P4 qualification is missing ${locked.id}.`);
    }
    const configured = config.candidates.find((candidate) => candidate.id === locked.id)!;
    if (configured.modelRevisionOrFingerprint !== undefined) {
      throw new Error(`Candidate ${locked.id} modelRevisionOrFingerprint must be omitted.`);
    }
    if (
      hashQualificationMaterial(comparableCandidate(configured)) !==
      hashQualificationMaterial(locked)
    ) {
      throw new Error(`Candidate ${locked.id} does not match the locked candidate contract.`);
    }
  }
}

const selectedCandidateId = (report: ModelQualificationReport): string | null => {
  for (const candidateId of LOCKED_P4_ADMISSION_CANDIDATE_PRIORITY) {
    const candidate = report.candidates.find((item) => item.candidate.id === candidateId);
    if (candidate?.verdict === "QUALIFIED") return candidateId;
  }
  return null;
};

const buildAdmissionFromAuthoritativeEpoch = (
  config: ModelQualificationConfig,
  report: ModelQualificationReport,
  candidateId: string,
  decision: LockedP4AdmissionDecisionMetadata,
): ProductionModelAdmission => {
  const candidate = config.candidates.find((item) => item.id === candidateId);
  const evaluated = report.candidates.find((item) => item.candidate.id === candidateId);
  if (!candidate || !evaluated || evaluated.verdict !== "QUALIFIED") {
    throw new Error(`Selected candidate ${candidateId} is not QUALIFIED in the authoritative epoch.`);
  }
  if (evaluated.reasons.length !== 0) {
    throw new Error(`QUALIFIED candidate ${candidateId} must not contain failure reasons.`);
  }
  if (
    !IMPLEMENTED_RUNTIME_MODEL_PROVIDERS.includes(
      candidate.provider as (typeof IMPLEMENTED_RUNTIME_MODEL_PROVIDERS)[number],
    )
  ) {
    throw new Error(
      `Qualified candidate ${candidateId} uses ${candidate.provider}, but that provider has no admitted production adapter.`,
    );
  }

  return parseProductionModelAdmission({
    contractVersion: P4_PRODUCTION_MODEL_ADMISSION_CONTRACT_VERSION,
    decision: "ADMITTED",
    decisionOwner: nonEmpty(decision.decisionOwner, "decision.decisionOwner"),
    decisionRef: nonEmpty(decision.decisionRef, "decision.decisionRef"),
    candidateId,
    provider: candidate.provider,
    modelId: candidate.modelId,
    modelRevisionOrFingerprint: candidate.modelRevisionOrFingerprint ?? null,
    reasoningProfile: candidate.reasoningProfile,
    structuredOutputProfile: candidate.structuredOutputProfile,
    toolSchemaProfile: candidate.toolSchemaProfile,
    samplingProfile: candidate.samplingProfile,
    currentProductionWhatOwner: "deterministic",
    fallback: config.fallback,
    budgets: {
      timeoutMs: config.budgets.timeoutMs,
      maxOutputTokens: config.budgets.maxOutputTokens,
      maxInputTokens: config.budgets.maxInputTokens,
      maxSignals: config.budgets.maxSignals,
      maxConcurrent: config.budgets.maxConcurrent,
      maxRunTokens: config.budgets.maxRunTokens,
      maxEvidenceAgeDays: config.budgets.maxEvidenceAgeDays,
    },
    qualification: {
      contractVersion: report.contractVersion,
      corpusVersion: report.corpusVersion,
      corpusHash: report.corpusHash,
      qualificationPolicyHash: report.qualificationPolicyHash,
      // Audit provenance only. Production does not reread or replay this report.
      reportHash: hashQualificationMaterial(report),
      generatedAt: report.generatedAt,
    },
  });
};

/**
 * Execute, evaluate, select, and admit inside one trusted process.
 *
 * The full qualification report is returned for audit. It is not consumed by a
 * later admission authority. Candidate selection is the locked deterministic
 * Haiku -> Sonnet -> BLOCK policy and cannot be supplied by the caller.
 */
export async function runLockedP4QualificationEpoch(
  config: ModelQualificationConfig,
  resolveClient: QualificationClientResolver,
  decision: LockedP4AdmissionDecisionMetadata,
  now: () => string = () => new Date().toISOString(),
): Promise<LockedP4QualificationEpochResult> {
  assertLockedP4QualificationPolicy(config);
  nonEmpty(decision.decisionOwner, "decision.decisionOwner");
  nonEmpty(decision.decisionRef, "decision.decisionRef");

  const rawReport = await runCurrentSpineModelQualification(config, resolveClient, now);
  const chosen = selectedCandidateId(rawReport);
  const verdict: LockedP4QualificationEpochResult["verdict"] = chosen ? "PASS" : "BLOCKED";
  const report: ModelQualificationReport = { ...rawReport, verdict };

  if (!chosen) {
    return { verdict, selectedCandidateId: null, report, admission: null };
  }

  return {
    verdict,
    selectedCandidateId: chosen,
    report,
    admission: buildAdmissionFromAuthoritativeEpoch(config, report, chosen, decision),
  };
}
