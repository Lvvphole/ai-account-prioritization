import { describe, expect, it } from "vitest";
import {
  RuntimeModelError,
  createAnthropicRuntimeModelClient,
  normalizeRuntimeDraftingPolicy,
  runtimeDraftingPolicyAuditSnapshot,
  runtimeModelClientForProvider,
  runtimeModelInvocationConfigFromDraftingPolicy,
  type RuntimeDraftingPolicy,
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

type CapturedAnthropicBody = {
  temperature?: unknown;
  output_config?: {
    effort?: unknown;
    format?: {
      type?: unknown;
      schema?: {
        additionalProperties?: unknown;
        properties?: {
          value?: {
            minLength?: unknown;
            maxLength?: unknown;
          };
        };
      };
    };
  };
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
    expect(snapshot).not.toHaveProperty("apiKey");
    expect(JSON.stringify(snapshot)).not.toContain("test-secret");

    expect(invocation.provider).toBe("openai");
    expect(invocation.model).toBe("pinned-openai-model");
    expect(invocation.reasoningEffort).toBe("medium");
    expect(invocation.credential).toBe("test-secret");
  });

  it("fails closed instead of silently routing an unimplemented provider", () => {
    expect(() => runtimeModelClientForProvider("openai")).toThrow(
      "has no admitted production adapter yet",
    );
    expect(() => runtimeModelClientForProvider("google")).toThrow(
      "has no admitted production adapter yet",
    );
  });

  it("uses Anthropic native constrained output and effort without hard-coded temperature", async () => {
    let capturedInit: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (_input, init) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify({ value: "ok" }) }],
          usage: { input_tokens: 12, output_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const client = createAnthropicRuntimeModelClient(fakeFetch);
    const config: RuntimeModelInvocationConfig = {
      provider: "anthropic",
      model: "claude-sonnet-5",
      credential: "test-secret",
      timeoutMs: 1000,
      maxOutputTokens: 100,
      reasoningEffort: "medium",
    };

    const result = await client.generate(request, config);
    expect(result.output).toEqual({ value: "ok" });
    expect(result.telemetry).toEqual(
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet-5",
        inputTokens: 12,
        outputTokens: 4,
      }),
    );

    const body = JSON.parse(String(capturedInit?.body)) as CapturedAnthropicBody;
    expect(body.temperature).toBeUndefined();
    expect(body.output_config?.effort).toBe("medium");
    expect(body.output_config?.format?.type).toBe("json_schema");
    expect(body.output_config?.format?.schema?.additionalProperties).toBe(false);
    expect(body.output_config?.format?.schema?.properties?.value?.minLength).toBeUndefined();
    expect(body.output_config?.format?.schema?.properties?.value?.maxLength).toBeUndefined();
    expect((capturedInit?.headers as Record<string, string>)["x-api-key"]).toBe("test-secret");
  });

  it("omits provider effort when the normalized intent is provider_default", async () => {
    let capturedInit: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (_input, init) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify({ value: "ok" }) }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const client = createAnthropicRuntimeModelClient(fakeFetch);

    await client.generate(request, {
      provider: "anthropic",
      model: "claude-sonnet-5",
      credential: "test-secret",
      timeoutMs: 1000,
      maxOutputTokens: 100,
      reasoningEffort: "provider_default",
    });

    const body = JSON.parse(String(capturedInit?.body)) as CapturedAnthropicBody;
    expect(body.output_config?.effort).toBeUndefined();
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

    expect(caught).toBeInstanceOf(RuntimeModelError);
    expect((caught as RuntimeModelError).code).toBe("DRAFT_MODEL_CONFIG_ERROR");
    expect(networkCalls).toBe(0);
  });
});
