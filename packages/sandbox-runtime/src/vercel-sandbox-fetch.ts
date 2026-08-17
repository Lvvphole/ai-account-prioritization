import { Buffer } from "node:buffer";
import { Sandbox, type NetworkPolicy } from "@vercel/sandbox";

const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";
const ANTHROPIC_MESSAGES_PATH = "/v1/messages";
const OPENAI_API_ORIGIN = "https://api.openai.com";
const OPENAI_RESPONSES_PATH = "/v1/responses";
const SANDBOX_REQUEST_PATH = "/tmp/runtime-model-request.json";
const SANDBOX_RESPONSE_PATH = "/tmp/runtime-model-response.json";
const ANTHROPIC_SANDBOX_API_KEY_PLACEHOLDER =
  "sandbox-brokered-anthropic-key";
export const VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER =
  "sandbox-brokered-openai-key";
const SANDBOX_RUNTIME = "node22";
const MAX_SANDBOX_CLEANUP_RESERVE_MS = 250;

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

interface SandboxSession {
  runCommand(params: {
    cmd: string;
    args?: string[];
    env?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<SandboxCommandResult>;
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
  currentSession(): SandboxSession;
  stop(options?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface VercelSandboxAccessToken {
  teamId: string;
  projectId: string;
  token: string;
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
  accessToken?: VercelSandboxAccessToken;
}

export type SandboxFactory = (
  contract: SandboxCreateContract,
) => Promise<SandboxInstance>;

export interface VercelSandboxFetchOptions {
  credential: string;
  timeoutMs: number;
  accessToken?: VercelSandboxAccessToken;
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

type SandboxAuthEnvironment = Readonly<Record<string, string | undefined>>;

interface OperationSignals {
  signal: AbortSignal;
  timeoutSignal: AbortSignal;
  callerSignal?: AbortSignal;
}

interface SandboxProviderProfile {
  apiOrigin: string;
  path: string;
  sanitizeHeaders(headers: Headers, credential: string): void;
  networkPolicyFor(credential: string): NetworkPolicy;
}

export const VERCEL_SANDBOX_RUNTIME_PROFILE = Object.freeze({
  id: "vercel-sandbox-anthropic-egress-v1",
  runtime: SANDBOX_RUNTIME,
  persistent: false,
  destination: "api.anthropic.com",
  method: "POST",
  path: ANTHROPIC_MESSAGES_PATH,
});

export const VERCEL_SANDBOX_OPENAI_RUNTIME_PROFILE = Object.freeze({
  id: "vercel-sandbox-openai-egress-v1",
  runtime: SANDBOX_RUNTIME,
  persistent: false,
  destination: "api.openai.com",
  method: "POST",
  path: OPENAI_RESPONSES_PATH,
});

const fixedError = (message: string): Error => {
  const error = new Error(message);
  error.name = "SandboxRuntimeError";
  return error;
};

const timeoutError = (message: string): Error => {
  const error = new Error(message);
  error.name = "SandboxRuntimeTimeoutError";
  return error;
};

const abortError = (message: string): Error => {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

const envValue = (
  env: SandboxAuthEnvironment,
  name: string,
): string => env[name]?.trim() ?? "";

/**
 * Return explicit Vercel Sandbox access-token fields when they are configured.
 * When VERCEL_OIDC_TOKEN is present, the Vercel SDK reads it directly.
 */
export function vercelSandboxAccessTokenFromEnv(
  env: SandboxAuthEnvironment = process.env,
): VercelSandboxAccessToken | undefined {
  if (envValue(env, "VERCEL_OIDC_TOKEN")) return undefined;

  const teamId = envValue(env, "VERCEL_TEAM_ID");
  const projectId = envValue(env, "VERCEL_PROJECT_ID");
  const token = envValue(env, "VERCEL_TOKEN");
  const explicitValues = [teamId, projectId, token].filter(Boolean).length;

  if (explicitValues === 0) return undefined;
  if (explicitValues !== 3) {
    throw fixedError(
      "Vercel Sandbox control-plane authentication is incomplete.",
    );
  }

  return { teamId, projectId, token };
}

/** Require either Vercel OIDC or one complete explicit access-token tuple. */
export function assertVercelSandboxAuthentication(
  env: SandboxAuthEnvironment = process.env,
): void {
  if (envValue(env, "VERCEL_OIDC_TOKEN")) return;
  if (vercelSandboxAccessTokenFromEnv(env)) return;
  throw fixedError("Vercel Sandbox control-plane authentication is required.");
}

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

const mergedHeadersFor = (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] | undefined,
): Headers => {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return headers;
};

const headerPairsFor = (headers: Headers): [string, string][] => {
  const pairs: [string, string][] = [];
  headers.forEach((value, key) => pairs.push([key, value]));
  return pairs;
};

const sanitizeAnthropicHeaders = (
  headers: Headers,
  credential: string,
): void => {
  if (headers.get("x-api-key") !== credential) {
    throw fixedError("Sandbox runtime rejected an unexpected provider credential.");
  }

  headers.delete("authorization");
  headers.set("x-api-key", ANTHROPIC_SANDBOX_API_KEY_PLACEHOLDER);
};

const sanitizeOpenAIHeaders = (headers: Headers): void => {
  const expectedAuthorization =
    `Bearer ${VERCEL_SANDBOX_OPENAI_API_KEY_PLACEHOLDER}`;
  if (headers.get("authorization") !== expectedAuthorization) {
    throw fixedError("Sandbox runtime rejected an unexpected provider credential.");
  }

  headers.delete("x-api-key");
  headers.set("authorization", expectedAuthorization);
};

const anthropicNetworkPolicyFor = (credential: string): NetworkPolicy => ({
  allow: {
    "api.anthropic.com": [
      {
        match: {
          method: ["POST"],
          path: { exact: ANTHROPIC_MESSAGES_PATH },
          headers: [
            {
              key: { exact: "x-api-key" },
              value: { exact: ANTHROPIC_SANDBOX_API_KEY_PLACEHOLDER },
            },
          ],
        },
        transform: [{ headers: { "x-api-key": credential } }],
      },
    ],
  },
});

const openAINetworkPolicyFor = (credential: string): NetworkPolicy => ({
  allow: {
    "api.openai.com": [
      {
        match: {
          method: ["POST"],
          path: { exact: OPENAI_RESPONSES_PATH },
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

const ANTHROPIC_PROVIDER_PROFILE: SandboxProviderProfile = {
  apiOrigin: ANTHROPIC_API_ORIGIN,
  path: ANTHROPIC_MESSAGES_PATH,
  sanitizeHeaders: sanitizeAnthropicHeaders,
  networkPolicyFor: anthropicNetworkPolicyFor,
};

const OPENAI_PROVIDER_PROFILE: SandboxProviderProfile = {
  apiOrigin: OPENAI_API_ORIGIN,
  path: OPENAI_RESPONSES_PATH,
  sanitizeHeaders: sanitizeOpenAIHeaders,
  networkPolicyFor: openAINetworkPolicyFor,
};

const buildRelayRequest = async (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] | undefined,
  credential: string,
  profile: SandboxProviderProfile,
): Promise<RelayRequest> => {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl);
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();

  if (
    url.origin !== profile.apiOrigin ||
    url.pathname !== profile.path ||
    url.search !== "" ||
    url.hash !== "" ||
    method !== "POST"
  ) {
    throw fixedError("Sandbox runtime rejected an unauthorized provider request.");
  }

  const headers = mergedHeadersFor(input, init);
  profile.sanitizeHeaders(headers, credential);

  return {
    url: `${profile.apiOrigin}${profile.path}`,
    method: "POST",
    headers: headerPairsFor(headers),
    bodyBase64: await encodeBody(input, init),
  };
};

/**
 * Vercel Sandbox wraps control-plane fetches in retry logic. A repeated mutating
 * request can duplicate model execution. Block reuse of the same mutation
 * request object. Vercel Sandbox 2.9.2 reuses that object for fetch retries.
 */
export const singleAttemptControlPlaneFetch = (
  fetchImpl: typeof fetch,
): typeof fetch => {
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
    ...(contract.accessToken ?? {}),
  });

const operationSignalsFor = (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] | undefined,
  timeoutMs: number,
): OperationSignals => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const callerSignal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return {
    signal: callerSignal
      ? AbortSignal.any([callerSignal, timeoutSignal])
      : timeoutSignal,
    timeoutSignal,
    callerSignal,
  };
};

const cleanupReserveMsFor = (timeoutMs: number): number =>
  Math.min(
    MAX_SANDBOX_CLEANUP_RESERVE_MS,
    Math.max(1, Math.floor(timeoutMs / 2)),
  );

const operationFailureFor = (signals: OperationSignals): Error => {
  if (signals.timeoutSignal.aborted) {
    return timeoutError("Sandbox runtime model transport timed out.");
  }
  if (signals.callerSignal?.aborted) {
    return fixedError("Sandbox runtime model transport was aborted.");
  }
  return fixedError("Sandbox runtime model transport failed.");
};

const createProviderVercelSandboxFetch = (
  options: VercelSandboxFetchOptions,
  profile: SandboxProviderProfile,
): typeof fetch => {
  if (
    !options.credential.trim() ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 2
  ) {
    throw fixedError("Sandbox runtime configuration is invalid.");
  }

  const createSandbox = options.createSandbox ?? defaultSandboxFactory;
  const controlPlaneFetch = singleAttemptControlPlaneFetch(
    options.controlPlaneFetch ?? fetch,
  );
  const cleanupTimeoutMs = cleanupReserveMsFor(options.timeoutMs);
  const operationTimeoutMs = options.timeoutMs - cleanupTimeoutMs;

  return async (input, init) => {
    const request = await buildRelayRequest(
      input,
      init,
      options.credential,
      profile,
    );
    const operation = operationSignalsFor(input, init, operationTimeoutMs);
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
        networkPolicy: profile.networkPolicyFor(options.credential),
        signal: operation.signal,
        fetch: controlPlaneFetch,
        accessToken: options.accessToken,
      });

      await sandbox.fs.writeFile(
        SANDBOX_REQUEST_PATH,
        JSON.stringify(request),
        { signal: operation.signal },
      );

      // Do not use Sandbox.runCommand(). It can resume a stopped sandbox and
      // invoke the command again. The current Session path is single-attempt.
      const command = await sandbox.currentSession().runCommand({
        cmd: "node",
        args: ["--input-type=module", "--eval", RELAY_SOURCE],
        env: {
          SANDBOX_REQUEST_PATH,
          SANDBOX_RESPONSE_PATH,
        },
        signal: operation.signal,
        timeoutMs: operationTimeoutMs,
      });

      if (command.exitCode !== 0) {
        throw fixedError("Sandbox runtime model transport failed.");
      }

      const relayResponse = parseRelayResponse(
        await sandbox.fs.readFile(SANDBOX_RESPONSE_PATH, {
          encoding: "utf8",
          signal: operation.signal,
        }),
      );

      response = new Response(Buffer.from(relayResponse.bodyBase64, "base64"), {
        status: relayResponse.status,
        statusText: relayResponse.statusText,
        headers: relayResponse.headers,
      });
    } catch {
      failure = operationFailureFor(operation);
    }

    if (sandbox) {
      const cleanupSignal = AbortSignal.timeout(cleanupTimeoutMs);
      try {
        await sandbox.stop({ signal: cleanupSignal });
      } catch {
        if (!failure) {
          failure = fixedError("Sandbox runtime cleanup failed.");
        }
      }
    }

    if (operation.signal.aborted && !failure) {
      failure = operationFailureFor(operation);
    }
    if (failure) throw failure;
    if (!response) throw fixedError("Sandbox runtime model transport failed.");
    return response;
  };
};

/**
 * Create the production Anthropic fetch transport. The provider request runs
 * inside an ephemeral Vercel Sandbox. The trusted egress policy injects the
 * real provider credential after the request leaves the VM.
 */
export function createVercelSandboxFetch(
  options: VercelSandboxFetchOptions,
): typeof fetch {
  return createProviderVercelSandboxFetch(options, ANTHROPIC_PROVIDER_PROFILE);
}

/**
 * Create the dormant OpenAI sandbox fetch transport. The transport admits only
 * POST /v1/responses to api.openai.com and replaces the placeholder bearer
 * credential at the trusted egress boundary.
 */
export function createOpenAIVercelSandboxFetch(
  options: VercelSandboxFetchOptions,
): typeof fetch {
  return createProviderVercelSandboxFetch(options, OPENAI_PROVIDER_PROFILE);
}
