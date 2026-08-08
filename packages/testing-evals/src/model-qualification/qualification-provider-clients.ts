import {
  RuntimeModelError,
  buildAnthropicOutputConfig,
  createAnthropicRuntimeModelClient,
  type RuntimeModelClient,
  type RuntimeModelInvocationConfig,
  type RuntimeModelProvider,
  type RuntimeModelRequest,
  type RuntimeModelTelemetry,
} from "agent-runtime";
import {
  QualificationDependencyError,
  type QualificationCandidate,
  type QualificationClientResolver,
} from "./qualification-contract";

type JsonRecord = Record<string, unknown>;

interface ParsedResponse {
  text: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  modelRevisionOrFingerprint?: string;
}

const outputTextFromResponsesApi = (body: JsonRecord): string | undefined => {
  if (typeof body.output_text === "string") return body.output_text;
  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    if (item === null || typeof item !== "object") continue;
    const content = Array.isArray((item as JsonRecord).content)
      ? ((item as JsonRecord).content as unknown[])
      : [];
    for (const part of content) {
      if (
        part !== null &&
        typeof part === "object" &&
        (part as JsonRecord).type === "output_text" &&
        typeof (part as JsonRecord).text === "string"
      ) {
        return (part as JsonRecord).text as string;
      }
    }
  }
  return undefined;
};

const numberOrUndefined = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const parseResponsesApiBody = (body: JsonRecord): ParsedResponse => {
  const usage =
    body.usage !== null && typeof body.usage === "object" ? (body.usage as JsonRecord) : {};
  const inputDetails =
    usage.input_tokens_details !== null && typeof usage.input_tokens_details === "object"
      ? (usage.input_tokens_details as JsonRecord)
      : {};
  const text = outputTextFromResponsesApi(body);
  if (!text) throw new Error("Provider response contained no output text.");
  return {
    text,
    inputTokens: numberOrUndefined(usage.input_tokens),
    cachedInputTokens: numberOrUndefined(inputDetails.cached_tokens),
    outputTokens: numberOrUndefined(usage.output_tokens),
    modelRevisionOrFingerprint: stringOrUndefined(body.system_fingerprint),
  };
};

const parseGoogleBody = (body: JsonRecord): ParsedResponse => {
  const steps = Array.isArray(body.steps) ? body.steps : [];
  let text: string | undefined;
  for (const step of steps) {
    if (step === null || typeof step !== "object" || (step as JsonRecord).type !== "model_output") {
      continue;
    }
    const content = Array.isArray((step as JsonRecord).content)
      ? ((step as JsonRecord).content as unknown[])
      : [];
    for (const part of content) {
      if (
        part !== null &&
        typeof part === "object" &&
        (part as JsonRecord).type === "text" &&
        typeof (part as JsonRecord).text === "string"
      ) {
        text = (part as JsonRecord).text as string;
        break;
      }
    }
    if (text) break;
  }
  if (!text) throw new Error("Gemini interaction contained no model text step.");
  const usage =
    body.usage !== null && typeof body.usage === "object" ? (body.usage as JsonRecord) : {};
  return {
    text,
    inputTokens: numberOrUndefined(usage.total_input_tokens),
    cachedInputTokens: numberOrUndefined(usage.total_cached_tokens),
    outputTokens: numberOrUndefined(usage.total_output_tokens),
    modelRevisionOrFingerprint:
      stringOrUndefined(body.model_version) ?? stringOrUndefined(body.model),
  };
};

const responsesOutputFormat = (request: RuntimeModelRequest): JsonRecord => ({
  type: "json_schema",
  name: "generated_draft",
  schema: request.outputFormat.schema,
  strict: true,
});

export function effectiveQualificationProviderConfiguration(
  provider: RuntimeModelProvider,
  request: RuntimeModelRequest,
  config: RuntimeModelInvocationConfig,
): JsonRecord {
  switch (provider) {
    case "anthropic":
      return {
        max_tokens: config.maxOutputTokens,
        output_config: buildAnthropicOutputConfig(request.outputFormat, config.reasoningEffort),
      };
    case "openai":
    case "xai":
      return {
        max_output_tokens: config.maxOutputTokens,
        text: { format: responsesOutputFormat(request) },
        ...(config.reasoningEffort === "provider_default"
          ? {}
          : { reasoning: { effort: config.reasoningEffort } }),
      };
    case "google":
      return {
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: request.outputFormat.schema,
        },
        generation_config: {
          max_output_tokens: config.maxOutputTokens,
          ...(config.reasoningEffort === "provider_default"
            ? {}
            : { thinking_level: config.reasoningEffort }),
        },
      };
  }
}

const createHttpQualificationClient = (
  provider: "openai" | "xai" | "google",
  fetchImpl: typeof fetch,
): RuntimeModelClient => ({
  async generate(request, config) {
    if (config.provider !== provider || !config.model.trim() || !config.credential) {
      throw new RuntimeModelError(
        "DRAFT_MODEL_CONFIG_ERROR",
        `Offline ${provider} qualification requires a matching provider, credential, and model identity.`,
      );
    }

    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const telemetry = (parsed?: ParsedResponse): RuntimeModelTelemetry => ({
      provider,
      model: config.model,
      latencyMs: Date.now() - started,
      inputTokens: parsed?.inputTokens,
      cachedInputTokens: parsed?.cachedInputTokens,
      outputTokens: parsed?.outputTokens,
      modelRevisionOrFingerprint: parsed?.modelRevisionOrFingerprint,
    });

    try {
      const effective = effectiveQualificationProviderConfiguration(provider, request, config);
      let url: string;
      let headers: Record<string, string>;
      let body: JsonRecord;

      if (provider === "openai") {
        url = "https://api.openai.com/v1/responses";
        headers = {
          "content-type": "application/json",
          authorization: `Bearer ${config.credential}`,
        };
        body = {
          model: config.model,
          instructions: request.system,
          input: request.user,
          ...effective,
        };
      } else if (provider === "xai") {
        url = "https://api.x.ai/v1/responses";
        headers = {
          "content-type": "application/json",
          authorization: `Bearer ${config.credential}`,
        };
        body = {
          model: config.model,
          input: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          ...effective,
        };
      } else {
        url = "https://generativelanguage.googleapis.com/v1/interactions";
        headers = {
          "content-type": "application/json",
          "x-goog-api-key": config.credential,
        };
        body = {
          model: config.model,
          input: request.user,
          system_instruction: request.system,
          store: false,
          ...effective,
        };
      }

      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new RuntimeModelError(
          "DRAFT_MODEL_HTTP_ERROR",
          `Offline ${provider} qualification returned HTTP ${response.status}.`,
          telemetry(),
        );
      }

      const raw = (await response.json()) as JsonRecord;
      let parsed: ParsedResponse;
      try {
        parsed = provider === "google" ? parseGoogleBody(raw) : parseResponsesApiBody(raw);
      } catch (error) {
        throw new RuntimeModelError(
          "DRAFT_MODEL_INVALID_RESPONSE",
          error instanceof Error ? error.message : "Provider response was invalid.",
          telemetry(),
        );
      }

      let output: unknown;
      try {
        output = JSON.parse(parsed.text);
      } catch {
        throw new RuntimeModelError(
          "DRAFT_MODEL_INVALID_RESPONSE",
          `Offline ${provider} qualification response was not strict JSON.`,
          telemetry(parsed),
        );
      }
      return { output, telemetry: telemetry(parsed) };
    } catch (error) {
      if (error instanceof RuntimeModelError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new RuntimeModelError(
          "DRAFT_MODEL_TIMEOUT",
          `Offline ${provider} qualification exceeded ${config.timeoutMs}ms.`,
          telemetry(),
        );
      }
      throw new RuntimeModelError(
        "DRAFT_MODEL_HTTP_ERROR",
        error instanceof Error ? error.message : "Unknown offline provider error.",
        telemetry(),
      );
    } finally {
      clearTimeout(timeout);
    }
  },
});

export function createOfflineQualificationModelClient(
  provider: RuntimeModelProvider,
  fetchImpl: typeof fetch = fetch,
): RuntimeModelClient {
  switch (provider) {
    case "anthropic":
      return createAnthropicRuntimeModelClient(fetchImpl);
    case "openai":
    case "xai":
    case "google":
      return createHttpQualificationClient(provider, fetchImpl);
  }
}

export function createNetworkQualificationResolver(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): QualificationClientResolver {
  return (candidate: QualificationCandidate) => {
    const credential = env[candidate.credentialEnv];
    if (!credential) {
      throw new QualificationDependencyError(
        "MISSING_CREDENTIAL",
        `Qualification credential ${candidate.credentialEnv} is not available for ${candidate.id}.`,
      );
    }
    const client = createOfflineQualificationModelClient(candidate.provider, fetchImpl);
    return {
      credential,
      client,
      effectiveProviderConfiguration: (request, config) =>
        effectiveQualificationProviderConfiguration(candidate.provider, request, config),
    };
  };
}
