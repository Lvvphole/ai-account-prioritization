import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "@anthropic-ai/sdk";
import {
  RuntimeModelError,
  type RuntimeJsonSchema,
  type RuntimeModelClient,
  type RuntimeModelInvocationConfig,
  type RuntimeModelOutputFormat,
  type RuntimeModelTelemetry,
  type RuntimeReasoningEffort,
} from "./runtime-model";

const ANTHROPIC_API_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_API_VERSION = "2023-06-01";

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicOutputConfig extends Record<string, unknown> {
  format: {
    type: "json_schema";
    schema: RuntimeJsonSchema;
  };
  effort?: Exclude<RuntimeReasoningEffort, "provider_default">;
}

const isolatedAnthropicDefaultHeaders = (
  credential: string,
): Record<string, string | null> => {
  const headers: Record<string, string | null> = {};
  const configuredHeaders = process.env.ANTHROPIC_CUSTOM_HEADERS;

  if (configuredHeaders) {
    for (const line of configuredHeaders.split("\n")) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const headerName = line.slice(0, colon).trim();
      if (headerName) headers[headerName] = null;
    }
  }

  headers.accept = "application/json";
  headers.authorization = null;
  headers["anthropic-version"] = ANTHROPIC_API_VERSION;
  headers["content-type"] = "application/json";
  headers["x-api-key"] = credential;
  return headers;
};

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

/**
 * Build the exact non-secret Anthropic output configuration used on the wire.
 * The same function is used by durable audit snapshots and the provider adapter.
 */
export function buildAnthropicOutputConfig(
  outputFormat: RuntimeModelOutputFormat,
  reasoningEffort: RuntimeReasoningEffort,
): AnthropicOutputConfig {
  const outputConfig: AnthropicOutputConfig = {
    format: {
      type: "json_schema",
      schema: sanitizeAnthropicJsonSchema(outputFormat.schema),
    },
  };
  if (reasoningEffort !== "provider_default") {
    outputConfig.effort = reasoningEffort;
  }
  return outputConfig;
}

const sanitizedConnectionMessage = (error: APIConnectionError): string => {
  const cause = error.cause;
  if (cause instanceof Error && cause.name === "SandboxRuntimeError") {
    return cause.message;
  }
  return error.message;
};

export function createAnthropicRuntimeModelClient(
  fetchImpl: typeof fetch,
): RuntimeModelClient {
  return {
    async generate(request, config) {
      assertAnthropicConfig(config);
      const outputConfig = buildAnthropicOutputConfig(
        request.outputFormat,
        config.reasoningEffort,
      );
      const started = Date.now();
      const failureTelemetry = (usage?: AnthropicUsage): RuntimeModelTelemetry => ({
        provider: "anthropic",
        model: config.model,
        latencyMs: Date.now() - started,
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
      });
      const client = new Anthropic({
        apiKey: config.credential,
        authToken: null,
        baseURL: ANTHROPIC_API_BASE_URL,
        defaultHeaders: isolatedAnthropicDefaultHeaders(config.credential),
        fetch: fetchImpl,
        logLevel: "off",
        maxRetries: 0,
        timeout: config.timeoutMs,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

      try {
        const body = await client.messages.create(
          {
            model: config.model,
            max_tokens: config.maxOutputTokens,
            system: request.system,
            messages: [{ role: "user", content: request.user }],
            output_config: outputConfig,
          },
          { signal: controller.signal },
        );

        const text = body.content.find((item) => item.type === "text")?.text;
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
        if (controller.signal.aborted || error instanceof APIConnectionTimeoutError) {
          throw new RuntimeModelError(
            "DRAFT_MODEL_TIMEOUT",
            `Runtime model exceeded ${config.timeoutMs}ms timeout.`,
            failureTelemetry(),
          );
        }
        if (error instanceof APIError && error.status !== undefined) {
          throw new RuntimeModelError(
            "DRAFT_MODEL_HTTP_ERROR",
            `Runtime model returned HTTP ${error.status}.`,
            failureTelemetry(),
          );
        }
        throw new RuntimeModelError(
          "DRAFT_MODEL_HTTP_ERROR",
          error instanceof APIConnectionError
            ? sanitizedConnectionMessage(error)
            : error instanceof Error
              ? error.message
              : "Unknown runtime model error.",
          failureTelemetry(),
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
