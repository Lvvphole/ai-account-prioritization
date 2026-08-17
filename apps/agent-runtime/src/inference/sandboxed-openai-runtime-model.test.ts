import { describe, expect, it } from "vitest";
import { VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER } from "@repo/sandbox-runtime";
import type { SandboxFactory } from "@repo/sandbox-runtime";
import { createSandboxedOpenAIRuntimeModelClient } from "./sandboxed-openai-runtime-model";
import type {
  RuntimeModelInvocationConfig,
  RuntimeModelRequest,
} from "./runtime-model";

const request: RuntimeModelRequest = {
  system: "Return the requested JSON.",
  user: "Create the bounded draft.",
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
  provider: "openai",
  model: "gpt-test",
  credential: "runtime-openai-provider-key",
  timeoutMs: 2_000,
  maxOutputTokens: 128,
  reasoningEffort: "provider_default",
};

const accessToken = {
  teamId: "team_test",
  projectId: "project_test",
  token: "vercel-control-plane-key",
};

const relayEnvelope = (body: string): string =>
  JSON.stringify({
    status: 200,
    statusText: "OK",
    headers: [["content-type", "application/json"]],
    bodyBase64: Buffer.from(body, "utf8").toString("base64"),
  });

describe("dormant sandboxed OpenAI runtime model", () => {
  it("routes one Agents SDK Responses request through the fixed sandbox boundary", async () => {
    let createCalls = 0;
    let commandCalls = 0;
    let stopCalls = 0;
    let providerRequest = "";
    const files = new Map<string, string>();

    const createSandbox: SandboxFactory = async (contract) => {
      createCalls += 1;
      expect(contract.persistent).toBe(false);
      expect(contract.ports).toEqual([]);
      expect(contract.env).toEqual({});
      expect(contract.timeout).toBe(config.timeoutMs);
      expect(contract.accessToken).toEqual(accessToken);

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
              commandCalls += 1;
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

              const openAIResponse = JSON.stringify({
                id: "resp_test",
                usage: {
                  input_tokens: 17,
                  output_tokens: 9,
                  total_tokens: 26,
                },
                output: [
                  {
                    id: "msg_test",
                    type: "message",
                    status: "completed",
                    role: "assistant",
                    content: [
                      {
                        type: "output_text",
                        text: JSON.stringify({ draft: "hello" }),
                        annotations: [],
                      },
                    ],
                  },
                ],
              });
              files.set(responsePath, relayEnvelope(openAIResponse));
              return { exitCode: 0 };
            },
          };
        },
        async stop() {
          stopCalls += 1;
          return {};
        },
      };
    };

    const client = createSandboxedOpenAIRuntimeModelClient({
      accessToken,
      createSandbox,
    });
    const result = await client.generate(request, config);

    expect(createCalls).toBe(1);
    expect(commandCalls).toBe(1);
    expect(stopCalls).toBe(1);
    expect(result.output).toEqual({ draft: "hello" });
    expect(result.telemetry).toMatchObject({
      provider: "openai",
      model: config.model,
      inputTokens: 17,
      outputTokens: 9,
    });

    expect(providerRequest).not.toContain(config.credential);
    expect(providerRequest).not.toContain(accessToken.token);
    const envelope = JSON.parse(providerRequest) as {
      url: string;
      method: string;
      headers: [string, string][];
      bodyBase64: string | null;
    };
    expect(envelope.url).toBe("https://api.openai.com/v1/responses");
    expect(envelope.method).toBe("POST");
    expect(Object.fromEntries(envelope.headers)).toMatchObject({
      authorization: `Bearer ${VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER}`,
      "content-type": "application/json",
    });

    const requestBody = JSON.parse(
      Buffer.from(envelope.bodyBase64 ?? "", "base64").toString("utf8"),
    ) as Record<string, unknown>;
    expect(requestBody.model).toBe(config.model);
    expect(requestBody.max_output_tokens).toBe(config.maxOutputTokens);
    expect(requestBody).not.toHaveProperty("previous_response_id");
  });

  it("fails closed when sandbox creation fails", async () => {
    let createCalls = 0;
    const client = createSandboxedOpenAIRuntimeModelClient({
      accessToken,
      createSandbox: async () => {
        createCalls += 1;
        throw new Error("SIMULATED_OPENAI_SANDBOX_CREATE_FAILURE");
      },
    });

    await expect(client.generate(request, config)).rejects.toMatchObject({
      name: "RuntimeModelError",
      code: "DRAFT_MODEL_HTTP_ERROR",
    });
    expect(createCalls).toBe(1);
  });
});
