import { afterEach, describe, expect, it, vi } from "vitest";
import { IMPLEMENTED_RUNTIME_MODEL_PROVIDERS } from "../../inference/runtime-model-registry";
import {
  normalizeRuntimeDraftingPolicy,
  type RuntimeDraftingPolicy,
} from "./execution.policy";

const enabledPolicy = (
  provider: RuntimeDraftingPolicy["provider"],
): RuntimeDraftingPolicy => ({
  enabled: true,
  provider,
  apiKey: "provider-admission-test-key",
  model: "provider-admission-test-model",
  timeoutMs: 1_000,
  maxTokens: 200,
  maxInputTokens: 3_000,
  maxSignals: 5,
  maxConcurrent: 2,
  maxRunTokens: 20_000,
  maxEvidenceAgeDays: 90,
  maxAttempts: 1,
  fallback: "template",
  reasoningEffort: "provider_default",
  outputFormat: "json_schema",
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production provider admission boundary", () => {
  it("does not infer active production authority from multiple implemented providers", () => {
    expect([...IMPLEMENTED_RUNTIME_MODEL_PROVIDERS]).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  it.each(["anthropic", "openai"] as const)(
    "rejects enabled production %s drafting without one production admission",
    (provider) => {
      vi.stubEnv("NODE_ENV", "production");

      expect(() => normalizeRuntimeDraftingPolicy(enabledPolicy(provider))).toThrow(
        "Enabled production runtime drafting requires a qualified production model admission.",
      );
    },
  );
});
