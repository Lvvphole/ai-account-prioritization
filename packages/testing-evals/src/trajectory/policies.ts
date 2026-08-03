import type { RuntimeDraftingPolicy } from "agent-runtime";

export const TEMPLATE_POLICY: RuntimeDraftingPolicy = {
  enabled: false,
  provider: "anthropic",
  timeoutMs: 5000,
  maxTokens: 600,
  maxInputTokens: 4000,
  maxSignals: 6,
  maxConcurrent: 4,
  maxRunTokens: 20000,
  maxEvidenceAgeDays: 90,
  maxAttempts: 1,
  fallback: "template",
};

export const HYBRID_POLICY: RuntimeDraftingPolicy = {
  ...TEMPLATE_POLICY,
  enabled: true,
  apiKey: "eval-only-not-a-secret",
  model: "eval-stub-model",
  fallback: "template",
};
