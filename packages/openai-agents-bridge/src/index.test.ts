import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentConfig: undefined as Record<string, unknown> | undefined,
  clientInstance: undefined as object | undefined,
  clientOptions: undefined as Record<string, unknown> | undefined,
  providerOptions: undefined as Record<string, unknown> | undefined,
  runnerConfig: undefined as Record<string, unknown> | undefined,
  runArgs: undefined as unknown[] | undefined,
  runResult: undefined as unknown,
}));

vi.mock("openai", () => {
  class APIConnectionError extends Error {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  class APIError extends Error {
    status?: number;
  }
  class MockOpenAI {
    static APIConnectionError = APIConnectionError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    static APIError = APIError;

    constructor(options: Record<string, unknown>) {
      mocks.clientOptions = options;
      mocks.clientInstance = this;
    }
  }
  return { default: MockOpenAI };
});

vi.mock("@openai/agents", () => ({
  Agent: class {
    constructor(config: Record<string, unknown>) {
      mocks.agentConfig = config;
    }
  },
  OpenAIProvider: class {
    constructor(options: Record<string, unknown>) {
      mocks.providerOptions = options;
    }
  },
  Runner: class {
    constructor(config: Record<string, unknown>) {
      mocks.runnerConfig = config;
    }

    run(...args: unknown[]) {
      mocks.runArgs = args;
      return mocks.runResult;
    }
  },
}));

import { runOpenAIAgentsBridge } from "./index";

beforeEach(() => {
  mocks.agentConfig = undefined;
  mocks.clientInstance = undefined;
  mocks.clientOptions = undefined;
  mocks.providerOptions = undefined;
  mocks.runnerConfig = undefined;
  mocks.runArgs = undefined;
  mocks.runResult = Promise.resolve({
    finalOutput: { draft: "ok" },
    state: {
      usage: {
        requests: 1,
        inputTokens: 12,
        inputTokensDetails: [{ cached_tokens: 3 }],
        outputTokens: 4,
      },
    },
  });
});

describe("OpenAI Agents bridge", () => {
  it("uses one traced-disabled Responses turn with strict JSON output", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const controller = new AbortController();
    const schema = {
      type: "object",
      properties: { draft: { type: "string" } },
      required: ["draft"],
      additionalProperties: false,
    };

    const result = await runOpenAIAgentsBridge(
      {
        credential: "test-secret",
        model: "gpt-test",
        system: "system",
        user: "user",
        outputSchema: schema,
        maxOutputTokens: 600,
        timeoutMs: 5_000,
        reasoningEffort: "low",
        signal: controller.signal,
      },
      fetchImpl,
    );

    expect(mocks.clientOptions).toMatchObject({
      apiKey: "test-secret",
      fetch: fetchImpl,
      maxRetries: 0,
      timeout: 5_000,
    });
    expect(mocks.providerOptions).toMatchObject({
      openAIClient: mocks.clientInstance,
      useResponses: true,
    });
    expect(mocks.runnerConfig).toEqual({
      modelProvider: expect.anything(),
      tracingDisabled: true,
    });
    expect(mocks.agentConfig).toMatchObject({
      name: "bounded-runtime-drafting",
      instructions: "system",
      model: "gpt-test",
      tools: [],
      modelSettings: {
        maxTokens: 600,
        reasoning: { effort: "low" },
      },
      outputType: {
        type: "json_schema",
        name: "generated_draft",
        strict: true,
        schema,
      },
    });
    expect(mocks.agentConfig).not.toHaveProperty("handoffs");
    expect(mocks.agentConfig).not.toHaveProperty("mcpServers");
    expect(mocks.runArgs).toEqual([
      expect.anything(),
      "user",
      { maxTurns: 1, signal: controller.signal },
    ]);
    expect(result).toEqual({
      output: { draft: "ok" },
      usage: {
        inputTokens: 12,
        cachedInputTokens: 3,
        outputTokens: 4,
      },
    });
  });

  it("omits reasoning effort for provider-default configuration", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await runOpenAIAgentsBridge(
      {
        credential: "test-secret",
        model: "gpt-test",
        system: "system",
        user: "user",
        outputSchema: { type: "object", additionalProperties: false },
        maxOutputTokens: 100,
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      },
      fetchImpl,
    );

    expect(mocks.agentConfig).toMatchObject({
      modelSettings: {
        maxTokens: 100,
        reasoning: undefined,
      },
    });
  });
});
