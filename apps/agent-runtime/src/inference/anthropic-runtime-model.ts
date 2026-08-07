import {
  RuntimeModelError,
  type RuntimeJsonSchema,
  type RuntimeModelClient,
  type RuntimeModelInvocationConfig,
  type RuntimeModelTelemetry,
} from "./runtime-model";

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const ANTHROPIC_UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "pattern",
  "format",
]);

/**
 * Anthropic constrained output supports a JSON Schema subset. Remove only
 * provider-unsupported validation keywords. The canonical Zod parse still runs
 * after generation and remains the authoritative schema gate.
 */
export function sanitizeAnthropicJsonSchema(schema: RuntimeJsonSchema): RuntimeJsonSchema {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !ANTHROPIC_UNSUPPORTED_SCHEMA_KEYWORDS.has(key))
        .map(([key, child]) => [key, visit(child)]),
    );
  };

  return visit(schema) as RuntimeJsonSchema;
}

export function createAnthropicRuntimeModelClient(
  fetchImpl: typeof fetch = fetch,
): RuntimeModelClient {
  return {
    async generate(request, config) {
      if (
        config.provider !== "anthropic" ||
        !config.credential ||
        !config.model.trim()
      ) {
        throw new RuntimeModelError(
          "DRAFT_MODEL_CONFIG_ERROR",
          "Anthropic runtime adapter requires provider=anthropic, a credential, and a model identity.",
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      const started = Date.now();
      const failureTelemetry = (
        usage?: AnthropicResponse["usage"],
      ): RuntimeModelTelemetry => ({
        provider: "anthropic",
        model: config.model,
        latencyMs: Date.now() - started,
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
      });

      const outputConfig: Record<string, unknown> = {
        format: {
          type: "json_schema",
          schema: sanitizeAnthropicJsonSchema(request.outputFormat.schema),
        },
      };
      if (config.reasoningEffort !== "provider_default") {
        outputConfig.effort = config.reasoningEffort;
      }

      try {
        const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": config.credential,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: config.maxOutputTokens,
            system: request.system,
            messages: [{ role: "user", content: request.user }],
            output_config: outputConfig,
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
            `Runtime model exceeded ${config.timeoutMs}ms timeout.`,
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
}

export const anthropicRuntimeModelClient = createAnthropicRuntimeModelClient();

/** Verify the adapter refuses a provider-mismatched config before network I/O. */
export function assertAnthropicConfig(
  config: RuntimeModelInvocationConfig,
): void {
  if (config.provider !== "anthropic") {
    throw new RuntimeModelError(
      "DRAFT_MODEL_CONFIG_ERROR",
      `Anthropic adapter cannot execute provider ${config.provider}.`,
    );
  }
}
