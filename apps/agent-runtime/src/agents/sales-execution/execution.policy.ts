import { createHash } from "node:crypto";
import generatedDraftJsonSchema from "@repo/shared-schemas/json-schema/GeneratedDraft.json";
import {
  RUNTIME_MODEL_PROVIDERS,
  RUNTIME_REASONING_EFFORTS,
  type RuntimeJsonSchema,
  type RuntimeModelInvocationConfig,
  type RuntimeModelOutputFormat,
  type RuntimeModelProvider,
  type RuntimeReasoningEffort,
} from "../../inference/runtime-model";
import {
  IMPLEMENTED_RUNTIME_MODEL_PROVIDERS,
  runtimeModelOutputConfigurationForProvider,
} from "../../inference/runtime-model-registry";
import { DEFAULT_DRAFT_EVIDENCE_MAX_AGE_DAYS } from "./build-draft-context";

export type DraftFallbackPolicy = "template" | "hold";
export type RuntimeDraftOutputFormat = "json_schema";

export const RUNTIME_DRAFT_POLICY_VERSION = "runtime-draft-policy-v8";

type GeneratedDraftSchemaArtifact = {
  definitions?: {
    GeneratedDraft?: RuntimeJsonSchema;
  };
};

const GENERATED_DRAFT_PROVIDER_SCHEMA = (
  generatedDraftJsonSchema as GeneratedDraftSchemaArtifact
).definitions?.GeneratedDraft;

if (!GENERATED_DRAFT_PROVIDER_SCHEMA) {
  throw new Error("GeneratedDraft JSON Schema artifact is missing its canonical definition.");
}

const canonicalRuntimeDraftOutputFormat = (): RuntimeModelOutputFormat => ({
  type: "json_schema",
  schema: GENERATED_DRAFT_PROVIDER_SCHEMA as RuntimeJsonSchema,
});

export interface RuntimeDraftingPolicy {
  enabled: boolean;
  provider: RuntimeModelProvider;
  /** Opaque provider credential. It is never copied into audit snapshots. */
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  /** Maximum output tokens for one provider call. */
  maxTokens: number;
  /** Conservative upper bound for one request's model-visible input tokens. */
  maxInputTokens: number;
  /** Maximum verified evidence signals admitted to one model-visible context. */
  maxSignals: number;
  /** Maximum simultaneous provider calls in one prioritization run. */
  maxConcurrent: number;
  /** Conservative run-level input + output token reservation budget. */
  maxRunTokens: number;
  /** Maximum evidence age; omission is normalized to the fail-closed default. */
  maxEvidenceAgeDays?: number;
  maxAttempts: 1;
  fallback: DraftFallbackPolicy;
  /** Provider-neutral intent. An adapter must reject unsupported mappings. */
  reasoningEffort?: RuntimeReasoningEffort;
  /** Current P4 requires a provider-native JSON Schema constraint when invoked. */
  outputFormat?: RuntimeDraftOutputFormat;
}

/** Non-secret effective policy persisted before and after every model call. */
export interface RuntimeDraftingPolicyAuditSnapshot {
  enabled: boolean;
  provider: RuntimeModelProvider;
  model: string | null;
  timeoutMs: number;
  maxTokens: number;
  maxInputTokens: number;
  maxSignals: number;
  maxConcurrent: number;
  maxRunTokens: number;
  maxEvidenceAgeDays: number;
  maxAttempts: 1;
  fallback: DraftFallbackPolicy;
  reasoningEffort: RuntimeReasoningEffort;
  outputFormat: RuntimeDraftOutputFormat;
  /** Full canonical schema supplied by the task contract. */
  canonicalOutputFormat: RuntimeModelOutputFormat;
  /** Exact non-secret provider-native output configuration, when admitted. */
  effectiveProviderOutputConfiguration: Record<string, unknown> | null;
}

const assertPolicyInteger = (
  name: string,
  value: unknown,
  min: number,
  max: number,
): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Invalid runtime drafting policy ${name}: ${String(value)}`);
  }
  return value as number;
};

const assertProvider = (value: unknown): RuntimeModelProvider => {
  if (!RUNTIME_MODEL_PROVIDERS.includes(value as RuntimeModelProvider)) {
    throw new Error(`Unsupported runtime drafting policy provider: ${String(value)}`);
  }
  return value as RuntimeModelProvider;
};

const assertReasoningEffort = (value: unknown): RuntimeReasoningEffort => {
  if (!RUNTIME_REASONING_EFFORTS.includes(value as RuntimeReasoningEffort)) {
    throw new Error(`Unsupported runtime drafting reasoning effort: ${String(value)}`);
  }
  return value as RuntimeReasoningEffort;
};

const implementedRuntimeProviders = new Set<RuntimeModelProvider>(
  IMPLEMENTED_RUNTIME_MODEL_PROVIDERS,
);

/**
 * Normalize and validate any policy regardless of origin. Environment parsing is
 * not a trusted boundary because callers can inject RuntimeDraftingPolicy
 * objects directly through the exported runtime APIs.
 */
export function normalizeRuntimeDraftingPolicy(
  policy: RuntimeDraftingPolicy,
): RuntimeDraftingPolicy {
  if (typeof policy.enabled !== "boolean") {
    throw new Error(`Invalid runtime drafting policy enabled: ${String(policy.enabled)}`);
  }
  const provider = assertProvider(policy.provider);
  if (policy.fallback !== "template" && policy.fallback !== "hold") {
    throw new Error(`Unsupported runtime drafting policy fallback: ${String(policy.fallback)}`);
  }
  if (policy.maxAttempts !== 1) {
    throw new Error(`Invalid runtime drafting policy maxAttempts: ${String(policy.maxAttempts)}`);
  }

  const reasoningEffort = assertReasoningEffort(
    policy.reasoningEffort ?? "provider_default",
  );
  const outputFormat = policy.outputFormat ?? "json_schema";
  if (outputFormat !== "json_schema") {
    throw new Error(`Unsupported runtime drafting output format: ${String(outputFormat)}`);
  }

  const normalized: RuntimeDraftingPolicy = {
    ...policy,
    provider,
    timeoutMs: assertPolicyInteger("timeoutMs", policy.timeoutMs, 250, 30000),
    maxTokens: assertPolicyInteger("maxTokens", policy.maxTokens, 64, 2000),
    maxInputTokens: assertPolicyInteger("maxInputTokens", policy.maxInputTokens, 256, 32000),
    maxSignals: assertPolicyInteger("maxSignals", policy.maxSignals, 1, 32),
    maxConcurrent: assertPolicyInteger("maxConcurrent", policy.maxConcurrent, 1, 16),
    maxRunTokens: assertPolicyInteger("maxRunTokens", policy.maxRunTokens, 256, 500000),
    maxEvidenceAgeDays: assertPolicyInteger(
      "maxEvidenceAgeDays",
      policy.maxEvidenceAgeDays ?? DEFAULT_DRAFT_EVIDENCE_MAX_AGE_DAYS,
      1,
      3650,
    ),
    maxAttempts: 1,
    reasoningEffort,
    outputFormat,
  };

  if (normalized.enabled && (!normalized.apiKey || !normalized.model?.trim())) {
    throw new Error(
      "Runtime drafting enabled policy requires a non-empty apiKey and model identity.",
    );
  }

  return normalized;
}

export function runtimeDraftingPolicyAuditSnapshot(
  policy: RuntimeDraftingPolicy,
): RuntimeDraftingPolicyAuditSnapshot {
  const normalized = normalizeRuntimeDraftingPolicy(policy);
  const reasoningEffort = normalized.reasoningEffort ?? "provider_default";
  const canonicalOutputFormat = canonicalRuntimeDraftOutputFormat();
  return {
    enabled: normalized.enabled,
    provider: normalized.provider,
    model: normalized.model ?? null,
    timeoutMs: normalized.timeoutMs,
    maxTokens: normalized.maxTokens,
    maxInputTokens: normalized.maxInputTokens,
    maxSignals: normalized.maxSignals,
    maxConcurrent: normalized.maxConcurrent,
    maxRunTokens: normalized.maxRunTokens,
    maxEvidenceAgeDays: normalized.maxEvidenceAgeDays ?? DEFAULT_DRAFT_EVIDENCE_MAX_AGE_DAYS,
    maxAttempts: normalized.maxAttempts,
    fallback: normalized.fallback,
    reasoningEffort,
    outputFormat: normalized.outputFormat ?? "json_schema",
    canonicalOutputFormat,
    effectiveProviderOutputConfiguration: runtimeModelOutputConfigurationForProvider(
      normalized.provider,
      canonicalOutputFormat,
      reasoningEffort,
    ),
  };
}

export function hashRuntimeDraftingPolicy(
  snapshot: RuntimeDraftingPolicyAuditSnapshot,
): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

/** Convert the drafting policy to the provider-neutral call contract. */
export function runtimeModelInvocationConfigFromDraftingPolicy(
  policy: RuntimeDraftingPolicy,
): RuntimeModelInvocationConfig {
  const normalized = normalizeRuntimeDraftingPolicy(policy);
  if (!normalized.enabled || !normalized.apiKey || !normalized.model) {
    throw new Error("Runtime model invocation requires an enabled, fully configured policy.");
  }

  return {
    provider: normalized.provider,
    model: normalized.model,
    credential: normalized.apiKey,
    timeoutMs: normalized.timeoutMs,
    maxOutputTokens: normalized.maxTokens,
    reasoningEffort: normalized.reasoningEffort ?? "provider_default",
  };
}

const intFromEnv = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (!value) return fallback;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Invalid runtime drafting numeric configuration: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid runtime drafting numeric configuration: ${value}`);
  }
  return parsed;
};

const boolFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid runtime drafting boolean configuration: ${value}`);
};

export function runtimeDraftingPolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeDraftingPolicy {
  const enabled = boolFromEnv(env.RUNTIME_DRAFTING_ENABLED, false);
  const provider = assertProvider(env.RUNTIME_DRAFT_PROVIDER ?? "anthropic");
  const fallback = env.RUNTIME_DRAFT_FALLBACK ?? "template";

  if (enabled && !implementedRuntimeProviders.has(provider)) {
    throw new Error(
      `RUNTIME_DRAFT_PROVIDER ${provider} has no admitted production adapter.`,
    );
  }
  if (fallback !== "template" && fallback !== "hold") {
    throw new Error(`Unsupported RUNTIME_DRAFT_FALLBACK: ${fallback}`);
  }

  return normalizeRuntimeDraftingPolicy({
    enabled,
    provider,
    apiKey: env.RUNTIME_DRAFT_API_KEY,
    model: env.RUNTIME_DRAFT_MODEL,
    timeoutMs: intFromEnv(env.RUNTIME_DRAFT_TIMEOUT_MS, 5000, 250, 30000),
    maxTokens: intFromEnv(env.RUNTIME_DRAFT_MAX_TOKENS, 600, 64, 2000),
    maxInputTokens: intFromEnv(env.RUNTIME_DRAFT_MAX_INPUT_TOKENS, 4000, 256, 32000),
    maxSignals: intFromEnv(env.RUNTIME_DRAFT_MAX_SIGNALS, 6, 1, 32),
    maxConcurrent: intFromEnv(env.RUNTIME_DRAFT_MAX_CONCURRENT, 4, 1, 16),
    maxRunTokens: intFromEnv(env.RUNTIME_DRAFT_MAX_RUN_TOKENS, 20000, 256, 500000),
    maxEvidenceAgeDays: intFromEnv(
      env.RUNTIME_DRAFT_MAX_EVIDENCE_AGE_DAYS,
      DEFAULT_DRAFT_EVIDENCE_MAX_AGE_DAYS,
      1,
      3650,
    ),
    maxAttempts: 1,
    fallback,
    reasoningEffort: assertReasoningEffort(
      env.RUNTIME_DRAFT_REASONING_EFFORT ?? "provider_default",
    ),
    outputFormat: "json_schema",
  });
}

/**
 * Parsed at module load so an enabled but incomplete runtime-drafting
 * configuration fails fast during process startup rather than on the first
 * recommendation.
 */
export const DEFAULT_RUNTIME_DRAFTING_POLICY = runtimeDraftingPolicyFromEnv();
