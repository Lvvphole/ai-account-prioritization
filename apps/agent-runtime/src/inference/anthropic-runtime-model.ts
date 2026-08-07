import {
  RuntimeModelError,
  type RuntimeJsonSchema,
  type RuntimeModelClient,
  type RuntimeModelInvocationAuditDescriptor,
  type RuntimeModelInvocationConfig,
  type RuntimeModelRequest,
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

const SCHEMA_MAP_KEYWORDS = new Set([
  "properties",
  "patternProperties",
  "definitions",
  "$defs",
  "dependentSchemas",
]);

const SCHEMA_DATA_KEYWORDS = new Set(["const", "default", "examples", "enum"]);

const cloneJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      cloneJsonValue(child),
    ]),
  );
};

/**
 * Anthropic constrained output supports a JSON Schema subset. Remove only
 * provider-unsupported validation keywords from schema objects. Property names
 * and literal data are preserved even when their text matches a schema keyword.
 * The canonical Zod parse still runs after generation and remains authoritative.
 */
export function sanitizeAnthropicJsonSchema(schema: RuntimeJsonSchema): RuntimeJsonSchema {
  const visitSchema = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visitSchema);
    if (value === null || typeof value !== "object") return value;

    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (ANTHROPIC_UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) continue;

      if (SCHEMA_DATA_KEYWORDS.has(key)) {
        result[key] = cloneJsonValue(child);
        continue;
      }

      if (
        SCHEMA_MAP_KEYWORDS.has(key) &&
        child !== null &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        result[key] = Object.fromEntries(
          Object.entries(child as Record<string, unknown>).map(
            ([propertyName, propertySchema]) => [propertyName, visitSchema(propertySchema)],
          ),
        );
        continue;
      }

      result[key] = visitSchema(child);
    }
    return result;
  };

  return visitSchema(schema) as RuntimeJsonSchema;
}

export function assertAnthropicConfig(
  config: RuntimeModelInvocationConfig,
): void {
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
}

function buildAnthropicOutputConfig(
  request: RuntimeModelRequest,
  config: RuntimeModelInvocationConfig,
): Record<string, unknown> {
  const outputConfig: Record<string, unknown> = {
    format: {
      type: "json_schema",
      schema: sanitizeAnthropicJsonSchema(request.outputFormat.schema),
    },
  };
  if (config.reasoningEffort !== "provider_default") {
    outputConfig.effort = config.reasoningEffort;
  }
  return outputConfig;
}

export function describeAnthropicEffectiveInvocation(
  request: RuntimeModelRequest,
  config: RuntimeModelInvocationConfig,
): RuntimeModelInvocationAuditDescriptor {
  assertAnthropicConfig(config);
  return {
    provider: "anthropic",
    model: config.model,
    outputConfiguration: buildAnthropicOutputConfig(request, config),
  };
}

export function createAnthropicRuntimeModelClient(
  fetchImpl: typeof fetch = fetch,
): RuntimeModelClient {
  return {
    describeEffectiveInvocation: describeAnthropicEffectiveInvocation,
    async generate(request, config) {
      const effectiveInvocation = describeAnthropicEffectiveInvocation(request, config);
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
            output_config: effectiveInvocation.outputConfiguration,
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
