import { createHash } from "node:crypto";
import { DEFAULT_DRAFT_EVIDENCE_MAX_AGE_DAYS } from "./build-draft-context";

export type DraftFallbackPolicy = "template" | "hold";

export const RUNTIME_DRAFT_POLICY_VERSION = "runtime-draft-policy-v6";

export interface RuntimeDraftingPolicy {
  enabled: boolean;
  provider: "anthropic";
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
}

/** Non-secret effective policy persisted with every draft outcome. */
export interface RuntimeDraftingPolicyAuditSnapshot {
  enabled: boolean;
  provider: "anthropic";
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
}

export function runtimeDraftingPolicyAuditSnapshot(
  policy: RuntimeDraftingPolicy,
): RuntimeDraftingPolicyAuditSnapshot {
  return {
    enabled: policy.enabled,
    provider: policy.provider,
    model: policy.model ?? null,
    timeoutMs: policy.timeoutMs,
    maxTokens: policy.maxTokens,
    maxInputTokens: policy.maxInputTokens,
    maxSignals: policy.maxSignals,
    maxConcurrent: policy.maxConcurrent,
    maxRunTokens: policy.maxRunTokens,
    maxEvidenceAgeDays:
      policy.maxEvidenceAgeDays ?? DEFAULT_DRAFT_EVIDENCE_MAX_AGE_DAYS,
    maxAttempts: policy.maxAttempts,
    fallback: policy.fallback,
  };
}

export function hashRuntimeDraftingPolicy(
  snapshot: RuntimeDraftingPolicyAuditSnapshot,
): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
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
  const provider = env.RUNTIME_DRAFT_PROVIDER ?? "anthropic";
  const fallback = env.RUNTIME_DRAFT_FALLBACK ?? "template";

  if (provider !== "anthropic") {
    throw new Error(`Unsupported RUNTIME_DRAFT_PROVIDER: ${provider}`);
  }
  if (fallback !== "template" && fallback !== "hold") {
    throw new Error(`Unsupported RUNTIME_DRAFT_FALLBACK: ${fallback}`);
  }

  const policy: RuntimeDraftingPolicy = {
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
  };

  if (enabled && (!policy.apiKey || !policy.model)) {
    throw new Error(
      "Runtime drafting is enabled but RUNTIME_DRAFT_API_KEY or RUNTIME_DRAFT_MODEL is missing.",
    );
  }

  return policy;
}

/**
 * Parsed at module load so an enabled but incomplete runtime-drafting
 * configuration fails fast during process startup rather than on the first
 * recommendation.
 */
export const DEFAULT_RUNTIME_DRAFTING_POLICY = runtimeDraftingPolicyFromEnv();
