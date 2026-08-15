import { describe, expect, it } from "vitest";
import {
  createVercelSandboxFetch,
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
      async runCommand(params) {
        state.command = params;
        const responsePath = params.env?.SANDBOX_RESPONSE_PATH;
        if (!responsePath) throw new Error("Fake sandbox response path missing.");
        state.writes.set(
          responsePath,
          options?.responseEnvelope ?? relayEnvelope("provider-response"),
        );
        return { exitCode: options?.exitCode ?? 0 };
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

describe("Vercel sandbox runtime transport", () => {
  it("uses one ephemeral sandbox with exact Anthropic egress and no provider credential in the VM", async () => {
    const credential = "anthropic-production-secret";
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

    expect(contract.runtime).toBe("node22");
    expect(contract.persistent).toBe(false);
    expect(contract.ports).toEqual([]);
    expect(contract.timeout).toBe(1_500);
    expect(contract.env).toEqual({});
    expect(contract.signal).toBe(controller.signal);

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
    expect(writtenContent).not.toContain("ambient-token");
    expect(writtenContent).toContain("sandbox-brokered-anthropic-key");

    expect(state.command?.cmd).toBe("node");
    expect(state.command?.args?.slice(0, 2)).toEqual([
      "--input-type=module",
      "--eval",
    ]);
    expect(state.command?.timeoutMs).toBe(1_500);
    expect(state.command?.signal).toBe(controller.signal);
    expect(JSON.stringify(state.command?.env)).not.toContain(credential);
    expect(state.writeSignals).toEqual([controller.signal]);
    expect(state.readSignals).toEqual([controller.signal]);
    expect(state.stopSignals).toEqual([controller.signal]);

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
