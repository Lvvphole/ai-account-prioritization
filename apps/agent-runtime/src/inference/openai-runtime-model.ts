import {
  OpenAIAgentsBridgeError,
  runOpenAIAgentsBridge,
  type OpenAIAgentsBridgeRequest,
  type OpenAIAgentsBridgeResult,
} from "@repo/openai-agents-bridge";
import {
  RuntimeModelError,
  type RuntimeModelClient,
  type RuntimeModelInvocationConfig,
  type RuntimeModelTelemetry,
} from "./runtime-model";

export type OpenAIAgentsInvoker = (
  request: OpenAIAgentsBridgeRequest,
  fetchImpl: typeof fetch,
) => Promise<OpenAIAgentsBridgeResult>;

export function assertOpenAIConfig(
  config: RuntimeModelInvocationConfig,
): void {
  if (
    config.provider !== "openai" ||
    !config.credential ||
    !config.model.trim() ||
    !Number.isFinite(config.timeoutMs) ||
    config.timeoutMs <= 0 ||
    !Number.isFinite(config.maxOutputTokens) ||
    config.maxOutputTokens <= 0
  ) {
    throw new RuntimeModelError(
      "DRAFT_MODEL_CONFIG_ERROR",
      "OpenAI runtime adapter requires provider=openai, a credential, a model identity, and positive runtime budgets.",
    );
  }
}

export function createOpenAIRuntimeModelClient(
  fetchImpl: typeof fetch,
  invoke: OpenAIAgentsInvoker = runOpenAIAgentsBridge,
): RuntimeModelClient {
  return {
    async generate(request, config) {
      assertOpenAIConfig(config);
      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      const failureTelemetry = (): RuntimeModelTelemetry => ({
        provider: "openai",
        model: config.model,
        latencyMs: Date.now() - started,
      });

      try {
        const result = await invoke(
          {
            credential: config.credential,
            model: config.model,
            system: request.system,
            user: request.user,
            outputSchema: request.outputFormat.schema,
            maxOutputTokens: config.maxOutputTokens,
            timeoutMs: config.timeoutMs,
            reasoningEffort:
              config.reasoningEffort === "provider_default"
                ? undefined
                : config.reasoningEffort,
            signal: controller.signal,
          },
          fetchImpl,
        );

        return {
          output: result.output,
          telemetry: {
            provider: "openai",
            model: config.model,
            latencyMs: Date.now() - started,
            inputTokens: result.usage.inputTokens,
            cachedInputTokens: result.usage.cachedInputTokens,
            outputTokens: result.usage.outputTokens,
          },
        };
      } catch (error) {
        if (controller.signal.aborted) {
          throw new RuntimeModelError(
            "DRAFT_MODEL_TIMEOUT",
            `Runtime model exceeded ${config.timeoutMs}ms timeout.`,
            failureTelemetry(),
          );
        }
        if (error instanceof OpenAIAgentsBridgeError) {
          if (error.kind === "timeout") {
            throw new RuntimeModelError(
              "DRAFT_MODEL_TIMEOUT",
              `Runtime model exceeded ${config.timeoutMs}ms timeout.`,
              failureTelemetry(),
            );
          }
          if (error.kind === "http") {
            throw new RuntimeModelError(
              "DRAFT_MODEL_HTTP_ERROR",
              error.status === undefined
                ? "Runtime model connection failed."
                : `Runtime model returned HTTP ${error.status}.`,
              failureTelemetry(),
            );
          }
          throw new RuntimeModelError(
            "DRAFT_MODEL_INVALID_RESPONSE",
            "Runtime model returned an invalid bounded response.",
            failureTelemetry(),
          );
        }
        throw new RuntimeModelError(
          "DRAFT_MODEL_INVALID_RESPONSE",
          "Runtime model adapter failed before producing a bounded response.",
          failureTelemetry(),
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
