import {
  hashQualificationMaterial,
  type ModelQualificationConfig,
  type QualificationOverallVerdict,
} from "./qualification-contract";
import { CURRENT_SPINE_QUALIFICATION_CORPUS } from "./qualification-corpus";
import {
  buildProductionModelAdmission,
  type ProductionModelAdmissionDecision,
} from "./production-admission";
import type {
  ModelQualificationReport,
  QualificationCandidateReport,
} from "./qualification-runner";

const LOCKED_CANDIDATES = [
  {
    id: "anthropic-haiku-4-5-default",
    provider: "anthropic",
    modelId: "claude-haiku-4-5-20251001",
    reasoningProfile: "provider_default",
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

const exactNumber = (actual: number | undefined, expected: number, path: string): void => {
  if (actual !== expected) throw new Error(`${path} must equal the locked value ${expected}.`);
};

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

  for (const locked of LOCKED_CANDIDATES) {
    const candidate = config.candidates.find((item) => item.id === locked.id);
    if (!candidate) throw new Error(`Locked P4 qualification is missing ${locked.id}.`);
    if (
      candidate.provider !== locked.provider ||
      candidate.modelId !== locked.modelId ||
      candidate.reasoningProfile !== locked.reasoningProfile
    ) {
      throw new Error(`Candidate ${locked.id} does not match the locked model identity.`);
    }
    if (candidate.modelRevisionOrFingerprint !== undefined) {
      throw new Error(`Candidate ${locked.id} modelRevisionOrFingerprint must be omitted.`);
    }
    if (
      candidate.structuredOutputProfile !== "json_schema" ||
      candidate.toolSchemaProfile !== "not_applicable_current_spine" ||
      candidate.samplingProfile !== "provider_default" ||
      candidate.credentialEnv !== "ANTHROPIC_API_KEY"
    ) {
      throw new Error(`Candidate ${locked.id} does not match the locked invocation profile.`);
    }
    if (
      !candidate.pricing ||
      hashQualificationMaterial(candidate.pricing) !== hashQualificationMaterial(locked.pricing)
    ) {
      throw new Error(`Candidate ${locked.id} does not match the locked pricing evidence.`);
    }
  }
}

const candidateMeetsLockedQualificationBoundary = (
  config: ModelQualificationConfig,
  report: QualificationCandidateReport,
): boolean => {
  const expectedKeys = new Set<string>();
  for (const item of CURRENT_SPINE_QUALIFICATION_CORPUS) {
    for (let runIndex = 1; runIndex <= config.k; runIndex += 1) {
      expectedKeys.add(`${item.id}:${runIndex}`);
    }
  }
  if (report.runs.length !== expectedKeys.size) return false;

  const seen = new Set<string>();
  for (const [index, run] of report.runs.entries()) {
    if (run.candidateId !== report.candidate.id) {
      throw new Error(`Qualification run ${index} belongs to a different candidate.`);
    }
    const key = `${run.caseId}:${run.runIndex}`;
    if (!expectedKeys.has(key) || seen.has(key)) {
      throw new Error(`Qualification run coverage is invalid for ${report.candidate.id}.`);
    }
    seen.add(key);

    const verifierPass =
      run.source === "model" &&
      run.schemaValidation === "passed" &&
      run.groundingValidation === "passed" &&
      run.authorityImmutable;
    if (run.verifierPass !== verifierPass) {
      throw new Error(`Qualification run ${key} has inconsistent verifier evidence.`);
    }
    if (run.source === "model" && run.qualificationOracleCorrect === null) {
      throw new Error(`Qualification run ${key} is missing the frozen-case oracle result.`);
    }
    if (run.source !== "model" && run.qualificationOracleCorrect !== null) {
      throw new Error(`Qualification run ${key} has an oracle result without model output.`);
    }
    const falseAccept = verifierPass && run.qualificationOracleCorrect === false;
    if (run.falseAccept !== falseAccept) {
      throw new Error(`Qualification run ${key} has inconsistent false-accept evidence.`);
    }
    if (run.providerInvoked && (!run.requestIdentityHash || !run.invocationStartHash)) {
      throw new Error(`Qualification run ${key} is missing invocation identity evidence.`);
    }
    if (run.source === "model" && !run.providerInvoked) {
      throw new Error(`Qualification run ${key} claims model output without provider invocation.`);
    }
    if (run.revisionEvidence !== "not_required") {
      throw new Error(`Qualification run ${key} has unexpected model revision evidence.`);
    }
  }

  if (seen.size !== expectedKeys.size) return false;
  if (
    report.runs.some(
      (run) =>
        run.source !== "model" ||
        !run.verifierPass ||
        run.falseAccept ||
        !run.authorityImmutable ||
        run.inputTokens === null ||
        run.outputTokens === null,
    )
  ) {
    return false;
  }

  for (const item of CURRENT_SPINE_QUALIFICATION_CORPUS) {
    const identities = new Set(
      report.runs
        .filter((run) => run.caseId === item.id)
        .map((run) => run.requestIdentityHash),
    );
    if (identities.size !== 1 || identities.has(null)) return false;
  }

  return true;
};

const assertLockedReport = (
  config: ModelQualificationConfig,
  report: ModelQualificationReport,
): void => {
  assertLockedP4QualificationPolicy(config);
  if (report.candidates.length !== LOCKED_CANDIDATES.length) {
    throw new Error("Qualification report must contain exactly the locked Haiku and Sonnet candidates.");
  }
  for (const locked of LOCKED_CANDIDATES) {
    const configured = config.candidates.find((candidate) => candidate.id === locked.id);
    const reported = report.candidates.find((candidate) => candidate.candidate.id === locked.id);
    if (!configured || !reported) {
      throw new Error(`Qualification report is missing locked candidate ${locked.id}.`);
    }
    if (hashQualificationMaterial(reported.candidate) !== hashQualificationMaterial(configured)) {
      throw new Error(`Qualification report candidate ${locked.id} differs from the locked contract.`);
    }

    const evidenceQualifies = candidateMeetsLockedQualificationBoundary(config, reported);
    if ((reported.verdict === "QUALIFIED") !== evidenceQualifies) {
      throw new Error(
        `Qualification report verdict for ${locked.id} does not match the locked 60/60 evidence boundary.`,
      );
    }
    if (reported.verdict === "QUALIFIED" && reported.reasons.length !== 0) {
      throw new Error(`QUALIFIED candidate ${locked.id} must not contain failure reasons.`);
    }
  }
};

export function qualificationVerdictForLockedP4Policy(
  config: ModelQualificationConfig,
  report: ModelQualificationReport,
): QualificationOverallVerdict {
  assertLockedReport(config, report);
  if (report.candidates.some((candidate) => candidate.verdict === "QUALIFIED")) return "PASS";
  if (report.candidates.some((candidate) => candidate.verdict === "BLOCKED")) return "BLOCKED";
  return "FAIL";
}

export function applyLockedP4QualificationPolicy(
  config: ModelQualificationConfig,
  report: ModelQualificationReport,
): ModelQualificationReport {
  return {
    ...report,
    verdict: qualificationVerdictForLockedP4Policy(config, report),
  };
}

export function selectLockedP4AdmissionCandidateId(
  config: ModelQualificationConfig,
  report: ModelQualificationReport,
): string | null {
  assertLockedReport(config, report);
  for (const candidateId of LOCKED_P4_ADMISSION_CANDIDATE_PRIORITY) {
    const candidate = report.candidates.find((item) => item.candidate.id === candidateId);
    if (candidate?.verdict === "QUALIFIED") return candidateId;
  }
  return null;
}

export function buildLockedP4ProductionModelAdmission(
  config: ModelQualificationConfig,
  report: ModelQualificationReport,
  decision: ProductionModelAdmissionDecision,
) {
  const expectedVerdict = qualificationVerdictForLockedP4Policy(config, report);
  if (report.verdict !== expectedVerdict) {
    throw new Error(
      `Qualification report verdict ${report.verdict} does not match locked P4 policy verdict ${expectedVerdict}.`,
    );
  }

  const selectedCandidateId = selectLockedP4AdmissionCandidateId(config, report);
  if (!selectedCandidateId) {
    throw new Error("Locked P4 admission policy BLOCK: neither Haiku nor Sonnet is QUALIFIED.");
  }
  if (decision.candidateId !== selectedCandidateId) {
    throw new Error(`Locked P4 admission policy requires candidate ${selectedCandidateId}.`);
  }

  return buildProductionModelAdmission(config, report, {
    ...decision,
    candidateId: selectedCandidateId,
  });
}
