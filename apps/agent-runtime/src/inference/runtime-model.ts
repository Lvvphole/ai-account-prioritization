import type { RuntimeDraftingPolicy } from "../agents/sales-execution/execution.policy";

export interface RuntimeModelTelemetry {
  provider: "anthropic";
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface RuntimeModelResult {
  output: unknown;
  telemetry: RuntimeModelTelemetry;
}

export interface RuntimeModelRequest {
  system: string;
  user: string;
}

export interface RuntimeModelClient {
  generate(
    request: RuntimeModelRequest,
    policy: RuntimeDraftingPolicy,
  ): Promise<RuntimeModelResult>;
}

export class RuntimeModelError extends Error {
  constructor(
    public readonly code:
      | "DRAFT_MODEL_TIMEOUT"
      | "DRAFT_MODEL_HTTP_ERROR"
      | "DRAFT_MODEL_INVALID_RESPONSE"
      | "DRAFT_MODEL_CONFIG_ERROR",
    message: string,
    public readonly telemetry?: RuntimeModelTelemetry,
  ) {
    super(message);
    this.name = "RuntimeModelError";
  }
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export const anthropicRuntimeModelClient: RuntimeModelClient = {
  async generate(request, policy) {
    if (!policy.enabled || !policy.apiKey || !policy.model) {
      throw new RuntimeModelError(
        "DRAFT_MODEL_CONFIG_ERROR",
        "Runtime model called without enabled, fully configured drafting policy.",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
    const started = Date.now();
    const failureTelemetry = (
      usage?: AnthropicResponse["usage"],
    ): RuntimeModelTelemetry => ({
      provider: "anthropic",
      model: policy.model as string,
      latencyMs: Date.now() - started,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
    });

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": policy.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: policy.model,
          max_tokens: policy.maxTokens,
          temperature: 0,
          system: request.system,
          messages: [{ role: "user", content: request.user }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new RuntimeModelError(
          "DRAFT_MODEL_HTTP_ERROR",
          `Runtime model returned HTTP ${response.status}.`,
          failureTelemetry(),
        );
      }

      const body = (await response.json()) as AnthropicResponse;
      const text = body.content?.find((item) => item.type === "text")?.text;
      if (!text) {
        throw new RuntimeModelError(
          "DRAFT_MODEL_INVALID_RESPONSE",
          "Runtime model response contained no text content.",
          failureTelemetry(body.usage),
        );
      }

      let output: unknown;
      try {
        output = JSON.parse(text);
      } catch {
        throw new RuntimeModelError(
          "DRAFT_MODEL_INVALID_RESPONSE",
          "Runtime model response was not strict JSON.",
          failureTelemetry(body.usage),
        );
      }

      return {
        output,
        telemetry: failureTelemetry(body.usage),
      };
    } catch (error) {
      if (error instanceof RuntimeModelError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new RuntimeModelError(
          "DRAFT_MODEL_TIMEOUT",
          `Runtime model exceeded ${policy.timeoutMs}ms timeout.`,
          failureTelemetry(),
        );
      }
      throw new RuntimeModelError(
        "DRAFT_MODEL_HTTP_ERROR",
        error instanceof Error ? error.message : "Unknown runtime model error.",
        failureTelemetry(),
      );
    } finally {
      clearTimeout(timeout);
    }
  },
};
