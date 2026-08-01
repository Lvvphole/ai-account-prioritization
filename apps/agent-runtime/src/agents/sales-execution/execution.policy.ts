export type DraftFallbackPolicy = "template" | "hold";

export const RUNTIME_DRAFT_POLICY_VERSION = "runtime-draft-policy-v1";

export interface RuntimeDraftingPolicy {
  enabled: boolean;
  provider: "anthropic";
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  maxTokens: number;
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
