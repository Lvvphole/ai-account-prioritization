export const RUNTIME_MODEL_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type RuntimeModelProvider = (typeof RUNTIME_MODEL_PROVIDERS)[number];

export const RUNTIME_REASONING_EFFORTS = [
  "provider_default",
  "low",
  "medium",
  "high",
] as const;
export type RuntimeReasoningEffort = (typeof RUNTIME_REASONING_EFFORTS)[number];

export type RuntimeJsonSchema = Record<string, unknown>;

export interface RuntimeModelOutputFormat {
  type: "json_schema";
  /** Canonical task JSON Schema. Provider adapters may apply deterministic compatibility transforms. */
  schema: RuntimeJsonSchema;
}

export interface RuntimeModelRequest {
  system: string;
  user: string;
  outputFormat: RuntimeModelOutputFormat;
}

/**
 * Provider-neutral per-call configuration. `credential` is intentionally opaque
 * to the common boundary and must never be copied into audit evidence.
 * Provider adapters interpret supported controls and reject unsupported ones.
 */
export interface RuntimeModelInvocationConfig {
  provider: RuntimeModelProvider;
  model: string;
  credential: string;
  timeoutMs: number;
  maxOutputTokens: number;
  reasoningEffort: RuntimeReasoningEffort;
}

export interface RuntimeModelTelemetry {
  provider: RuntimeModelProvider;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface RuntimeModelResult {
  output: unknown;
  telemetry: RuntimeModelTelemetry;
}

/**
 * Common provider-neutral model boundary. The client returns untrusted candidate
 * data only. Deterministic schema, grounding, permission, approval, and publish
 * authority remain outside this interface.
 */
export interface RuntimeModelClient {
  generate(
    request: RuntimeModelRequest,
    config: RuntimeModelInvocationConfig,
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
