import {
  assertVercelSandboxAuthentication,
  createVercelSandboxFetch,
  vercelSandboxAccessTokenFromEnv,
  type SandboxFactory,
  type VercelSandboxAccessToken,
} from "@repo/sandbox-runtime";
import { createAnthropicRuntimeModelClient } from "./anthropic-runtime-model";
import type { RuntimeModelClient } from "./runtime-model";

export interface SandboxedAnthropicRuntimeModelClientOptions {
  accessToken?: VercelSandboxAccessToken;
  createSandbox?: SandboxFactory;
  controlPlaneFetch?: typeof fetch;
}

/**
 * Production Anthropic transport. The official provider SDK remains responsible
 * for the Messages API contract. Its HTTP request executes through the isolated
 * sandbox transport. Sandbox failure never falls back to direct host fetch.
 */
export function createSandboxedAnthropicRuntimeModelClient(
  options: SandboxedAnthropicRuntimeModelClientOptions = {},
): RuntimeModelClient {
  return {
    async generate(request, config) {
      if (!options.createSandbox && options.accessToken === undefined) {
        assertVercelSandboxAuthentication(process.env);
      }
      const accessToken =
        options.accessToken ?? vercelSandboxAccessTokenFromEnv(process.env);
      const sandboxFetch = createVercelSandboxFetch({
        credential: config.credential,
        timeoutMs: config.timeoutMs,
        accessToken,
        createSandbox: options.createSandbox,
        controlPlaneFetch: options.controlPlaneFetch,
      });
      return createAnthropicRuntimeModelClient(sandboxFetch).generate(
        request,
        config,
      );
    },
  };
}

export const sandboxedAnthropicRuntimeModelClient =
  createSandboxedAnthropicRuntimeModelClient();
