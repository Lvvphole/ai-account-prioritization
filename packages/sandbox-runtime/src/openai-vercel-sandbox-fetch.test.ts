import { describe, expect, it } from "vitest";
import {
  VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER,
  VERCEL_SANDBOX_OPENAI_RUNTIME_PROFILE,
  createOpenAIVercelSandboxFetch,
  type SandboxCreateContract,
  type SandboxFactory,
} from "./vercel-sandbox-fetch";

const relayEnvelope = (body: string): string =>
  JSON.stringify({
    status: 200,
    statusText: "OK",
    headers: [["content-type", "application/json"]],
    bodyBase64: Buffer.from(body, "utf8").toString("base64"),
  });

const openAIRequest = (method = "POST") => ({
  url: "https://api.openai.com/v1/responses",
  init: {
    method,
    headers: {
      authorization: `Bearer ${VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "gpt-test", input: "bounded" }),
  } satisfies RequestInit,
});

describe("OpenAI Vercel Sandbox fetch", () => {
  it("uses the closed OpenAI egress profile without placing the real key in the VM", async () => {
    const credential = "runtime-openai-provider-key";
    const accessToken = {
      teamId: "team_test",
      projectId: "project_test",
      token: "vercel-control-plane-key",
    };
    const files = new Map<string, string>();
    let contract: SandboxCreateContract | undefined;
    let relaySource = "";
    let stopCalls = 0;

    const createSandbox: SandboxFactory = async (value) => {
      contract = value;
      return {
        fs: {
          async writeFile(path, data) {
            files.set(path, data);
          },
          async readFile(path) {
            const content = files.get(path);
            if (content === undefined) {
              throw new Error(`Missing fake sandbox file: ${path}`);
            }
            return content;
          },
        },
        currentSession() {
          return {
            async runCommand(params) {
              relaySource = params.args?.[2] ?? "";
              const responsePath = params.env?.SANDBOX_RESPONSE_PATH;
              if (!responsePath) {
                throw new Error("Sandbox response path missing.");
              }
              files.set(responsePath, relayEnvelope('{"ok":true}'));
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

    const sandboxFetch = createOpenAIVercelSandboxFetch({
      credential,
      timeoutMs: 1_000,
      accessToken,
      createSandbox,
    });
    const request = openAIRequest();
    request.init.headers["x-api-key"] = "ambient-non-openai-key";
    const response = await sandboxFetch(request.url, request.init);

    expect(await response.json()).toEqual({ ok: true });
    expect(stopCalls).toBe(1);
    expect(contract).toBeDefined();
    expect(contract?.runtime).toBe("node22");
    expect(contract?.persistent).toBe(false);
    expect(contract?.ports).toEqual([]);
    expect(contract?.env).toEqual({});
    expect(contract?.accessToken).toEqual(accessToken);
    expect(contract?.networkPolicy).toEqual({
      allow: {
        "api.openai.com": [
          {
            match: {
              method: ["POST"],
              path: { exact: "/v1/responses" },
              headers: [
                {
                  key: { exact: "authorization" },
                  value: {
                    exact: `Bearer ${VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER}`,
                  },
                },
              ],
            },
            transform: [
              { headers: { authorization: `Bearer ${credential}` } },
            ],
          },
        ],
      },
    });

    const requestContent = files.get("/tmp/runtime-model-request.json");
    expect(requestContent).toBeDefined();
    expect(requestContent).not.toContain(credential);
    expect(requestContent).not.toContain(accessToken.token);
    const relayRequest = JSON.parse(requestContent ?? "{}") as {
      url?: string;
      method?: string;
      headers?: [string, string][];
    };
    expect(relayRequest.url).toBe("https://api.openai.com/v1/responses");
    expect(relayRequest.method).toBe("POST");
    expect(Object.fromEntries(relayRequest.headers ?? [])).toMatchObject({
      authorization: `Bearer ${VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER}`,
      "content-type": "application/json",
    });
    expect(Object.fromEntries(relayRequest.headers ?? [])).not.toHaveProperty(
      "x-api-key",
    );
    expect(relaySource).toContain('redirect: "error"');
    expect(VERCEL_SANDBOX_OPENAI_RUNTIME_PROFILE).toEqual({
      id: "vercel-sandbox-openai-egress-v1",
      runtime: "node22",
      persistent: false,
      destination: "api.openai.com",
      method: "POST",
      path: "/v1/responses",
    });
  });

  it.each([
    ["wrong host", "https://example.com/v1/responses", "POST"],
    ["wrong path", "https://api.openai.com/v1/chat/completions", "POST"],
    ["query", "https://api.openai.com/v1/responses?route=other", "POST"],
    ["hash", "https://api.openai.com/v1/responses#other", "POST"],
    ["wrong method", "https://api.openai.com/v1/responses", "GET"],
  ])("rejects %s before sandbox creation", async (_label, url, method) => {
    let createCalls = 0;
    const sandboxFetch = createOpenAIVercelSandboxFetch({
      credential: "runtime-openai-provider-key",
      timeoutMs: 1_000,
      createSandbox: async () => {
        createCalls += 1;
        throw new Error("Sandbox creation must not run.");
      },
    });

    await expect(
      sandboxFetch(url, {
        method,
        headers: {
          authorization: `Bearer ${VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER}`,
        },
      }),
    ).rejects.toThrow(
      "Sandbox runtime rejected an unauthorized provider request.",
    );
    expect(createCalls).toBe(0);
  });

  it("rejects a non-placeholder OpenAI credential before sandbox creation", async () => {
    let createCalls = 0;
    const sandboxFetch = createOpenAIVercelSandboxFetch({
      credential: "runtime-openai-provider-key",
      timeoutMs: 1_000,
      createSandbox: async () => {
        createCalls += 1;
        throw new Error("Sandbox creation must not run.");
      },
    });

    await expect(
      sandboxFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: "Bearer runtime-openai-provider-key",
        },
      }),
    ).rejects.toThrow(
      "Sandbox runtime rejected an unexpected provider credential.",
    );
    expect(createCalls).toBe(0);
  });

  it("bounds OpenAI command execution and cleans up after timeout", async () => {
    let stopCalls = 0;
    const createSandbox: SandboxFactory = async () => ({
      fs: {
        async writeFile() {},
        async readFile() {
          throw new Error("Response read must not run after timeout.");
        },
      },
      currentSession() {
        return {
          async runCommand(params) {
            const signal = params.signal;
            if (!signal) throw new Error("Operation signal is required.");
            await new Promise<never>((_resolve, reject) => {
              if (signal.aborted) {
                reject(new Error("Operation aborted."));
                return;
              }
              signal.addEventListener(
                "abort",
                () => reject(new Error("Operation aborted.")),
                { once: true },
              );
            });
            return { exitCode: 0 };
          },
        };
      },
      async stop() {
        stopCalls += 1;
        return {};
      },
    });
    const sandboxFetch = createOpenAIVercelSandboxFetch({
      credential: "runtime-openai-provider-key",
      timeoutMs: 40,
      createSandbox,
    });
    const request = openAIRequest();

    await expect(sandboxFetch(request.url, request.init)).rejects.toMatchObject({
      name: "SandboxRuntimeTimeoutError",
      message: "Sandbox runtime model transport timed out.",
    });
    expect(stopCalls).toBe(1);
  });

  it("bounds cleanup after a successful OpenAI relay", async () => {
    const files = new Map<string, string>();
    let cleanupSignal: AbortSignal | undefined;
    const createSandbox: SandboxFactory = async () => ({
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
            const responsePath = params.env?.SANDBOX_RESPONSE_PATH;
            if (!responsePath) {
              throw new Error("Sandbox response path missing.");
            }
            files.set(responsePath, relayEnvelope('{"ok":true}'));
            return { exitCode: 0 };
          },
        };
      },
      async stop(options) {
        cleanupSignal = options?.signal;
        const signal = cleanupSignal;
        if (!signal) throw new Error("Cleanup signal is required.");
        await new Promise<never>((_resolve, reject) => {
          if (signal.aborted) {
            reject(new Error("Cleanup aborted."));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new Error("Cleanup aborted.")),
            { once: true },
          );
        });
        return {};
      },
    });
    const sandboxFetch = createOpenAIVercelSandboxFetch({
      credential: "runtime-openai-provider-key",
      timeoutMs: 80,
      createSandbox,
    });
    const request = openAIRequest();

    await expect(sandboxFetch(request.url, request.init)).rejects.toThrow(
      "Sandbox runtime cleanup failed.",
    );
    expect(cleanupSignal?.aborted).toBe(true);
  });
});
