import { Sandbox } from "@vercel/sandbox";
import { describe, expect, it } from "vitest";
import {
  assertVercelSandboxAuthentication,
  createVercelSandboxFetch,
  singleAttemptControlPlaneFetch,
  vercelSandboxAccessTokenFromEnv,
  type SandboxCreateContract,
  type SandboxFactory,
} from "./vercel-sandbox-fetch";

interface CommandCapture {
  cmd: string;
  args?: string[];
  env?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface FakeSandboxState {
  createContracts: SandboxCreateContract[];
  writes: Map<string, string>;
  writeSignals: (AbortSignal | undefined)[];
  readSignals: (AbortSignal | undefined)[];
  command?: CommandCapture;
  stopSignals: (AbortSignal | undefined)[];
}

const relayEnvelope = (body: string): string =>
  JSON.stringify({
    status: 200,
    statusText: "OK",
    headers: [["content-type", "application/json"]],
    bodyBase64: Buffer.from(body, "utf8").toString("base64"),
  });

function fakeSandboxFactory(options?: {
  responseEnvelope?: string;
  exitCode?: number;
  stopFails?: boolean;
  onRunCommand?: () => void;
}): { state: FakeSandboxState; factory: SandboxFactory } {
  const state: FakeSandboxState = {
    createContracts: [],
    writes: new Map(),
    writeSignals: [],
    readSignals: [],
    stopSignals: [],
  };

  const factory: SandboxFactory = async (contract) => {
    state.createContracts.push(contract);
    return {
      fs: {
        async writeFile(path, data, writeOptions) {
          state.writes.set(path, data);
          state.writeSignals.push(writeOptions?.signal);
        },
        async readFile(path, readOptions) {
          state.readSignals.push(readOptions.signal);
          const value = state.writes.get(path);
          if (value === undefined) {
            throw new Error(`Missing fake sandbox file: ${path}`);
          }
          return value;
        },
      },
      currentSession() {
        return {
          async runCommand(params) {
            state.command = params;
            options?.onRunCommand?.();
            const responsePath = params.env?.SANDBOX_RESPONSE_PATH;
            if (!responsePath) {
              throw new Error("Fake sandbox response path missing.");
            }
            state.writes.set(
              responsePath,
              options?.responseEnvelope ?? relayEnvelope("provider-response"),
            );
            return { exitCode: options?.exitCode ?? 0 };
          },
        };
      },
      async stop(stopOptions) {
        state.stopSignals.push(stopOptions?.signal);
        if (options?.stopFails) throw new Error("FAKE_STOP_FAILED");
        return {};
      },
    };
  };

  return { state, factory };
}

function networkAllowMap(contract: SandboxCreateContract) {
  if (typeof contract.networkPolicy === "string") {
    throw new Error("Expected a restrictive object network policy.");
  }
  const allow = contract.networkPolicy.allow;
  if (!allow || Array.isArray(allow)) {
    throw new Error("Expected a rule-based network allowlist.");
  }
  return allow;
}

describe("Vercel sandbox control-plane authentication", () => {
  it("uses Vercel OIDC without constructing an explicit access token", () => {
    expect(
      vercelSandboxAccessTokenFromEnv({ VERCEL_OIDC_TOKEN: "oidc-token" }),
    ).toBeUndefined();
    expect(() =>
      assertVercelSandboxAuthentication({ VERCEL_OIDC_TOKEN: "oidc-token" }),
    ).not.toThrow();
  });

  it("maps one complete explicit Vercel access-token tuple", () => {
    const env = {
      VERCEL_TEAM_ID: "team_test",
      VERCEL_PROJECT_ID: "project_test",
      VERCEL_TOKEN: "vercel-token",
    };

    expect(vercelSandboxAccessTokenFromEnv(env)).toEqual({
      teamId: "team_test",
      projectId: "project_test",
      token: "vercel-token",
    });
    expect(() => assertVercelSandboxAuthentication(env)).not.toThrow();
  });

  it("rejects partial explicit Vercel authentication", () => {
    expect(() =>
      vercelSandboxAccessTokenFromEnv({
        VERCEL_TEAM_ID: "team_test",
        VERCEL_TOKEN: "vercel-token",
      }),
    ).toThrow("control-plane authentication is incomplete");
  });

  it("rejects missing Vercel authentication", () => {
    expect(() => assertVercelSandboxAuthentication({})).toThrow(
      "control-plane authentication is required",
    );
  });
});

describe("Vercel sandbox runtime transport", () => {
  it("uses one ephemeral sandbox with exact Anthropic egress and no provider credential in the VM", async () => {
    const credential = "anthropic-production-secret";
    const accessToken = {
      teamId: "team_test",
      projectId: "project_test",
      token: "vercel-control-plane-secret",
    };
    const controller = new AbortController();
    let controlPlaneCalls = 0;
    const controlPlaneFetch: typeof fetch = async () => {
      controlPlaneCalls += 1;
      return new Response(null, { status: 500 });
    };
    const { state, factory } = fakeSandboxFactory();
    const sandboxFetch = createVercelSandboxFetch({
      credential,
      timeoutMs: 1_500,
      accessToken,
      createSandbox: factory,
      controlPlaneFetch,
    });

    const response = await sandboxFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        authorization: "Bearer ambient-token",
        "content-type": "application/json",
        "x-api-key": credential,
      },
      body: JSON.stringify({ model: "claude-test" }),
      signal: controller.signal,
    });

    expect(await response.text()).toBe("provider-response");
    expect(state.createContracts).toHaveLength(1);
    const contract = state.createContracts[0];
    if (!contract) throw new Error("Sandbox create contract was not captured.");

    expect(Object.keys(contract).sort()).toEqual(
      [
        "accessToken",
        "env",
        "fetch",
        "networkPolicy",
        "persistent",
        "ports",
        "runtime",
        "signal",
        "timeout",
      ].sort(),
    );
    expect(contract.runtime).toBe("node22");
    expect(contract.persistent).toBe(false);
    expect(contract.ports).toEqual([]);
    expect(contract.timeout).toBe(1_500);
    expect(contract.env).toEqual({});
    expect(contract.accessToken).toEqual(accessToken);
    expect(contract.signal).toBeDefined();
    expect(contract.signal).not.toBe(controller.signal);
    expect(contract.signal?.aborted).toBe(false);

    const allow = networkAllowMap(contract);
    expect(Object.keys(allow)).toEqual(["api.anthropic.com"]);
    const rules = allow["api.anthropic.com"];
    if (!rules || rules.length !== 1) {
      throw new Error("Expected one Anthropic egress rule.");
    }
    const rule = rules[0];
    if (!rule) throw new Error("Anthropic egress rule missing.");
    expect(rule.match?.method).toEqual(["POST"]);
    expect(rule.match?.path).toEqual({ exact: "/v1/messages" });
    expect(rule.match?.headers).toEqual([
      {
        key: { exact: "x-api-key" },
        value: { exact: "sandbox-brokered-anthropic-key" },
      },
    ]);
    expect(rule.transform).toEqual([
      { headers: { "x-api-key": credential } },
    ]);

    const writtenContent = [...state.writes.values()].join("\n");
    expect(writtenContent).not.toContain(credential);
    expect(writtenContent).not.toContain(accessToken.token);
    expect(writtenContent).not.toContain("ambient-token");
    expect(writtenContent).toContain("sandbox-brokered-anthropic-key");

    expect(state.command?.cmd).toBe("node");
    expect(state.command?.args?.slice(0, 2)).toEqual([
      "--input-type=module",
      "--eval",
    ]);
    expect(state.command?.timeoutMs).toBeGreaterThan(0);
    expect(state.command?.timeoutMs).toBeLessThan(1_500);
    expect(state.command?.signal).toBe(contract.signal);
    expect(Object.keys(state.command?.env ?? {}).sort()).toEqual([
      "SANDBOX_REQUEST_PATH",
      "SANDBOX_RESPONSE_PATH",
    ]);
    expect(JSON.stringify(state.command?.env)).not.toContain(credential);
    expect(JSON.stringify(state.command?.env)).not.toContain(accessToken.token);
    expect(state.writeSignals).toEqual([contract.signal]);
    expect(state.readSignals).toEqual([contract.signal]);
    expect(state.stopSignals).toHaveLength(1);
    const cleanupSignal = state.stopSignals[0];
    if (!cleanupSignal) throw new Error("Sandbox cleanup signal was not captured.");
    expect(cleanupSignal).not.toBe(contract.signal);
    expect(cleanupSignal).not.toBe(controller.signal);
    expect(cleanupSignal.aborted).toBe(false);

    const mutationInit: RequestInit = { method: "POST", body: "{}" };
    const firstControlPlaneResponse = await contract.fetch(
      "https://vercel.com/api/v2/sandboxes",
      mutationInit,
    );
    expect(firstControlPlaneResponse.status).toBe(500);
    await expect(
      contract.fetch("https://vercel.com/api/v2/sandboxes", mutationInit),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(controlPlaneCalls).toBe(1);
  });

  it("blocks the second mutating fetch attempt made by Vercel Sandbox 2.9.2 retry logic", async () => {
    let rawFetchCalls = 0;
    const guardedFetch = singleAttemptControlPlaneFetch(async () => {
      rawFetchCalls += 1;
      return new Response("transient failure", { status: 500 });
    });

    await expect(
      Sandbox.create({
        token: "test-token",
        teamId: "team_test",
        projectId: "project_test",
        runtime: "node22",
        persistent: false,
        ports: [],
        timeout: 1_000,
        env: {},
        networkPolicy: "deny-all",
        fetch: guardedFetch,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(rawFetchCalls).toBe(1);
  });

  it.each([
    ["wrong origin", "https://example.com/v1/messages", "POST"],
    ["wrong path", "https://api.anthropic.com/v1/complete", "POST"],
    ["query string", "https://api.anthropic.com/v1/messages?x=1", "POST"],
    ["wrong method", "https://api.anthropic.com/v1/messages", "GET"],
  ])("rejects %s before sandbox creation", async (_name, url, method) => {
    const { state, factory } = fakeSandboxFactory();
    const sandboxFetch = createVercelSandboxFetch({
      credential: "expected-key",
      timeoutMs: 1_000,
      createSandbox: factory,
    });

    await expect(
      sandboxFetch(url, {
        method,
        headers: { "x-api-key": "expected-key" },
      }),
    ).rejects.toThrow("unauthorized provider request");
    expect(state.createContracts).toHaveLength(0);
  });

  it("rejects an unexpected provider credential before sandbox creation", async () => {
    const { state, factory } = fakeSandboxFactory();
    const sandboxFetch = createVercelSandboxFetch({
      credential: "expected-key",
      timeoutMs: 1_000,
      createSandbox: factory,
    });

    await expect(
      sandboxFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": "wrong-key" },
        body: "{}",
      }),
    ).rejects.toThrow("unexpected provider credential");
    expect(state.createContracts).toHaveLength(0);
  });

  it("uses a fresh bounded cleanup signal after caller cancellation", async () => {
    const controller = new AbortController();
    const { state, factory } = fakeSandboxFactory({
      onRunCommand: () => controller.abort(),
    });
    const sandboxFetch = createVercelSandboxFetch({
      credential: "expected-key",
      timeoutMs: 1_000,
      createSandbox: factory,
    });

    await expect(
      sandboxFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": "expected-key" },
        body: "{}",
        signal: controller.signal,
      }),
    ).rejects.toThrow("Sandbox runtime model transport was aborted.");

    expect(state.stopSignals).toHaveLength(1);
    const cleanupSignal = state.stopSignals[0];
    const operationSignal = state.createContracts[0]?.signal;
    if (!cleanupSignal || !operationSignal) {
      throw new Error("Sandbox operation and cleanup signals were not captured.");
    }
    expect(operationSignal.aborted).toBe(true);
    expect(cleanupSignal).not.toBe(operationSignal);
    expect(cleanupSignal).not.toBe(controller.signal);
    expect(cleanupSignal.aborted).toBe(false);
  });

  it("fails closed when the sandbox command fails and still requests cleanup", async () => {
    const { state, factory } = fakeSandboxFactory({ exitCode: 7 });
    const sandboxFetch = createVercelSandboxFetch({
      credential: "expected-key",
      timeoutMs: 1_000,
      createSandbox: factory,
    });

    await expect(
      sandboxFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": "expected-key" },
        body: "{}",
      }),
    ).rejects.toThrow("Sandbox runtime model transport failed.");
    expect(state.stopSignals).toHaveLength(1);
  });

  it("fails closed when cleanup fails after a successful provider response", async () => {
    const { state, factory } = fakeSandboxFactory({ stopFails: true });
    const sandboxFetch = createVercelSandboxFetch({
      credential: "expected-key",
      timeoutMs: 1_000,
      createSandbox: factory,
    });

    await expect(
      sandboxFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": "expected-key" },
        body: "{}",
      }),
    ).rejects.toThrow("Sandbox runtime cleanup failed.");
    expect(state.stopSignals).toHaveLength(1);
  });

  it("rejects malformed sandbox response envelopes and still requests cleanup", async () => {
    const { state, factory } = fakeSandboxFactory({
      responseEnvelope: JSON.stringify({ status: 200, bodyBase64: "not base64" }),
    });
    const sandboxFetch = createVercelSandboxFetch({
      credential: "expected-key",
      timeoutMs: 1_000,
      createSandbox: factory,
    });

    await expect(
      sandboxFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": "expected-key" },
        body: "{}",
      }),
    ).rejects.toThrow("Sandbox runtime model transport failed.");
    expect(state.stopSignals).toHaveLength(1);
  });
});
