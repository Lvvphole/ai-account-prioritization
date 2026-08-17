import { createHash } from "node:crypto";
import {
  RUNTIME_MODEL_PROVIDERS,
  RUNTIME_REASONING_EFFORTS,
  type RuntimeModelClient,
  type RuntimeModelInvocationConfig,
  type RuntimeModelProvider,
  type RuntimeModelRequest,
  type RuntimeReasoningEffort,
} from "agent-runtime";

export const P4_MODEL_QUALIFICATION_CONTRACT_VERSION = "p4-model-qualification-v2";
export const CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION =
  "current-spine-drafting-corpus-v1";

export type QualificationCandidateVerdict = "QUALIFIED" | "DISQUALIFIED" | "BLOCKED";
export type QualificationOverallVerdict = "PASS" | "FAIL" | "BLOCKED";
export type QualificationAdmissionMode = "eligible" | "qualification_only";

export interface QualificationPricing {
  inputUsdPerMillionTokens: number;
  cachedInputUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens: number;
  effectiveDate: string;
  source: string;
}

export interface QualificationCandidate {
  id: string;
  provider: RuntimeModelProvider;
  modelId: string;
  modelRevisionOrFingerprint?: string;
  reasoningProfile: RuntimeReasoningEffort;
  structuredOutputProfile: "json_schema";
  toolSchemaProfile: "not_applicable_current_spine";
  samplingProfile: "provider_default";
  admissionMode: QualificationAdmissionMode;
  credentialEnv: string;
  pricing?: QualificationPricing;
}

export interface QualificationBudgets {
  timeoutMs: number;
  maxOutputTokens: number;
  maxInputTokens: number;
  maxSignals: number;
  maxConcurrent: number;
  /** Production-shaped shared reservation cap for one simulated batch. */
  maxRunTokens: number;
  maxEvidenceAgeDays: number;
}

export interface QualificationThresholds {
  minModelVerifierPassRate: number;
  maxFallbackRate: number;
  maxFalseAcceptRate: 0;
  requireCompleteTokenTelemetry: boolean;
  maxP95LatencyMs?: number;
  maxCostPerVerifiedPassUsd?: number;
}

export interface ModelQualificationConfig {
  contractVersion: typeof P4_MODEL_QUALIFICATION_CONTRACT_VERSION;
  corpusVersion: typeof CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION;
  k: number;
  fallback: "template" | "hold";
  /** Offline candidate-epoch reservation cap. It is separate from production maxRunTokens. */
  qualificationEpochMaxRunTokens: number;
  budgets: QualificationBudgets;
  thresholds: QualificationThresholds;
  candidates: QualificationCandidate[];
}

export interface QualificationResolvedClient {
  /** Runtime credential. It must never be copied into qualification evidence. */
  credential: string;
  client: RuntimeModelClient;
  effectiveProviderConfiguration: (
    request: RuntimeModelRequest,
    config: RuntimeModelInvocationConfig,
  ) => Record<string, unknown>;
}

export type QualificationClientResolver = (
  candidate: QualificationCandidate,
) => QualificationResolvedClient;

export class QualificationDependencyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "QualificationDependencyError";
  }
}

const asRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const nonEmptyString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
};

const boundedSafeInteger = (
  value: unknown,
  path: string,
  min: number,
  max: number,
): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${path} must be a safe integer from ${min} through ${max}.`);
  }
  return value as number;
};

const positiveSafeInteger = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive safe integer.`);
  }
  return value as number;
};

const nonNegativeNumber = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a finite non-negative number.`);
  }
  return value;
};

const rate = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be a number from 0 through 1.`);
  }
  return value;
};

const optionalPositiveNumber = (value: unknown, path: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be a finite positive number when supplied.`);
  }
  return value;
};

const provider = (value: unknown, path: string): RuntimeModelProvider => {
  if (!RUNTIME_MODEL_PROVIDERS.includes(value as RuntimeModelProvider)) {
    throw new Error(`${path} is not a supported qualification provider.`);
  }
  return value as RuntimeModelProvider;
};

const reasoningProfile = (value: unknown, path: string): RuntimeReasoningEffort => {
  if (!RUNTIME_REASONING_EFFORTS.includes(value as RuntimeReasoningEffort)) {
    throw new Error(`${path} is not a supported reasoning profile.`);
  }
  return value as RuntimeReasoningEffort;
};

const admissionMode = (value: unknown, path: string): QualificationAdmissionMode => {
  if (value === undefined) return "qualification_only";
  if (value !== "eligible" && value !== "qualification_only") {
    throw new Error(`${path} must be eligible or qualification_only.`);
  }
  return value;
};

const exactString = <T extends string>(value: unknown, expected: T, path: string): T => {
  if (value !== expected) throw new Error(`${path} must equal ${expected}.`);
  return expected;
};

const parsePricing = (value: unknown, path: string): QualificationPricing | undefined => {
  if (value === undefined) return undefined;
  const raw = asRecord(value, path);
  return {
    inputUsdPerMillionTokens: nonNegativeNumber(
      raw.inputUsdPerMillionTokens,
      `${path}.inputUsdPerMillionTokens`,
    ),
    cachedInputUsdPerMillionTokens:
      raw.cachedInputUsdPerMillionTokens === undefined
        ? undefined
        : nonNegativeNumber(
            raw.cachedInputUsdPerMillionTokens,
            `${path}.cachedInputUsdPerMillionTokens`,
          ),
    outputUsdPerMillionTokens: nonNegativeNumber(
      raw.outputUsdPerMillionTokens,
      `${path}.outputUsdPerMillionTokens`,
    ),
    effectiveDate: nonEmptyString(raw.effectiveDate, `${path}.effectiveDate`),
    source: nonEmptyString(raw.source, `${path}.source`),
  };
};

const parseCandidate = (value: unknown, index: number): QualificationCandidate => {
  const path = `candidates[${index}]`;
  const raw = asRecord(value, path);
  const credentialEnv = nonEmptyString(raw.credentialEnv, `${path}.credentialEnv`);
  if (!/^[A-Z][A-Z0-9_]*$/.test(credentialEnv)) {
    throw new Error(`${path}.credentialEnv must be an uppercase environment variable name.`);
  }

  return {
    id: nonEmptyString(raw.id, `${path}.id`),
    provider: provider(raw.provider, `${path}.provider`),
    modelId: nonEmptyString(raw.modelId, `${path}.modelId`),
    modelRevisionOrFingerprint:
      raw.modelRevisionOrFingerprint === undefined
        ? undefined
        : nonEmptyString(raw.modelRevisionOrFingerprint, `${path}.modelRevisionOrFingerprint`),
    reasoningProfile: reasoningProfile(raw.reasoningProfile, `${path}.reasoningProfile`),
    structuredOutputProfile: exactString(
      raw.structuredOutputProfile,
      "json_schema",
      `${path}.structuredOutputProfile`,
    ),
    toolSchemaProfile: exactString(
      raw.toolSchemaProfile,
      "not_applicable_current_spine",
      `${path}.toolSchemaProfile`,
    ),
    samplingProfile: exactString(
      raw.samplingProfile,
      "provider_default",
      `${path}.samplingProfile`,
    ),
    admissionMode: admissionMode(raw.admissionMode, `${path}.admissionMode`),
    credentialEnv,
    pricing: parsePricing(raw.pricing, `${path}.pricing`),
  };
};

export function parseModelQualificationConfig(value: unknown): ModelQualificationConfig {
  const raw = asRecord(value, "qualification config");
  exactString(
    raw.contractVersion,
    P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    "contractVersion",
  );
  exactString(
    raw.corpusVersion,
    CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    "corpusVersion",
  );

  const budgetsRaw = asRecord(raw.budgets, "budgets");
  const thresholdsRaw = asRecord(raw.thresholds, "thresholds");
  if (!Array.isArray(raw.candidates) || raw.candidates.length === 0) {
    throw new Error("candidates must contain at least one candidate.");
  }
  if (thresholdsRaw.maxFalseAcceptRate !== 0) {
    throw new Error("thresholds.maxFalseAcceptRate must be 0 for the mandatory safety boundary.");
  }
  if (typeof thresholdsRaw.requireCompleteTokenTelemetry !== "boolean") {
    throw new Error("thresholds.requireCompleteTokenTelemetry must be boolean.");
  }

  const candidates = raw.candidates.map(parseCandidate);
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.id)) throw new Error(`Duplicate candidate id: ${candidate.id}`);
    ids.add(candidate.id);
  }

  if (raw.fallback !== "template" && raw.fallback !== "hold") {
    throw new Error("fallback must be template or hold.");
  }

  return {
    contractVersion: P4_MODEL_QUALIFICATION_CONTRACT_VERSION,
    corpusVersion: CURRENT_SPINE_QUALIFICATION_CORPUS_VERSION,
    k: positiveSafeInteger(raw.k, "k"),
    fallback: raw.fallback,
    qualificationEpochMaxRunTokens: positiveSafeInteger(
      raw.qualificationEpochMaxRunTokens,
      "qualificationEpochMaxRunTokens",
    ),
    budgets: {
      timeoutMs: boundedSafeInteger(budgetsRaw.timeoutMs, "budgets.timeoutMs", 250, 30000),
      maxOutputTokens: boundedSafeInteger(
        budgetsRaw.maxOutputTokens,
        "budgets.maxOutputTokens",
        64,
        2000,
      ),
      maxInputTokens: boundedSafeInteger(
        budgetsRaw.maxInputTokens,
        "budgets.maxInputTokens",
        256,
        32000,
      ),
      maxSignals: boundedSafeInteger(budgetsRaw.maxSignals, "budgets.maxSignals", 1, 32),
      maxConcurrent: boundedSafeInteger(
        budgetsRaw.maxConcurrent,
        "budgets.maxConcurrent",
        1,
        16,
      ),
      maxRunTokens: boundedSafeInteger(
        budgetsRaw.maxRunTokens,
        "budgets.maxRunTokens",
        256,
        500000,
      ),
      maxEvidenceAgeDays: boundedSafeInteger(
        budgetsRaw.maxEvidenceAgeDays,
        "budgets.maxEvidenceAgeDays",
        1,
        3650,
      ),
    },
    thresholds: {
      minModelVerifierPassRate: rate(
        thresholdsRaw.minModelVerifierPassRate,
        "thresholds.minModelVerifierPassRate",
      ),
      maxFallbackRate: rate(thresholdsRaw.maxFallbackRate, "thresholds.maxFallbackRate"),
      maxFalseAcceptRate: 0,
      requireCompleteTokenTelemetry: thresholdsRaw.requireCompleteTokenTelemetry,
      maxP95LatencyMs: optionalPositiveNumber(
        thresholdsRaw.maxP95LatencyMs,
        "thresholds.maxP95LatencyMs",
      ),
      maxCostPerVerifiedPassUsd: optionalPositiveNumber(
        thresholdsRaw.maxCostPerVerifiedPassUsd,
        "thresholds.maxCostPerVerifiedPassUsd",
      ),
    },
    candidates,
  };
}

const compareKeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => compareKeys(a, b))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
};

export function canonicalQualificationJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashQualificationMaterial(value: unknown): string {
  return createHash("sha256").update(canonicalQualificationJson(value)).digest("hex");
}
