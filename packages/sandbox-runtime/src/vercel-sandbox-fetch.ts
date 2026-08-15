import { Buffer } from "node:buffer";
import { Sandbox, type NetworkPolicy } from "@vercel/sandbox";

const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";
const ANTHROPIC_MESSAGES_PATH = "/v1/messages";
const SANDBOX_REQUEST_PATH = "/tmp/runtime-model-request.json";
const SANDBOX_RESPONSE_PATH = "/tmp/runtime-model-response.json";
const SANDBOX_API_KEY_PLACEHOLDER = "sandbox-brokered-anthropic-key";
const SANDBOX_RUNTIME = "node22";

const RELAY_SOURCE = `
import { readFile, writeFile } from "node:fs/promises";

const requestPath = process.env.SANDBOX_REQUEST_PATH;
const responsePath = process.env.SANDBOX_RESPONSE_PATH;
if (!requestPath || !responsePath) {
  throw new Error("Sandbox relay paths are required.");
}

const request = JSON.parse(await readFile(requestPath, "utf8"));
const response = await fetch(request.url, {
  method: request.method,
  headers: request.headers,
  body: request.bodyBase64 === null
    ? undefined
    : Buffer.from(request.bodyBase64, "base64"),
  redirect: "error",
});

const excludedHeaders = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);
const headers = [];
response.headers.forEach((value, key) => {
  if (!excludedHeaders.has(key.toLowerCase())) headers.push([key, value]);
});

const bodyBase64 = Buffer.from(await response.arrayBuffer()).toString("base64");
await writeFile(
  responsePath,
  JSON.stringify({
    status: response.status,
    statusText: response.statusText,
    headers,
    bodyBase64,
  }),
  "utf8",
);
`;

interface SandboxCommandResult {
  exitCode: number;
}

interface SandboxFileSystem {
  writeFile(
    path: string,
    data: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  readFile(
    path: string,
    options: { encoding: "utf8"; signal?: AbortSignal },
  ): Promise<string>;
}

export interface SandboxInstance {
  fs: SandboxFileSystem;
  runCommand(params: {
    cmd: string;
    args?: string[];
    env?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<SandboxCommandResult>;
  stop(options?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface SandboxCreateContract {
  runtime: typeof SANDBOX_RUNTIME;
  persistent: false;
  ports: number[];
  timeout: number;
  env: Record<string, string>;
  networkPolicy: NetworkPolicy;
  signal?: AbortSignal;
  fetch: typeof fetch;
}

export type SandboxFactory = (
  contract: SandboxCreateContract,
) => Promise<SandboxInstance>;

export interface VercelSandboxFetchOptions {
  credential: string;
  timeoutMs: number;
  createSandbox?: SandboxFactory;
  controlPlaneFetch?: typeof fetch;
}

interface RelayRequest {
  url: string;
  method: "POST";
  headers: [string, string][];
  bodyBase64: string | null;
}

interface RelayResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  bodyBase64: string;
}

export const VERCEL_SANDBOX_RUNTIME_PROFILE = Object.freeze({
  id: "vercel-sandbox-anthropic-egress-v1",
  runtime: SANDBOX_RUNTIME,
  persistent: false,
  destination: "api.anthropic.com",
  method: "POST",
  path: ANTHROPIC_MESSAGES_PATH,
});

const fixedError = (message: string): Error => {
  const error = new Error(message);
  error.name = "SandboxRuntimeError";
  return error;
};

const abortError = (message: string): Error => {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringPair = (value: unknown): value is [string, string] =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === "string" &&
  typeof value[1] === "string";

const isBase64 = (value: string): boolean => {
  if (value.length === 0) return true;
  if (value.length % 4 !== 0) return false;
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
    value,
  );
};

const parseRelayResponse = (text: string): RelayResponse => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw fixedError("Sandbox runtime returned an invalid response envelope.");
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.status !== "number" ||
    !Number.isInteger(parsed.status) ||
    parsed.status < 100 ||
    parsed.status > 599 ||
    typeof parsed.statusText !== "string" ||
    !Array.isArray(parsed.headers) ||
    !parsed.headers.every(isStringPair) ||
    typeof parsed.bodyBase64 !== "string" ||
    !isBase64(parsed.bodyBase64)
  ) {
    throw fixedError("Sandbox runtime returned an invalid response envelope.");
  }

  return {
    status: parsed.status,
    statusText: parsed.statusText,
    headers: parsed.headers,
    bodyBase64: parsed.bodyBase64,
  };
};

const encodeBody = async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<string | null> => {
  if (init?.body !== undefined && init.body !== null) {
    if (typeof init.body === "string") {
      return Buffer.from(init.body, "utf8").toString("base64");
    }
    if (init.body instanceof ArrayBuffer) {
      return Buffer.from(init.body).toString("base64");
    }
    if (ArrayBuffer.isView(init.body)) {
      return Buffer.from(
        init.body.buffer,
        init.body.byteOffset,
        init.body.byteLength,
      ).toString("base64");
    }
    throw fixedError("Sandbox runtime rejected an unsupported request body.");
  }

  if (input instanceof Request) {
    const body = Buffer.from(await input.arrayBuffer());
    return body.length === 0 ? null : body.toString("base64");
  }

  return null;
};

const buildHeaders = (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] | undefined,
  credential: string,
): [string, string][] => {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }

  if (headers.get("x-api-key") !== credential) {
    throw fixedError("Sandbox runtime rejected an unexpected provider credential.");
  }

  headers.delete("authorization");
  headers.set("x-api-key", SANDBOX_API_KEY_PLACEHOLDER);

  const pairs: [string, string][] = [];
  headers.forEach((value, key) => pairs.push([key, value]));
  return pairs;
};

const buildRelayRequest = async (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] | undefined,
  credential: string,
): Promise<RelayRequest> => {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl);
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();

  if (
    url.origin !== ANTHROPIC_API_ORIGIN ||
    url.pathname !== ANTHROPIC_MESSAGES_PATH ||
    url.search !== "" ||
    url.hash !== "" ||
    method !== "POST"
  ) {
    throw fixedError("Sandbox runtime rejected an unauthorized provider request.");
  }

  return {
    url: `${ANTHROPIC_API_ORIGIN}${ANTHROPIC_MESSAGES_PATH}`,
    method: "POST",
    headers: buildHeaders(input, init, credential),
    bodyBase64: await encodeBody(input, init),
  };
};

const networkPolicyFor = (credential: string): NetworkPolicy => ({
  allow: {
    "api.anthropic.com": [
      {
        match: {
          method: ["POST"],
          path: { exact: ANTHROPIC_MESSAGES_PATH },
          headers: [
            {
              key: { exact: "x-api-key" },
              value: { exact: SANDBOX_API_KEY_PLACEHOLDER },
            },
          ],
        },
        transform: [{ headers: { "x-api-key": credential } }],
      },
    ],
  },
});

const singleAttemptControlPlaneFetch = (fetchImpl: typeof fetch): typeof fetch => {
  const startedMutations = new WeakSet<object>();

  return async (input, init) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    if (method !== "GET" && method !== "HEAD" && init) {
      if (startedMutations.has(init)) {
        throw abortError("Vercel Sandbox control-plane retry was blocked.");
      }
      startedMutations.add(init);
    }

    return fetchImpl(input, init);
  };
};

const defaultSandboxFactory: SandboxFactory = async (contract) =>
  Sandbox.create({
    runtime: contract.runtime,
    persistent: contract.persistent,
    ports: contract.ports,
    timeout: contract.timeout,
    env: contract.env,
    networkPolicy: contract.networkPolicy,
    signal: contract.signal,
    fetch: contract.fetch,
  });

const operationSignalFor = (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] | undefined,
  timeoutMs: number,
): AbortSignal =>
  init?.signal ??
  (input instanceof Request ? input.signal : undefined) ??
  AbortSignal.timeout(timeoutMs);

/**
 * Create the only production fetch transport admitted for the current Anthropic
 * runtime. The provider request executes inside an ephemeral Vercel Sandbox.
 * The real provider credential stays outside the VM and is injected by the
 * sandbox network policy at the egress boundary.
 */
export function createVercelSandboxFetch(
  options: VercelSandboxFetchOptions,
): typeof fetch {
  if (
    !options.credential.trim() ||
    !Number.isFinite(options.timeoutMs) ||
    options.timeoutMs <= 0
  ) {
    throw fixedError("Sandbox runtime configuration is invalid.");
  }

  const createSandbox = options.createSandbox ?? defaultSandboxFactory;
  const controlPlaneFetch = singleAttemptControlPlaneFetch(
    options.controlPlaneFetch ?? fetch,
  );

  return async (input, init) => {
    const request = await buildRelayRequest(input, init, options.credential);
    const signal = operationSignalFor(input, init, options.timeoutMs);
    let sandbox: SandboxInstance | undefined;
    let response: Response | undefined;
    let failure: Error | undefined;

    try {
      sandbox = await createSandbox({
        runtime: SANDBOX_RUNTIME,
        persistent: false,
        ports: [],
        timeout: options.timeoutMs,
        env: {},
        networkPolicy: networkPolicyFor(options.credential),
        signal,
        fetch: controlPlaneFetch,
      });

      await sandbox.fs.writeFile(
        SANDBOX_REQUEST_PATH,
        JSON.stringify(request),
        { signal },
      );

      const command = await sandbox.runCommand({
        cmd: "node",
        args: ["--input-type=module", "--eval", RELAY_SOURCE],
        env: {
          SANDBOX_REQUEST_PATH,
          SANDBOX_RESPONSE_PATH,
        },
        signal,
        timeoutMs: options.timeoutMs,
      });

      if (command.exitCode !== 0) {
        throw fixedError("Sandbox runtime model transport failed.");
      }

      const relayResponse = parseRelayResponse(
        await sandbox.fs.readFile(SANDBOX_RESPONSE_PATH, {
          encoding: "utf8",
          signal,
        }),
      );

      response = new Response(Buffer.from(relayResponse.bodyBase64, "base64"), {
        status: relayResponse.status,
        statusText: relayResponse.statusText,
        headers: relayResponse.headers,
      });
    } catch {
      failure = signal.aborted
        ? fixedError("Sandbox runtime model transport was aborted.")
        : fixedError("Sandbox runtime model transport failed.");
    }

    if (sandbox) {
      try {
        await sandbox.stop({ signal });
      } catch {
        if (!failure) {
          failure = signal.aborted
            ? fixedError("Sandbox runtime model transport was aborted.")
            : fixedError("Sandbox runtime cleanup failed.");
        }
      }
    }

    if (signal.aborted && !failure) {
      failure = fixedError("Sandbox runtime model transport was aborted.");
    }
    if (failure) throw failure;
    if (!response) throw fixedError("Sandbox runtime model transport failed.");
    return response;
  };
}
