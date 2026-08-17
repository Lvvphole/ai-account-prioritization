import {
  OpenAIAgentsBridgeError,
  type OpenAIAgentsBridgeRequest,
} from "@repo/openai-agents-bridge";
import { describe, expect, it, vi } from "vitest";
import {
  createOpenAIRuntimeModelClient,
  type OpenAIAgentsInvoker,
} from "./openai-runtime-model";
import {
  IMPLEMENTED_RUNTIME_MODEL_PROVIDERS,
  runtimeModelClientForProvider,
} from "./runtime-model-registry";
import { RuntimeModelError } from "./runtime-model";

const request = {
  system: "system",
  user: "user",
  outputFormat: {
    type: "json_schema" as const,
    schema: {
      type: "object",
      properties: { draft: { type: "string" } },
      required: ["draft"],
      additionalProperties: false,
    },
  },
};

const config = {
  provider: "openai" as const,
  model: "gpt-test",
  credential: "test-secret",
  timeoutMs: 5_000,
  maxOutputTokens: 600,
  reasoningEffort: "low" as const,
};

describe("OpenAI runtime model adapter", () => {
  it("maps the provider-neutral contract into the bounded Agents bridge", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const invoke = vi.fn<OpenAIAgentsInvoker>(async () => ({
      output: { draft: "ok" },
      usage: {
        inputTokens: 12,
        cachedInputTokens: 3,
        outputTokens: 4,
      },
    }));
    const client = createOpenAIRuntimeModelClient(fetchImpl, invoke);

    const result = await client.generate(request, config);

    expect(invoke).toHaveBeenCalledOnce();
    const [bridgeRequest, bridgeFetch] = invoke.mock.calls[0] as [
      OpenAIAgentsBridgeRequest,
      typeof fetch,
    ];
    expect(bridgeRequest).toMatchObject({
      credential: "test-secret",
      model: "gpt-test",
      system: "system",
      user: "user",
      outputSchema: request.outputFormat.schema,
      maxOutputTokens: 600,
      timeoutMs: 5_000,
      reasoningEffort: "low",
    });
    expect(bridgeRequest.signal).toBeInstanceOf(AbortSignal);
    expect(bridgeFetch).toBe(fetchImpl);
    expect(result.output).toEqual({ draft: "ok" });
    expect(result.telemetry).toMatchObject({
      provider: "openai",
      model: "gpt-test",
      inputTokens: 12,
      cachedInputTokens: 3,
      outputTokens: 4,
    });
  });

  it("maps provider-default reasoning to no explicit effort", async () => {
    const invoke = vi.fn<OpenAIAgentsInvoker>(async () => ({
      output: { draft: "ok" },
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const client = createOpenAIRuntimeModelClient(
      vi.fn() as unknown as typeof fetch,
      invoke,
    );

    await client.generate(request, {
      ...config,
      reasoningEffort: "provider_default",
    });

    expect(invoke.mock.calls[0]?.[0].reasoningEffort).toBeUndefined();
  });

  it("normalizes bridge failures without leaking provider error text", async () => {
    const invoke = vi.fn<OpenAIAgentsInvoker>(async () => {
      throw new OpenAIAgentsBridgeError(
        "http",
        "upstream message containing sensitive transport details",
        429,
      );
    });
    const client = createOpenAIRuntimeModelClient(
      vi.fn() as unknown as typeof fetch,
      invoke,
    );

    await expect(client.generate(request, config)).rejects.toMatchObject({
      name: "RuntimeModelError",
      code: "DRAFT_MODEL_HTTP_ERROR",
      message: "Runtime model returned HTTP 429.",
    });
  });

  it("keeps OpenAI dormant and non-admittable", () => {
    expect(IMPLEMENTED_RUNTIME_MODEL_PROVIDERS).toEqual(["anthropic"]);
    expect(() => runtimeModelClientForProvider("openai")).toThrow(
      RuntimeModelError,
    );
  });
});
