import { Sandbox } from "@vercel/sandbox";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER,
  createOpenAIVercelSandboxFetch,
} from "./vercel-sandbox-fetch";

const relayEnvelope = (body: string): string =>
  JSON.stringify({
    status: 200,
    statusText: "OK",
    headers: [["content-type", "application/json"]],
    bodyBase64: Buffer.from(body, "utf8").toString("base64"),
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenAI sandbox security mapping", () => {
  it("passes only the fixed OpenAI isolation contract to Sandbox.create", async () => {
    const credential = "runtime-openai-provider-key";
    const accessToken = {
      teamId: "team_test",
      projectId: "project_test",
      token: "vercel-control-plane-key",
    };
    const files = new Map<string, string>();
    let createOptions: Record<string, unknown> | undefined;

    vi.spyOn(Sandbox, "create").mockImplementation(async (options) => {
      createOptions = options as unknown as Record<string, unknown>;
      return {
        fs: {
          async writeFile(path: string, data: string) {
            files.set(path, data);
          },
          async readFile(path: string) {
            const value = files.get(path);
            if (value === undefined) {
              throw new Error(`Missing fake sandbox file: ${path}`);
            }
            return value;
          },
        },
        currentSession() {
          return {
            async runCommand(params: { env?: Record<string, string> }) {
              const responsePath = params.env?.SANDBOX_RESPONSE_PATH;
              if (!responsePath) {
                throw new Error("Sandbox response path missing.");
              }
              files.set(responsePath, relayEnvelope("provider-response"));
              return { exitCode: 0 };
            },
          };
        },
        async stop() {
          return {};
        },
      } as never;
    });

    const sandboxFetch = createOpenAIVercelSandboxFetch({
      credential,
      timeoutMs: 1_000,
      accessToken,
      controlPlaneFetch: async () => new Response(null, { status: 200 }),
    });
    const response = await sandboxFetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-test" }),
      },
    );

    expect(await response.text()).toBe("provider-response");
    expect(createOptions).toBeDefined();
    expect(Object.keys(createOptions ?? {}).sort()).toEqual(
      [
        "env",
        "fetch",
        "networkPolicy",
        "persistent",
        "ports",
        "projectId",
        "runtime",
        "signal",
        "teamId",
        "timeout",
        "token",
      ].sort(),
    );
    expect(createOptions?.runtime).toBe("node22");
    expect(createOptions?.persistent).toBe(false);
    expect(createOptions?.ports).toEqual([]);
    expect(createOptions?.env).toEqual({});
    expect(createOptions?.timeout).toBe(1_000);
    expect(createOptions?.teamId).toBe(accessToken.teamId);
    expect(createOptions?.projectId).toBe(accessToken.projectId);
    expect(createOptions?.token).toBe(accessToken.token);

    const policy = createOptions?.networkPolicy as {
      allow?: Record<
        string,
        Array<{
          match?: {
            method?: string[];
            path?: { exact?: string };
            headers?: Array<{
              key?: { exact?: string };
              value?: { exact?: string };
            }>;
          };
          transform?: Array<{ headers?: Record<string, string> }>;
        }>
      >;
    };
    expect(Object.keys(policy.allow ?? {})).toEqual(["api.openai.com"]);
    const rules = policy.allow?.["api.openai.com"];
    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.match?.method).toEqual(["POST"]);
    expect(rules?.[0]?.match?.path).toEqual({ exact: "/v1/responses" });
    expect(rules?.[0]?.match?.headers).toEqual([
      {
        key: { exact: "authorization" },
        value: {
          exact: `Bearer ${VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER}`,
        },
      },
    ]);
    expect(rules?.[0]?.transform).toEqual([
      { headers: { authorization: `Bearer ${credential}` } },
    ]);

    const sandboxRequest = files.get("/tmp/runtime-model-request.json");
    expect(sandboxRequest).toBeDefined();
    expect(sandboxRequest).not.toContain(credential);
    expect(sandboxRequest).not.toContain(accessToken.token);
    expect(sandboxRequest).toContain(
      `Bearer ${VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER}`,
    );
  });
});
