import {
  IMPLEMENTED_RUNTIME_MODEL_PROVIDERS,
  P4_PRODUCTION_MODEL_ADMISSION_CONTRACT_VERSION,
  parseProductionModelAdmission,
  type ProductionModelAdmission,
} from "agent-runtime";
import {
  hashQualificationMaterial,
  type ModelQualificationConfig,
  type QualificationClientResolver,
  type QualificationOverallVerdict,
} from "./qualification-contract";
import {
  runCurrentSpineModelQualification,
  type ModelQualificationReport,
} from "./qualification-runner";

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

const selectedCandidateId = (
  config: ModelQualificationConfig,
  report: ModelQualificationReport,
): string | null => {
  for (const configuredCandidate of config.candidates) {
    const evaluated = report.candidates.find(
      (item) => item.candidate.id === configuredCandidate.id,
    );
    if (evaluated?.verdict === "QUALIFIED") return configuredCandidate.id;
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
 * The caller supplies the parsed executable policy. This module does not copy or
 * redefine policy values. Candidate array order is the deterministic admission
 * priority. The full qualification report is audit evidence and is not consumed
 * by a later admission authority.
 */
export async function runLockedP4QualificationEpoch(
  config: ModelQualificationConfig,
  resolveClient: QualificationClientResolver,
  decision: LockedP4AdmissionDecisionMetadata,
  now: () => string = () => new Date().toISOString(),
): Promise<LockedP4QualificationEpochResult> {
  nonEmpty(decision.decisionOwner, "decision.decisionOwner");
  nonEmpty(decision.decisionRef, "decision.decisionRef");

  const rawReport = await runCurrentSpineModelQualification(config, resolveClient, now);
  const chosen = selectedCandidateId(config, rawReport);
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
