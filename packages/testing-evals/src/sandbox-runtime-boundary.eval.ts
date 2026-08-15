import { describe, expect, it } from "vitest";
import {
  createSandboxedAnthropicRuntimeModelClient,
  runtimeModelClientForProvider,
  runtimeModelExecutionProfileForProvider,
  sandboxedAnthropicRuntimeModelClient,
  type RuntimeModelInvocationConfig,
  type RuntimeModelRequest,
} from "agent-runtime";

const request: RuntimeModelRequest = {
  system: "Return the requested JSON.",
  user: "Create the draft.",
  outputFormat: {
    type: "json_schema",
    schema: {
      type: "object",
      properties: { draft: { type: "string" } },
      required: ["draft"],
      additionalProperties: false,
    },
  },
};

const config: RuntimeModelInvocationConfig = {
  provider: "anthropic",
  model: "claude-test",
  credential: "runtime-task-key",
  timeoutMs: 2_000,
  maxOutputTokens: 128,
  reasoningEffort: "provider_default",
};

describe("sandboxed production runtime model boundary", () => {
  it("resolves the production Anthropic registry entry and execution profile to the sandbox path", () => {
    expect(runtimeModelClientForProvider("anthropic")).toBe(
      sandboxedAnthropicRuntimeModelClient,
    );
    expect(runtimeModelExecutionProfileForProvider("anthropic")).toBe(
      "vercel-sandbox-anthropic-egress-v1",
    );
    expect(runtimeModelExecutionProfileForProvider("openai")).toBeNull();
  });

  it("executes the Anthropic SDK request through the sandbox transport without host fallback", async () => {
    let createCalls = 0;
    let stopCalls = 0;
    let providerRequest = "";
    let commandTimeoutMs: number | undefined;
    const files = new Map<string, string>();

    const client = createSandboxedAnthropicRuntimeModelClient({
      createSandbox: async (contract) => {
        createCalls += 1;
        expect(contract.persistent).toBe(false);
        expect(contract.ports).toEqual([]);
        expect(contract.env).toEqual({});
        expect(contract.timeout).toBe(config.timeoutMs);

        return {
          fs: {
            async writeFile(path, data) {
              files.set(path, data);
            },
            async readFile(path) {
              const value = files.get(path);
              if (value === undefined) {
                throw new Error(`Missing fake sandbox file: ${path}`);
              }
              return value;
            },
          },
          currentSession() {
            return {
              async runCommand(params) {
                commandTimeoutMs = params.timeoutMs;
                const requestPath = params.env?.SANDBOX_REQUEST_PATH;
                const responsePath = params.env?.SANDBOX_RESPONSE_PATH;
                if (!requestPath || !responsePath) {
                  throw new Error("Sandbox relay paths were not supplied.");
                }
                const requestEnvelope = files.get(requestPath);
                if (!requestEnvelope) {
                  throw new Error("Sandbox relay request was not written.");
                }
                providerRequest = requestEnvelope;

                const anthropicBody = JSON.stringify({
                  id: "msg_test",
                  type: "message",
                  role: "assistant",
                  model: config.model,
                  content: [
                    { type: "text", text: JSON.stringify({ draft: "hello" }) },
                  ],
                  stop_reason: "end_turn",
                  stop_sequence: null,
                  usage: { input_tokens: 17, output_tokens: 9 },
                });
                files.set(
                  responsePath,
                  JSON.stringify({
                    status: 200,
                    statusText: "OK",
                    headers: [["content-type", "application/json"]],
                    bodyBase64: Buffer.from(anthropicBody, "utf8").toString(
                      "base64",
                    ),
                  }),
                );
                return { exitCode: 0 };
              },
            };
          },
          async stop() {
            stopCalls += 1;
            return {};
          },
        };
      },
    });

    const result = await client.generate(request, config);

    expect(createCalls).toBe(1);
    expect(stopCalls).toBe(1);
    expect(commandTimeoutMs).toBe(config.timeoutMs);
    expect(result.output).toEqual({ draft: "hello" });
    expect(result.telemetry).toMatchObject({
      provider: "anthropic",
      model: config.model,
      inputTokens: 17,
      outputTokens: 9,
    });
    expect(providerRequest).toContain("sandbox-brokered-anthropic-key");
    expect(providerRequest).not.toContain(config.credential);
  });

  it("maps sandbox failure into the existing runtime error path without direct provider retry", async () => {
    let createCalls = 0;
    const client = createSandboxedAnthropicRuntimeModelClient({
      createSandbox: async () => {
        createCalls += 1;
        throw new Error("SIMULATED_SANDBOX_CREATE_FAILURE");
      },
    });

    await expect(client.generate(request, config)).rejects.toMatchObject({
      name: "RuntimeModelError",
      code: "DRAFT_MODEL_HTTP_ERROR",
      message: "Sandbox runtime model transport failed.",
    });
    expect(createCalls).toBe(1);
  });
});
