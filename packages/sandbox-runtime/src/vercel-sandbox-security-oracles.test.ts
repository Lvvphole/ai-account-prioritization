import { Sandbox } from "@vercel/sandbox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVercelSandboxFetch, type SandboxFactory } from "./vercel-sandbox-fetch";

const relayEnvelope = (body: string): string =>
  JSON.stringify({
    status: 200,
    statusText: "OK",
    headers: [["content-type", "application/json"]],
    bodyBase64: Buffer.from(body, "utf8").toString("base64"),
  });

const providerRequest = (credential: string) => ({
  url: "https://api.anthropic.com/v1/messages",
  init: {
    method: "POST",
    headers: { "x-api-key": credential, "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-test" }),
  } satisfies RequestInit,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PR2 final sandbox security mapping", () => {
  it("passes the restrictive isolation contract into the real Sandbox.create boundary", async () => {
    const credential = "real-provider-secret";
    const accessToken = {
      teamId: "team_test",
      projectId: "project_test",
      token: "vercel-control-plane-secret",
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
            if (value === undefined) throw new Error(`Missing fake sandbox file: ${path}`);
            return value;
          },
        },
        currentSession() {
          return {
            async runCommand(params: { env?: Record<string, string> }) {
              const responsePath = params.env?.SANDBOX_RESPONSE_PATH;
              if (!responsePath) throw new Error("Sandbox response path missing.");
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

    const sandboxFetch = createVercelSandboxFetch({
      credential,
      timeoutMs: 1_000,
      accessToken,
      controlPlaneFetch: async () => new Response(null, { status: 200 }),
    });
    const request = providerRequest(credential);
    const response = await sandboxFetch(request.url, request.init);

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
            headers?: Array<{ key?: { exact?: string }; value?: { exact?: string } }>;
          };
          transform?: Array<{ headers?: Record<string, string> }>;
        }>
      >;
    };
    expect(Object.keys(policy.allow ?? {})).toEqual(["api.anthropic.com"]);
    const rules = policy.allow?.["api.anthropic.com"];
    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.match?.method).toEqual(["POST"]);
    expect(rules?.[0]?.match?.path).toEqual({ exact: "/v1/messages" });
    expect(rules?.[0]?.match?.headers).toEqual([
      {
        key: { exact: "x-api-key" },
        value: { exact: "sandbox-brokered-anthropic-key" },
      },
    ]);
    expect(rules?.[0]?.transform).toEqual([{ headers: { "x-api-key": credential } }]);
  });

  it("aborts a stalled cleanup inside the reserved cleanup window and total deadline", async () => {
    const credential = "expected-key";
    const timeoutMs = 1_000;
    const files = new Map<string, string>();
    let cleanupSignal: AbortSignal | undefined;

    const createSandbox: SandboxFactory = async () => ({
      fs: {
        async writeFile(path, data) {
          files.set(path, data);
        },
        async readFile(path) {
          const value = files.get(path);
          if (value === undefined) throw new Error(`Missing fake sandbox file: ${path}`);
          return value;
        },
      },
      currentSession() {
        return {
          async runCommand(params) {
            const responsePath = params.env?.SANDBOX_RESPONSE_PATH;
            if (!responsePath) throw new Error("Sandbox response path missing.");
            files.set(responsePath, relayEnvelope("provider-response"));
            return { exitCode: 0 };
          },
        };
      },
      async stop(options) {
        cleanupSignal = options?.signal;
        const signal = cleanupSignal;
        if (!signal) throw new Error("Cleanup signal required.");
        await new Promise<never>((_resolve, reject) => {
          if (signal.aborted) {
            reject(new Error("cleanup aborted"));
            return;
          }
          signal.addEventListener("abort", () => reject(new Error("cleanup aborted")), {
            once: true,
          });
        });
        return {};
      },
    });

    const sandboxFetch = createVercelSandboxFetch({
      credential,
      timeoutMs,
      createSandbox,
    });
    const request = providerRequest(credential);
    const startedAt = performance.now();

    await expect(sandboxFetch(request.url, request.init)).rejects.toThrow(
      "Sandbox runtime cleanup failed.",
    );
    const elapsedMs = performance.now() - startedAt;

    expect(cleanupSignal?.aborted).toBe(true);
    // The implementation reserves at most 250ms for cleanup. Leave generous
    // scheduler headroom while still killing a mutation that grants cleanup the
    // full 1000ms runtime timeout.
    expect(elapsedMs).toBeGreaterThanOrEqual(150);
    expect(elapsedMs).toBeLessThan(700);
  }, 2_000);
});
