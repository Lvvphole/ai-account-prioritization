import { anthropicRuntimeModelClient } from "./anthropic-runtime-model";
import {
  RuntimeModelError,
  type RuntimeModelClient,
  type RuntimeModelProvider,
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
    case "google":
      throw new RuntimeModelError(
        "DRAFT_MODEL_CONFIG_ERROR",
        `Runtime model provider ${provider} has no admitted production adapter yet.`,
      );
  }
}
