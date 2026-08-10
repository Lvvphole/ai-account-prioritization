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
let sequence = 0;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const appendAuditRecord = (record) => {
  if (!auditPath) {
    throw new Error("P4_INVOCATION_AUDIT is required before provider invocation.");
  }
  appendFileSync(auditPath, `${JSON.stringify(record)}\n`, "utf8");
};

const modelFromBody = (body) => {
  if (typeof body !== "string" || body.length === 0) return null;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.model === "string" && parsed.model.length > 0 ? parsed.model : null;
  } catch {
    return null;
  }
};

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

    const body = typeof init.body === "string" ? init.body : "";
    const model = modelFromBody(body);
    const invocationSequence = ++sequence;
    const startedAtMs = Date.now();

    appendAuditRecord({
      kind: "p4-provider-invocation-v1",
      phase: "started",
      sequence: invocationSequence,
      timestamp: new Date(startedAtMs).toISOString(),
      provider,
      model,
      requestBodySha256: body ? sha256(body) : null,
    });

    try {
      const response = await originalFetch(input, init);
      appendAuditRecord({
        kind: "p4-provider-invocation-v1",
        phase: "completed",
        sequence: invocationSequence,
        timestamp: new Date().toISOString(),
        provider,
        model,
        outcome: "http_response",
        httpStatus: response.status,
        durationMs: Date.now() - startedAtMs,
      });
      return response;
    } catch (error) {
      appendAuditRecord({
        kind: "p4-provider-invocation-v1",
        phase: "completed",
        sequence: invocationSequence,
        timestamp: new Date().toISOString(),
        provider,
        model,
        outcome: "network_error",
        errorName: error instanceof Error ? error.name : "UnknownError",
        durationMs: Date.now() - startedAtMs,
      });
      throw error;
    }
  };
}
