export type DraftFallbackPolicy = "template" | "hold";

export const RUNTIME_DRAFT_POLICY_VERSION = "runtime-draft-policy-v2";

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
  maxAttempts: 1;
  fallback: DraftFallbackPolicy;
}

const intFromEnv = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid runtime drafting numeric configuration: ${value}`);
  }
  return parsed;
};

export function runtimeDraftingPolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeDraftingPolicy {
  const enabled = env.RUNTIME_DRAFTING_ENABLED === "true";
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
