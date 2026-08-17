import { buildOpenAIAgentsOutputConfiguration } from "@repo/openai-agents-bridge";
import {
  VERCEL_SANDBOX_OPENAI_RUNTIME_PROFILE,
  VERCEL_SANDBOX_RUNTIME_PROFILE,
  assertVercelSandboxAuthentication,
} from "@repo/sandbox-runtime";
import { buildAnthropicOutputConfig } from "./anthropic-runtime-model";
import { sandboxedAnthropicRuntimeModelClient } from "./sandboxed-anthropic-runtime-model";
import { sandboxedOpenAIRuntimeModelClient } from "./sandboxed-openai-runtime-model";
import {
  RuntimeModelError,
  type RuntimeModelClient,
  type RuntimeModelOutputFormat,
  type RuntimeModelProvider,
  type RuntimeReasoningEffort,
} from "./runtime-model";

export const IMPLEMENTED_RUNTIME_MODEL_PROVIDERS = [
  "anthropic",
  "openai",
] as const;

type RuntimeModelStartupEnvironment = Readonly<
  Record<string, string | undefined>
>;

/**
 * Fail startup before the first model invocation when an enabled production
 * provider cannot authenticate to the Vercel Sandbox control plane.
 */
export function assertRuntimeModelSandboxStartupConfiguration(
  env: RuntimeModelStartupEnvironment = process.env,
): void {
  if (env.NODE_ENV !== "production" || env.RUNTIME_DRAFTING_ENABLED !== "true") {
    return;
  }

  const provider = (env.RUNTIME_DRAFT_PROVIDER ?? "anthropic").trim();
  if (provider === "anthropic" || provider === "openai") {
    assertVercelSandboxAuthentication(env);
  }
}

assertRuntimeModelSandboxStartupConfiguration();

/**
 * Deterministically resolve the configured provider to exactly one sandboxed
 * adapter. There is no routing, fallback provider, or automatic escalation.
 */
export function runtimeModelClientForProvider(
  provider: RuntimeModelProvider,
): RuntimeModelClient {
  switch (provider) {
    case "anthropic":
      return sandboxedAnthropicRuntimeModelClient;
    case "openai":
      return sandboxedOpenAIRuntimeModelClient;
    case "xai":
    case "google":
      throw new RuntimeModelError(
        "DRAFT_MODEL_CONFIG_ERROR",
        `Runtime model provider ${provider} has no admitted production adapter yet.`,
      );
  }
}

/** Return the fixed non-secret execution profile for an implemented provider. */
export function runtimeModelExecutionProfileForProvider(
  provider: RuntimeModelProvider,
): string | null {
  switch (provider) {
    case "anthropic":
      return VERCEL_SANDBOX_RUNTIME_PROFILE.id;
    case "openai":
      return VERCEL_SANDBOX_OPENAI_RUNTIME_PROFILE.id;
    case "xai":
    case "google":
      return null;
  }
}

/**
 * Return the exact non-secret provider output configuration for implemented
 * adapters. Unimplemented providers return null and cannot be selected.
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
      return buildOpenAIAgentsOutputConfiguration(
        outputFormat.schema,
        reasoningEffort === "provider_default" ? undefined : reasoningEffort,
      );
    case "xai":
    case "google":
      return null;
  }
}
