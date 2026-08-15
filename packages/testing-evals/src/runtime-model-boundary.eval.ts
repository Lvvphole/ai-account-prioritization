import { describe, expect, it } from "vitest";
import {
  RuntimeModelError,
  createAnthropicRuntimeModelClient,
  normalizeRuntimeDraftingPolicy,
  runtimeDraftingPolicyAuditSnapshot,
  runtimeDraftingPolicyFromEnv,
  runtimeModelClientForProvider,
  runtimeModelInvocationConfigFromDraftingPolicy,
  sanitizeAnthropicJsonSchema,
  type RuntimeDraftingPolicy,
  type RuntimeJsonSchema,
  type RuntimeModelInvocationConfig,
  type RuntimeModelRequest,
} from "agent-runtime";

const basePolicy = (
  overrides: Partial<RuntimeDraftingPolicy> = {},
): RuntimeDraftingPolicy => ({
  enabled: true,
  provider: "anthropic",
  apiKey: "test-secret",
  model: "claude-sonnet-5",
  timeoutMs: 1000,
  maxTokens: 200,
  maxInputTokens: 4000,
  maxSignals: 6,
  maxConcurrent: 2,
  maxRunTokens: 20000,
  maxEvidenceAgeDays: 90,
  maxAttempts: 1,
  fallback: "template",
  reasoningEffort: "provider_default",
  outputFormat: "json_schema",
  ...overrides,
});

const request: RuntimeModelRequest = {
  system: "Return the requested object.",
  user: "Return value ok.",
  outputFormat: {
    type: "json_schema",
    schema: {
      type: "object",
      properties: {
        value: {
          type: "string",
          minLength: 1,
          maxLength: 20,
        },
      },
      required: ["value"],
      additionalProperties: false,
    },
  },
};

const anthropicConfig = (
  overrides: Partial<RuntimeModelInvocationConfig> = {},
): RuntimeModelInvocationConfig => ({
  provider: "anthropic",
  model: "claude-sonnet-5",
  credential: "test-secret",
  timeoutMs: 1000,
  maxOutputTokens: 100,
  reasoningEffort: "medium",
  ...overrides,
});

const toRequest = (input: RequestInfo | URL, init?: RequestInit): Request =>
  input instanceof Request ? input.clone() : new Request(input, init);

const requireRequest = (value: Request | undefined): Request => {
  if (!value) throw new Error("Expected the Anthropic request to be captured.");
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`Expected ${label} to be an object.`);
  return value;
};

const requestBody = async (captured: Request | undefined): Promise<Record<string, unknown>> => {
  const raw = await requireRequest(captured).text();
  const parsed: unknown = JSON.parse(raw);
  return requireRecord(parsed, "Anthropic request body");
};

const requireRuntimeModelError = (value: unknown): RuntimeModelError => {
  if (!(value instanceof RuntimeModelError)) {
    throw new Error("Expected a RuntimeModelError.");
  }
  return value;
};

const successfulAnthropicResponse = (value = "ok"): Response =>
  new Response(
    JSON.stringify({
      content: [{ type: "text", text: JSON.stringify({ value }) }],
      usage: { input_tokens: 12, output_tokens: 4 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const providerErrorResponse = (message: string): Response =>
  new Response(
    JSON.stringify({
      type: "error",
      error: { type: "api_error", message },
    }),
    { status: 500, headers: { "content-type": "application/json" } },
  );

const abortError = (): Error => {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
};

describe("P4 provider-neutral runtime-model boundary", () => {
  it("normalizes provider-neutral policy without leaking credentials into audit evidence", () => {
    const normalized = normalizeRuntimeDraftingPolicy(
      basePolicy({
        provider: "openai",
        model: "pinned-openai-model",
        reasoningEffort: "medium",
      }),
    );
    const snapshot = runtimeDraftingPolicyAuditSnapshot(normalized);
    const invocation = runtimeModelInvocationConfigFromDraftingPolicy(normalized);

    expect(snapshot.provider).toBe("openai");
    expect(snapshot.model).toBe("pinned-openai-model");
    expect(snapshot.reasoningEffort).toBe("medium");
    expect(snapshot.outputFormat).toBe("json_schema");
    expect(snapshot.canonicalOutputFormat.type).toBe("json_schema");
    expect(snapshot.effectiveProviderOutputConfiguration).toBeNull();
    expect(snapshot).not.toHaveProperty("apiKey");
    expect(JSON.stringify(snapshot)).not.toContain("test-secret");

    expect(invocation.provider).toBe("openai");
    expect(invocation.model).toBe("pinned-openai-model");
    expect(invocation.reasoningEffort).toBe("medium");
    expect(invocation.credential).toBe("test-secret");
  });

  it("records the exact admitted provider schema and output configuration before invocation", async () => {
    const policy = basePolicy({ reasoningEffort: "medium" });
    const snapshot = runtimeDraftingPolicyAuditSnapshot(policy);
    const invocation = runtimeModelInvocationConfigFromDraftingPolicy(policy);
    let capturedRequest: Request | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedRequest = toRequest(input, init);
      return successfulAnthropicResponse();
    };

    await createAnthropicRuntimeModelClient(fakeFetch).generate(
      {
        system: "system",
        user: "user",
        outputFormat: snapshot.canonicalOutputFormat,
      },
      invocation,
    );

    const body = await requestBody(capturedRequest);
    expect(snapshot.canonicalOutputFormat.schema).toEqual(expect.any(Object));
    expect(snapshot.effectiveProviderOutputConfiguration).toEqual(body.output_config);
    expect(JSON.stringify(snapshot.effectiveProviderOutputConfiguration)).not.toContain(
      "test-secret",
    );
  });

  it("fails at startup for an enabled provider without an admitted production adapter", () => {
    expect(() =>
      runtimeDraftingPolicyFromEnv({
        RUNTIME_DRAFTING_ENABLED: "true",
        RUNTIME_DRAFT_PROVIDER: "openai",
        RUNTIME_DRAFT_API_KEY: "test-secret",
        RUNTIME_DRAFT_MODEL: "pinned-openai-model",
      } as NodeJS.ProcessEnv),
    ).toThrow("has no admitted production adapter");

    expect(
      runtimeDraftingPolicyFromEnv({
        RUNTIME_DRAFTING_ENABLED: "false",
        RUNTIME_DRAFT_PROVIDER: "openai",
      } as NodeJS.ProcessEnv).provider,
    ).toBe("openai");
  });

  it("fails closed instead of silently routing an unimplemented provider", () => {
    expect(() => runtimeModelClientForProvider("openai")).toThrow(
      "has no admitted production adapter yet",
    );
    expect(() => runtimeModelClientForProvider("google")).toThrow(
      "has no admitted production adapter yet",
    );
  });

  it("preserves property names that match unsupported schema keywords", () => {
    const schema: RuntimeJsonSchema = {
      type: "object",
      properties: {
        format: { type: "string", minLength: 1 },
        pattern: { type: "string", maxLength: 20 },
        minimum: { type: "number", minimum: 1 },
      },
      required: ["format", "pattern", "minimum"],
      additionalProperties: false,
    };

    const sanitized = sanitizeAnthropicJsonSchema(schema);
    const properties = requireRecord(sanitized.properties, "sanitized properties");
    const formatProperty = requireRecord(properties.format, "format property");
    const patternProperty = requireRecord(properties.pattern, "pattern property");
    const minimumProperty = requireRecord(properties.minimum, "minimum property");

    expect(Object.keys(properties).sort()).toEqual(["format", "minimum", "pattern"]);
    expect(formatProperty.minLength).toBeUndefined();
    expect(patternProperty.maxLength).toBeUndefined();
    expect(minimumProperty.minimum).toBeUndefined();
    expect(sanitized.required).toEqual(["format", "pattern", "minimum"]);
    expect(sanitized.additionalProperties).toBe(false);
  });

  it("uses Anthropic native constrained output and effort without hard-coded temperature", async () => {
    let capturedRequest: Request | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedRequest = toRequest(input, init);
      return successfulAnthropicResponse();
    };
    const client = createAnthropicRuntimeModelClient(fakeFetch);

    const result = await client.generate(request, anthropicConfig());
    expect(result.output).toEqual({ value: "ok" });
    expect(result.telemetry).toEqual(
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet-5",
        inputTokens: 12,
        outputTokens: 4,
      }),
    );

    const outbound = requireRequest(capturedRequest);
    const body = await requestBody(outbound.clone());
    const outputConfig = requireRecord(body.output_config, "output_config");
    const format = requireRecord(outputConfig.format, "output_config.format");
    const schema = requireRecord(format.schema, "output_config.format.schema");
    const properties = requireRecord(schema.properties, "schema properties");
    const valueProperty = requireRecord(properties.value, "value property");

    expect(body.temperature).toBeUndefined();
    expect(outputConfig.effort).toBe("medium");
    expect(format.type).toBe("json_schema");
    expect(schema.additionalProperties).toBe(false);
    expect(valueProperty.minLength).toBeUndefined();
    expect(valueProperty.maxLength).toBeUndefined();
    expect(outbound.headers.get("x-api-key")).toBe("test-secret");
    expect(await outbound.text()).not.toContain("test-secret");
  });

  it("omits provider effort when the normalized intent is provider_default", async () => {
    let capturedRequest: Request | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedRequest = toRequest(input, init);
      return successfulAnthropicResponse();
    };
    const client = createAnthropicRuntimeModelClient(fakeFetch);

    await client.generate(
      request,
      anthropicConfig({ reasoningEffort: "provider_default" }),
    );

    const body = await requestBody(capturedRequest);
    const outputConfig = requireRecord(body.output_config, "output_config");
    expect(outputConfig.effort).toBeUndefined();
  });

  it("pins the Anthropic origin and ignores ambient provider credentials", async () => {
    const previousBaseUrl = process.env.ANTHROPIC_BASE_URL;
    const previousApiKey = process.env.ANTHROPIC_API_KEY;
    const previousAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_BASE_URL = "https://attacker.invalid";
    process.env.ANTHROPIC_API_KEY = "ambient-api-key";
    process.env.ANTHROPIC_AUTH_TOKEN = "ambient-auth-token";

    let capturedRequest: Request | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedRequest = toRequest(input, init);
      return successfulAnthropicResponse();
    };

    try {
      await createAnthropicRuntimeModelClient(fakeFetch).generate(request, anthropicConfig());
    } finally {
      if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = previousBaseUrl;
      if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousApiKey;
      if (previousAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = previousAuthToken;
    }

    const outbound = requireRequest(capturedRequest);
    expect(outbound.url).toBe("https://api.anthropic.com/v1/messages");
    expect(outbound.headers.get("x-api-key")).toBe("test-secret");
    expect(outbound.headers.get("authorization")).toBeNull();
  });

  it("disables SDK retries and contains provider error details", async () => {
    let networkCalls = 0;
    const fakeFetch: typeof fetch = async () => {
      networkCalls += 1;
      return providerErrorResponse("provider echoed test-secret");
    };
    const client = createAnthropicRuntimeModelClient(fakeFetch);

    let caught: unknown;
    try {
      await client.generate(request, anthropicConfig());
    } catch (error) {
      caught = error;
    }

    const runtimeError = requireRuntimeModelError(caught);
    expect(runtimeError.code).toBe("DRAFT_MODEL_HTTP_ERROR");
    expect(runtimeError.message).toBe("Runtime model returned HTTP 500.");
    expect(runtimeError.message).not.toContain("test-secret");
    expect(JSON.stringify(runtimeError.telemetry)).not.toContain("test-secret");
    expect(networkCalls).toBe(1);
  });

  it("maps the SDK timeout to the existing fail-closed timeout contract", async () => {
    let networkCalls = 0;
    const fakeFetch: typeof fetch = async (input, init) => {
      networkCalls += 1;
      const outbound = toRequest(input, init);
      return await new Promise<Response>((_resolve, reject) => {
        if (outbound.signal.aborted) {
          reject(abortError());
          return;
        }
        outbound.signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        });
      });
    };
    const client = createAnthropicRuntimeModelClient(fakeFetch);

    let caught: unknown;
    try {
      await client.generate(request, anthropicConfig({ timeoutMs: 25 }));
    } catch (error) {
      caught = error;
    }

    const runtimeError = requireRuntimeModelError(caught);
    expect(runtimeError.code).toBe("DRAFT_MODEL_TIMEOUT");
    expect(runtimeError.message).toBe("Runtime model exceeded 25ms timeout.");
    expect(networkCalls).toBe(1);
  });

  it("rejects a successful provider response with no text content", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ content: [], usage: { input_tokens: 2 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const client = createAnthropicRuntimeModelClient(fakeFetch);

    let caught: unknown;
    try {
      await client.generate(request, anthropicConfig());
    } catch (error) {
      caught = error;
    }

    expect(requireRuntimeModelError(caught).code).toBe("DRAFT_MODEL_INVALID_RESPONSE");
  });

  it("rejects a successful provider response with malformed JSON text", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "not-json" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const client = createAnthropicRuntimeModelClient(fakeFetch);

    let caught: unknown;
    try {
      await client.generate(request, anthropicConfig());
    } catch (error) {
      caught = error;
    }

    expect(requireRuntimeModelError(caught).code).toBe("DRAFT_MODEL_INVALID_RESPONSE");
  });

  it("rejects provider-mismatched Anthropic calls before network I/O", async () => {
    let networkCalls = 0;
    const fakeFetch: typeof fetch = async () => {
      networkCalls += 1;
      return new Response("{}", { status: 200 });
    };
    const client = createAnthropicRuntimeModelClient(fakeFetch);

    let caught: unknown;
    try {
      await client.generate(request, {
        provider: "openai",
        model: "pinned-openai-model",
        credential: "test-secret",
        timeoutMs: 1000,
        maxOutputTokens: 100,
        reasoningEffort: "low",
      });
    } catch (error) {
      caught = error;
    }

    expect(requireRuntimeModelError(caught).code).toBe("DRAFT_MODEL_CONFIG_ERROR");
    expect(networkCalls).toBe(0);
  });
});
