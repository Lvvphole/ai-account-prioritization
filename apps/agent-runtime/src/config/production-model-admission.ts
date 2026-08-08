import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RUNTIME_MODEL_PROVIDERS,
  RUNTIME_REASONING_EFFORTS,
  type RuntimeModelProvider,
  type RuntimeReasoningEffort,
} from "../inference/runtime-model";

export const P4_PRODUCTION_MODEL_ADMISSION_CONTRACT_VERSION =
  "p4-production-model-admission-v1";

export interface ProductionModelAdmissionBudgets {
  timeoutMs: number;
  maxOutputTokens: number;
  maxInputTokens: number;
  maxSignals: number;
  maxConcurrent: number;
  maxRunTokens: number;
  maxEvidenceAgeDays: number;
}

export interface ProductionModelQualificationEvidence {
  contractVersion: string;
  corpusVersion: string;
  corpusHash: string;
  qualificationPolicyHash: string;
  reportHash: string;
  generatedAt: string;
}

export interface ProductionModelAdmission {
  contractVersion: typeof P4_PRODUCTION_MODEL_ADMISSION_CONTRACT_VERSION;
  decision: "ADMITTED";
  decisionOwner: string;
  decisionRef: string;
  candidateId: string;
  provider: RuntimeModelProvider;
  modelId: string;
  modelRevisionOrFingerprint: string | null;
  reasoningProfile: RuntimeReasoningEffort;
  structuredOutputProfile: "json_schema";
  toolSchemaProfile: "not_applicable_current_spine";
  samplingProfile: "provider_default";
  currentProductionWhatOwner: "deterministic";
  fallback: "template" | "hold";
  budgets: ProductionModelAdmissionBudgets;
  qualification: ProductionModelQualificationEvidence;
}

export interface AdmissionComparableRuntimeDraftingPolicy {
  provider: RuntimeModelProvider;
  model?: string;
  timeoutMs: number;
  maxTokens: number;
  maxInputTokens: number;
  maxSignals: number;
  maxConcurrent: number;
  maxRunTokens: number;
  maxEvidenceAgeDays?: number;
  maxAttempts: 1;
  fallback: "template" | "hold";
  reasoningEffort?: RuntimeReasoningEffort;
  outputFormat?: "json_schema";
}

const asRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${path} contains unexpected or missing fields.`);
  }
};

const nonEmptyString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
};

const exactString = <T extends string>(value: unknown, expected: T, path: string): T => {
  if (value !== expected) throw new Error(`${path} must equal ${expected}.`);
  return expected;
};

const boundedInteger = (
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

const sha256 = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${path} must be a lowercase SHA-256 hex string.`);
  }
  return value;
};

const provider = (value: unknown): RuntimeModelProvider => {
  if (!RUNTIME_MODEL_PROVIDERS.includes(value as RuntimeModelProvider)) {
    throw new Error(`provider is not supported: ${String(value)}`);
  }
  return value as RuntimeModelProvider;
};

const reasoningProfile = (value: unknown): RuntimeReasoningEffort => {
  if (!RUNTIME_REASONING_EFFORTS.includes(value as RuntimeReasoningEffort)) {
    throw new Error(`reasoningProfile is not supported: ${String(value)}`);
  }
  return value as RuntimeReasoningEffort;
};

const nullableString = (value: unknown, path: string): string | null => {
  if (value === null) return null;
  return nonEmptyString(value, path);
};

export function parseProductionModelAdmission(value: unknown): ProductionModelAdmission {
  const raw = asRecord(value, "production model admission");
  exactKeys(
    raw,
    [
      "contractVersion",
      "decision",
      "decisionOwner",
      "decisionRef",
      "candidateId",
      "provider",
      "modelId",
      "modelRevisionOrFingerprint",
      "reasoningProfile",
      "structuredOutputProfile",
      "toolSchemaProfile",
      "samplingProfile",
      "currentProductionWhatOwner",
      "fallback",
      "budgets",
      "qualification",
    ],
    "production model admission",
  );

  const fallback = raw.fallback;
  if (fallback !== "template" && fallback !== "hold") {
    throw new Error("fallback must be template or hold.");
  }

  const budgets = asRecord(raw.budgets, "budgets");
  exactKeys(
    budgets,
    [
      "timeoutMs",
      "maxOutputTokens",
      "maxInputTokens",
      "maxSignals",
      "maxConcurrent",
      "maxRunTokens",
      "maxEvidenceAgeDays",
    ],
    "budgets",
  );

  const qualification = asRecord(raw.qualification, "qualification");
  exactKeys(
    qualification,
    [
      "contractVersion",
      "corpusVersion",
      "corpusHash",
      "qualificationPolicyHash",
      "reportHash",
      "generatedAt",
    ],
    "qualification",
  );

  return {
    contractVersion: exactString(
      raw.contractVersion,
      P4_PRODUCTION_MODEL_ADMISSION_CONTRACT_VERSION,
      "contractVersion",
    ),
    decision: exactString(raw.decision, "ADMITTED", "decision"),
    decisionOwner: nonEmptyString(raw.decisionOwner, "decisionOwner"),
    decisionRef: nonEmptyString(raw.decisionRef, "decisionRef"),
    candidateId: nonEmptyString(raw.candidateId, "candidateId"),
    provider: provider(raw.provider),
    modelId: nonEmptyString(raw.modelId, "modelId"),
    modelRevisionOrFingerprint: nullableString(
      raw.modelRevisionOrFingerprint,
      "modelRevisionOrFingerprint",
    ),
    reasoningProfile: reasoningProfile(raw.reasoningProfile),
    structuredOutputProfile: exactString(
      raw.structuredOutputProfile,
      "json_schema",
      "structuredOutputProfile",
    ),
    toolSchemaProfile: exactString(
      raw.toolSchemaProfile,
      "not_applicable_current_spine",
      "toolSchemaProfile",
    ),
    samplingProfile: exactString(
      raw.samplingProfile,
      "provider_default",
      "samplingProfile",
    ),
    currentProductionWhatOwner: exactString(
      raw.currentProductionWhatOwner,
      "deterministic",
      "currentProductionWhatOwner",
    ),
    fallback,
    budgets: {
      timeoutMs: boundedInteger(budgets.timeoutMs, "budgets.timeoutMs", 250, 30000),
      maxOutputTokens: boundedInteger(
        budgets.maxOutputTokens,
        "budgets.maxOutputTokens",
        64,
        2000,
      ),
      maxInputTokens: boundedInteger(
        budgets.maxInputTokens,
        "budgets.maxInputTokens",
        256,
        32000,
      ),
      maxSignals: boundedInteger(budgets.maxSignals, "budgets.maxSignals", 1, 32),
      maxConcurrent: boundedInteger(
        budgets.maxConcurrent,
        "budgets.maxConcurrent",
        1,
        16,
      ),
      maxRunTokens: boundedInteger(
        budgets.maxRunTokens,
        "budgets.maxRunTokens",
        256,
        500000,
      ),
      maxEvidenceAgeDays: boundedInteger(
        budgets.maxEvidenceAgeDays,
        "budgets.maxEvidenceAgeDays",
        1,
        3650,
      ),
    },
    qualification: {
      contractVersion: nonEmptyString(
        qualification.contractVersion,
        "qualification.contractVersion",
      ),
      corpusVersion: nonEmptyString(
        qualification.corpusVersion,
        "qualification.corpusVersion",
      ),
      corpusHash: sha256(qualification.corpusHash, "qualification.corpusHash"),
      qualificationPolicyHash: sha256(
        qualification.qualificationPolicyHash,
        "qualification.qualificationPolicyHash",
      ),
      reportHash: sha256(qualification.reportHash, "qualification.reportHash"),
      generatedAt: nonEmptyString(qualification.generatedAt, "qualification.generatedAt"),
    },
  };
}

export function loadProductionModelAdmission(path: string): ProductionModelAdmission {
  if (!path.trim()) throw new Error("P4 production model admission path is empty.");
  const absolutePath = resolve(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Could not load P4 production model admission at ${absolutePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return parseProductionModelAdmission(parsed);
}

export function productionModelAdmissionHash(admission: ProductionModelAdmission): string {
  const parsed = parseProductionModelAdmission(admission);
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}

export function assertRuntimeDraftingPolicyMatchesAdmission(
  policy: AdmissionComparableRuntimeDraftingPolicy,
  admission: ProductionModelAdmission,
): void {
  const mismatches: string[] = [];
  const compare = (name: string, actual: unknown, expected: unknown): void => {
    if (actual !== expected) mismatches.push(name);
  };

  compare("provider", policy.provider, admission.provider);
  compare("model", policy.model ?? null, admission.modelId);
  compare("reasoningEffort", policy.reasoningEffort ?? "provider_default", admission.reasoningProfile);
  compare("outputFormat", policy.outputFormat ?? "json_schema", admission.structuredOutputProfile);
  compare("fallback", policy.fallback, admission.fallback);
  compare("timeoutMs", policy.timeoutMs, admission.budgets.timeoutMs);
  compare("maxTokens", policy.maxTokens, admission.budgets.maxOutputTokens);
  compare("maxInputTokens", policy.maxInputTokens, admission.budgets.maxInputTokens);
  compare("maxSignals", policy.maxSignals, admission.budgets.maxSignals);
  compare("maxConcurrent", policy.maxConcurrent, admission.budgets.maxConcurrent);
  compare("maxRunTokens", policy.maxRunTokens, admission.budgets.maxRunTokens);
  compare(
    "maxEvidenceAgeDays",
    policy.maxEvidenceAgeDays,
    admission.budgets.maxEvidenceAgeDays,
  );
  compare("maxAttempts", policy.maxAttempts, 1);

  if (mismatches.length > 0) {
    throw new Error(
      `Runtime drafting configuration does not match the admitted production model configuration: ${mismatches.join(", ")}.`,
    );
  }
}
