import {
  anthropicRuntimeModelClient,
  buildAnthropicOutputConfig,
} from "./anthropic-runtime-model";
import {
  RuntimeModelError,
  type RuntimeModelClient,
  type RuntimeModelOutputFormat,
  type RuntimeModelProvider,
  type RuntimeReasoningEffort,
} from "./runtime-model";

export const IMPLEMENTED_RUNTIME_MODEL_PROVIDERS = ["anthropic"] as const;

/**
 * Deterministically resolve the configured provider to exactly one adapter.
 * There is no routing, fallback provider, or automatic escalation.
 */
export function runtimeModelClientForProvider(
  provider: RuntimeModelProvider,
): RuntimeModelClient {
  switch (provider) {
    case "anthropic":
      return anthropicRuntimeModelClient;
    case "openai":
    case "xai":
    case "google":
      throw new RuntimeModelError(
        "DRAFT_MODEL_CONFIG_ERROR",
        `Runtime model provider ${provider} has no admitted production adapter yet.`,
      );
  }
}

/**
 * Return the exact non-secret provider output configuration for admitted
 * adapters. Unimplemented providers return null; enabled production policy for
 * those providers already fails closed during startup.
 */
export function runtimeModelOutputConfigurationForProvider(
  provider: RuntimeModelProvider,
  outputFormat: RuntimeModelOutputFormat,
  reasoningEffort: RuntimeReasoningEffort,
): Record<string, unknown> | null {
  switch (provider) {
    case "anthropic":
      return buildAnthropicOutputConfig(outputFormat, reasoningEffort);
    case "openai":
    case "xai":
    case "google":
      return null;
  }
}
