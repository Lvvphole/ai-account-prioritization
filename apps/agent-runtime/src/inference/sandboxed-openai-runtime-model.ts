import {
  VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER,
  assertVercelSandboxAuthentication,
  createOpenAIVercelSandboxFetch,
  vercelSandboxAccessTokenFromEnv,
  type SandboxFactory,
  type VercelSandboxAccessToken,
} from "@repo/sandbox-runtime";
import { createOpenAIRuntimeModelClient } from "./openai-runtime-model";
import type { RuntimeModelClient } from "./runtime-model";

export interface SandboxedOpenAIRuntimeModelClientOptions {
  accessToken?: VercelSandboxAccessToken;
  createSandbox?: SandboxFactory;
  controlPlaneFetch?: typeof fetch;
}

/**
 * Production OpenAI transport. The Agents SDK receives only a placeholder
 * credential. The sandbox network policy injects the real credential at trusted
 * egress. Sandbox failure never falls back to direct host fetch.
 */
export function createSandboxedOpenAIRuntimeModelClient(
  options: SandboxedOpenAIRuntimeModelClientOptions = {},
): RuntimeModelClient {
  return {
    async generate(request, config) {
      if (!options.createSandbox && options.accessToken === undefined) {
        assertVercelSandboxAuthentication(process.env);
      }
      const accessToken =
        options.accessToken ?? vercelSandboxAccessTokenFromEnv(process.env);
      const sandboxFetch = createOpenAIVercelSandboxFetch({
        credential: config.credential,
        timeoutMs: config.timeoutMs,
        accessToken,
        createSandbox: options.createSandbox,
        controlPlaneFetch: options.controlPlaneFetch,
      });
      return createOpenAIRuntimeModelClient(sandboxFetch).generate(request, {
        ...config,
        credential: VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER,
      });
    },
  };
}

export const sandboxedOpenAIRuntimeModelClient =
  createSandboxedOpenAIRuntimeModelClient();
