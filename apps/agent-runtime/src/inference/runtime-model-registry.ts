import { VERCEL_SANDBOX_RUNTIME_PROFILE } from "@repo/sandbox-runtime";
import { buildAnthropicOutputConfig } from "./anthropic-runtime-model";
import { sandboxedAnthropicRuntimeModelClient } from "./sandboxed-anthropic-runtime-model";
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
 * There is no routing, fallback provider, or automatic escalation. The current
 * production Anthropic adapter always uses the admitted sandbox transport.
 */
export function runtimeModelClientForProvider(
  provider: RuntimeModelProvider,
): RuntimeModelClient {
  switch (provider) {
    case "anthropic":
      return sandboxedAnthropicRuntimeModelClient;
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
 * Return the fixed non-secret execution profile for an admitted production
 * provider. Injected test clients do not use this resolver and must record null.
 */
export function runtimeModelExecutionProfileForProvider(
  provider: RuntimeModelProvider,
): string | null {
  switch (provider) {
    case "anthropic":
      return VERCEL_SANDBOX_RUNTIME_PROFILE.id;
    case "openai":
    case "xai":
    case "google":
      return null;
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
