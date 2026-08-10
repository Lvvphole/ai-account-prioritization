const { createHash } = require("node:crypto");
const { appendFileSync } = require("node:fs");

const auditPath = process.env.P4_INVOCATION_AUDIT;
const originalFetch = globalThis.fetch?.bind(globalThis);
const providerByHost = new Map([
  ["api.anthropic.com", "anthropic"],
  ["api.openai.com", "openai"],
  ["api.x.ai", "xai"],
  ["generativelanguage.googleapis.com", "google"],
]);
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
let sequence = 0;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const requireEnvironmentValue = (name) => {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required before P4 provider invocation.`);
  }
  return value.trim();
};

const auditContext = () => {
  const runId = requireEnvironmentValue("GITHUB_RUN_ID");
  const runAttemptRaw = requireEnvironmentValue("GITHUB_RUN_ATTEMPT");
  const qualificationSourceSha = requireEnvironmentValue("P4_QUALIFICATION_SOURCE_SHA");
  const controlRevision = requireEnvironmentValue("GITHUB_SHA");
  const publisherRevision = requireEnvironmentValue("P4_PUBLISHER_REVISION");

  if (!/^[0-9]+$/.test(runId)) {
    throw new Error("GITHUB_RUN_ID must be a positive numeric identifier.");
  }
  if (!POSITIVE_INTEGER_PATTERN.test(runAttemptRaw)) {
    throw new Error("GITHUB_RUN_ATTEMPT must be a positive integer.");
  }
  for (const [name, value] of [
    ["P4_QUALIFICATION_SOURCE_SHA", qualificationSourceSha],
    ["GITHUB_SHA", controlRevision],
    ["P4_PUBLISHER_REVISION", publisherRevision],
  ]) {
    if (!SHA40_PATTERN.test(value)) {
      throw new Error(`${name} must be a full lowercase Git commit SHA.`);
    }
  }

  return {
    runId,
    runAttempt: Number(runAttemptRaw),
    qualificationSourceSha,
    controlRevision,
    publisherRevision,
  };
};

const appendLocalAuditRecord = (record) => {
  if (!auditPath) {
    throw new Error("P4_INVOCATION_AUDIT is required before provider invocation.");
  }
  appendFileSync(auditPath, `${JSON.stringify(record)}\n`, "utf8");
};

const durableAuditEndpoint = () => {
  const baseUrl = requireEnvironmentValue("P4_AUDIT_SUPABASE_URL");
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("P4_AUDIT_SUPABASE_URL must be a valid absolute URL.");
  }
  url.pathname = "/rest/v1/rpc/append_p4_qualification_invocation_audit";
  url.search = "";
  url.hash = "";
  return url;
};

const appendDurableAuditRecord = async (record) => {
  if (!originalFetch) {
    throw new Error("Global fetch is required for durable P4 invocation audit.");
  }

  const publishableKey = requireEnvironmentValue("P4_AUDIT_SUPABASE_PUBLISHABLE_KEY");
  const writerToken = requireEnvironmentValue("P4_AUDIT_WRITER_TOKEN");
  const response = await originalFetch(durableAuditEndpoint(), {
    method: "POST",
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${writerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_record: record }),
  });

  if (!response.ok) {
    throw new Error(
      `Durable P4 invocation audit append failed with HTTP ${response.status}.`,
    );
  }
};

const persistAuditRecord = async (record) => {
  appendLocalAuditRecord(record);
  await appendDurableAuditRecord(record);
};

const parseWireRequestBody = (body) => {
  if (typeof body !== "string" || body.length === 0) {
    throw new Error("P4 provider request body must be a non-empty JSON object before invocation.");
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("P4 provider request body must be valid JSON before invocation.");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("P4 provider request body must be a JSON object before invocation.");
  }
  return parsed;
};

const modelFromRequestBody = (requestBody) =>
  typeof requestBody.model === "string" && requestBody.model.length > 0
    ? requestBody.model
    : null;

const createAuditRecord = (record) => ({
  kind: "p4-provider-invocation-v2",
  ...auditContext(),
  ...record,
});

if (originalFetch) {
  globalThis.fetch = async (input, init = {}) => {
    let url;
    try {
      const raw = typeof input === "string" || input instanceof URL ? input : input.url;
      url = new URL(raw);
    } catch {
      return originalFetch(input, init);
    }

    const provider = providerByHost.get(url.hostname);
    if (!provider) return originalFetch(input, init);

    const requestBodyJson = typeof init.body === "string" ? init.body : "";
    const requestBody = parseWireRequestBody(requestBodyJson);
    const model = modelFromRequestBody(requestBody);
    const invocationSequence = ++sequence;
    const startedAtMs = Date.now();

    await persistAuditRecord(
      createAuditRecord({
        phase: "started",
        sequence: invocationSequence,
        timestamp: new Date(startedAtMs).toISOString(),
        provider,
        model,
        requestBodySha256: sha256(requestBodyJson),
        requestBodyJson,
      }),
    );

    let response;
    try {
      response = await originalFetch(input, init);
    } catch (error) {
      const completionRecord = createAuditRecord({
        phase: "completed",
        sequence: invocationSequence,
        timestamp: new Date().toISOString(),
        provider,
        model,
        outcome: "network_error",
        errorName: error instanceof Error ? error.name : "UnknownError",
        durationMs: Date.now() - startedAtMs,
      });
      try {
        await persistAuditRecord(completionRecord);
      } catch (auditError) {
        throw new AggregateError(
          [error, auditError],
          "Provider invocation failed and its durable completion audit could not be written.",
        );
      }
      throw error;
    }

    await persistAuditRecord(
      createAuditRecord({
        phase: "completed",
        sequence: invocationSequence,
        timestamp: new Date().toISOString(),
        provider,
        model,
        outcome: "http_response",
        httpStatus: response.status,
        durationMs: Date.now() - startedAtMs,
      }),
    );
    return response;
  };
}
