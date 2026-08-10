import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  P4_EVIDENCE_CONTRACT_VERSION,
  buildEvidenceManifest,
} from "./p4-qualification-evidence.mjs";

const SOURCE_SHA = "66554636d6de2f9167ae7611448b3c17a41f542e";
const CONTROL_SHA = "1111111111111111111111111111111111111111";
const PUBLISHER_SHA = "2222222222222222222222222222222222222222";
const AUDIT_MODULE_PATH = new URL("./p4-provider-invocation-audit.cjs", import.meta.url).pathname;
const REQUEST_BODY_JSON = JSON.stringify({
  model: "claude-test",
  max_tokens: 256,
  system: "Qualification system prompt",
  messages: [{ role: "user", content: "Qualification user prompt" }],
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
  },
});
const REQUEST_BODY_SHA256 = createHash("sha256").update(REQUEST_BODY_JSON).digest("hex");

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "p4-evidence-"));
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "p4-output"), { recursive: true });
  writeFileSync(join(root, "config/p4-qualification-policy.json"), "{\"policy\":\"test\"}\n");
  return root;
};

const args = (sourceDir, overrides = {}) => ({
  sourceDir,
  runId: "1234",
  runAttempt: 2,
  sourceSha: SOURCE_SHA,
  controlRevision: CONTROL_SHA,
  publisherRevision: PUBLISHER_SHA,
  transferArtifact: "p4-qualification-transfer-1234-2",
  decisionOwner: "Lvvphole",
  decisionRef: "https://github.com/Lvvphole/ai-account-prioritization/issues/65",
  startedAt: "2026-08-10T13:00:00.000Z",
  completedAt: "2026-08-10T13:00:01.000Z",
  exitCode: 0,
  stderrSha256: null,
  failureReasonCode: null,
  ...overrides,
});

const invocationContext = {
  kind: "p4-provider-invocation-v2",
  runId: "1234",
  runAttempt: 2,
  qualificationSourceSha: SOURCE_SHA,
  controlRevision: CONTROL_SHA,
  publisherRevision: PUBLISHER_SHA,
};

const invocationRows = () => [
  {
    ...invocationContext,
    phase: "started",
    sequence: 1,
    timestamp: "2026-08-10T13:00:00.100Z",
    provider: "anthropic",
    model: "claude-test",
    requestBodySha256: REQUEST_BODY_SHA256,
    requestBodyJson: REQUEST_BODY_JSON,
  },
  {
    ...invocationContext,
    phase: "completed",
    sequence: 1,
    timestamp: "2026-08-10T13:00:00.500Z",
    provider: "anthropic",
    model: "claude-test",
    outcome: "http_response",
    httpStatus: 200,
    durationMs: 400,
  },
];

const writeInvocationRows = (root, rows, suffix = "") =>
  writeFileSync(
    join(root, "p4-output/invocations-1234-2.ndjson"),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n${suffix}`,
  );

const writeInvocations = (root, suffix = "") =>
  writeInvocationRows(root, invocationRows(), suffix);

const writeReport = (root, verdict) =>
  writeFileSync(
    join(root, "p4-output/qualification-1234-2.json"),
    `${JSON.stringify({ verdict })}\n`,
  );

const writeAdmission = (root) =>
  writeFileSync(join(root, "p4-output/admission-1234-2.json"), "{\"decision\":\"ADMITTED\"}\n");

const providerAuditEnvironment = (auditPath) => ({
  ...process.env,
  P4_INVOCATION_AUDIT: auditPath,
  P4_AUDIT_SUPABASE_URL: "https://audit.supabase.test",
  P4_AUDIT_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  P4_AUDIT_WRITER_TOKEN: "test-writer-token",
  GITHUB_RUN_ID: "1234",
  GITHUB_RUN_ATTEMPT: "2",
  P4_QUALIFICATION_SOURCE_SHA: SOURCE_SHA,
  GITHUB_SHA: CONTROL_SHA,
  P4_PUBLISHER_REVISION: PUBLISHER_SHA,
  TEST_PROVIDER_SECRET: "qualification-test-secret",
  TEST_REQUEST_BODY_JSON: REQUEST_BODY_JSON,
});

test("provider audit persists started evidence before network send and preserves the exact request body", () => {
  const root = fixture();
  try {
    const auditPath = join(root, "p4-output/provider-audit.ndjson");
    const childScript = `
      const calls = [];
      globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (url.includes("append_p4_qualification_invocation_audit")) {
          calls.push({ kind: "audit", record: JSON.parse(init.body).p_record });
          return { ok: true, status: 200 };
        }
        calls.push({ kind: "provider", url });
        return { ok: true, status: 200 };
      };
      require(${JSON.stringify(AUDIT_MODULE_PATH)});
      (async () => {
        await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": process.env.TEST_PROVIDER_SECRET },
          body: process.env.TEST_REQUEST_BODY_JSON,
        });
        process.stdout.write(JSON.stringify(calls));
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `;
    const result = spawnSync(process.execPath, ["-e", childScript], {
      env: providerAuditEnvironment(auditPath),
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const calls = JSON.parse(result.stdout);
    assert.deepEqual(calls.map((call) => call.kind), ["audit", "provider", "audit"]);
    assert.equal(calls[0].record.phase, "started");
    assert.equal(calls[0].record.requestBodyJson, REQUEST_BODY_JSON);
    assert.equal(calls[0].record.requestBodySha256, REQUEST_BODY_SHA256);
    assert.equal(calls[0].record.controlRevision, CONTROL_SHA);
    assert.equal(calls[0].record.publisherRevision, PUBLISHER_SHA);

    const auditText = readFileSync(auditPath, "utf8");
    const records = auditText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(records.length, 2);
    assert.equal(records[0].phase, "started");
    assert.equal(records[0].requestBodyJson, REQUEST_BODY_JSON);
    assert.equal(auditText.includes(providerAuditEnvironment(auditPath).TEST_PROVIDER_SECRET), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("durable started-audit failure blocks the provider request", () => {
  const root = fixture();
  try {
    const auditPath = join(root, "p4-output/provider-audit.ndjson");
    const childScript = `
      const calls = [];
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes("append_p4_qualification_invocation_audit")) {
          calls.push("audit");
          return { ok: false, status: 503 };
        }
        calls.push("provider");
        return { ok: true, status: 200 };
      };
      require(${JSON.stringify(AUDIT_MODULE_PATH)});
      (async () => {
        try {
          await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            body: process.env.TEST_REQUEST_BODY_JSON,
          });
        } catch (error) {
          process.stdout.write(JSON.stringify({ calls, message: error.message }));
        }
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `;
    const result = spawnSync(process.execPath, ["-e", childScript], {
      env: providerAuditEnvironment(auditPath),
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const outcome = JSON.parse(result.stdout);
    assert.deepEqual(outcome.calls, ["audit"]);
    assert.match(outcome.message, /Durable P4 invocation audit append failed with HTTP 503/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("success requires PASS, admission, completed invocation evidence, decision metadata, and revision provenance", () => {
  const root = fixture();
  try {
    writeReport(root, "PASS");
    writeAdmission(root);
    writeInvocations(root);

    const manifest = buildEvidenceManifest(args(root));
    assert.equal(manifest.contractVersion, P4_EVIDENCE_CONTRACT_VERSION);
    assert.equal(manifest.qualification.executionOutcome, "success");
    assert.equal(manifest.qualification.verdict, "PASS");
    assert.equal(manifest.qualification.commandExitCode, 0);
    assert.equal(manifest.workflow.controlRevision, CONTROL_SHA);
    assert.equal(manifest.workflow.publisherRevision, PUBLISHER_SHA);
    assert.equal(manifest.invocations.invalidRecordCount, 0);
    assert.equal(manifest.artifacts.admission.publishEligible, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid control or publisher revisions fail before evidence can be accepted", () => {
  const root = fixture();
  try {
    assert.throws(
      () => buildEvidenceManifest(args(root, { controlRevision: "not-a-sha" })),
      /controlRevision must be a full lowercase Git commit SHA/,
    );
    assert.throws(
      () => buildEvidenceManifest(args(root, { publisherRevision: "" })),
      /publisherRevision must be a full lowercase Git commit SHA/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invocation provenance must match the manifest workflow provenance", () => {
  const root = fixture();
  try {
    writeReport(root, "PASS");
    writeAdmission(root);
    const rows = invocationRows();
    rows[0] = { ...rows[0], controlRevision: "3".repeat(40) };
    writeInvocationRows(root, rows);

    const manifest = buildEvidenceManifest(args(root));
    assert.ok(manifest.invocations.invalidRecordCount > 0);
    assert.equal(manifest.qualification.executionOutcome, "failure");
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing decision metadata stays archivable and cannot satisfy success", () => {
  const root = fixture();
  try {
    writeReport(root, "PASS");
    writeAdmission(root);
    writeInvocations(root);

    const manifest = buildEvidenceManifest(args(root, {
      decisionOwner: "",
      decisionRef: undefined,
    }));

    assert.equal(manifest.decision.owner, "MISSING_DECISION_METADATA");
    assert.equal(manifest.decision.ref, "MISSING_DECISION_METADATA");
    assert.equal(typeof manifest.decision.owner, "string");
    assert.equal(typeof manifest.decision.ref, "string");
    assert.equal(manifest.qualification.executionOutcome, "failure");
    assert.equal(manifest.qualification.commandExitCode, 0);
    assert.equal(manifest.qualification.failureReasonCode, "QUALIFICATION_EVIDENCE_INCOMPLETE");
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("provider failure remains auditable when the canonical report is absent", () => {
  const root = fixture();
  try {
    writeInvocations(root);
    const manifest = buildEvidenceManifest(args(root, {
      exitCode: 2,
      stderrSha256: "b".repeat(64),
      failureReasonCode: "DRAFT_MODEL_HTTP_ERROR",
    }));

    assert.equal(manifest.qualification.executionOutcome, "failure");
    assert.equal(manifest.qualification.verdict, null);
    assert.equal(manifest.qualification.failureReasonCode, "DRAFT_MODEL_HTTP_ERROR");
    assert.match(manifest.qualification.policyFileSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(manifest.invocations.models, [{ provider: "anthropic", model: "claude-test" }]);
    assert.equal(manifest.artifacts.report.present, false);
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("BLOCKED stays distinct from execution failure", () => {
  const root = fixture();
  try {
    writeReport(root, "BLOCKED");
    writeInvocations(root);
    const manifest = buildEvidenceManifest(args(root, {
      exitCode: 2,
      stderrSha256: "c".repeat(64),
      failureReasonCode: "UNCLASSIFIED_COMMAND_FAILURE",
    }));

    assert.equal(manifest.qualification.executionOutcome, "failure");
    assert.equal(manifest.qualification.verdict, "BLOCKED");
    assert.equal(manifest.qualification.failureReasonCode, "QUALIFICATION_BLOCKED");
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an apparent command success fails closed when evidence is incomplete", () => {
  const root = fixture();
  try {
    writeReport(root, "PASS");
    const manifest = buildEvidenceManifest(args(root));
    assert.equal(manifest.qualification.executionOutcome, "failure");
    assert.equal(manifest.qualification.verdict, "PASS");
    assert.equal(manifest.qualification.commandExitCode, 0);
    assert.equal(manifest.qualification.failureReasonCode, "QUALIFICATION_EVIDENCE_INCOMPLETE");
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed invocation evidence cannot satisfy a successful epoch", () => {
  const root = fixture();
  try {
    writeReport(root, "PASS");
    writeAdmission(root);
    writeInvocations(root, "not-json\n");

    const manifest = buildEvidenceManifest(args(root));
    assert.equal(manifest.invocations.invalidRecordCount, 1);
    assert.equal(manifest.qualification.executionOutcome, "failure");
    assert.equal(manifest.qualification.failureReasonCode, "QUALIFICATION_EVIDENCE_INCOMPLETE");
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing request body evidence cannot satisfy a successful epoch", () => {
  const root = fixture();
  try {
    writeReport(root, "PASS");
    writeAdmission(root);
    const rows = invocationRows();
    delete rows[0].requestBodyJson;
    writeInvocationRows(root, rows);

    const manifest = buildEvidenceManifest(args(root));
    assert.ok(manifest.invocations.invalidRecordCount > 0);
    assert.equal(manifest.qualification.executionOutcome, "failure");
    assert.equal(manifest.qualification.failureReasonCode, "QUALIFICATION_EVIDENCE_INCOMPLETE");
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tampered request body evidence cannot satisfy a successful epoch", () => {
  const root = fixture();
  try {
    writeReport(root, "PASS");
    writeAdmission(root);
    const rows = invocationRows();
    rows[0] = {
      ...rows[0],
      requestBodyJson: JSON.stringify({ ...JSON.parse(REQUEST_BODY_JSON), system: "tampered" }),
    };
    writeInvocationRows(root, rows);

    const manifest = buildEvidenceManifest(args(root));
    assert.ok(manifest.invocations.invalidRecordCount > 0);
    assert.equal(manifest.qualification.executionOutcome, "failure");
    assert.equal(manifest.qualification.failureReasonCode, "QUALIFICATION_EVIDENCE_INCOMPLETE");
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mismatched invocation sequence cannot satisfy a successful epoch", () => {
  const root = fixture();
  try {
    writeReport(root, "PASS");
    writeAdmission(root);
    const rows = invocationRows();
    rows[1] = { ...rows[1], sequence: 2 };
    writeInvocationRows(root, rows);

    const manifest = buildEvidenceManifest(args(root));
    assert.ok(manifest.invocations.invalidRecordCount > 0);
    assert.equal(manifest.qualification.executionOutcome, "failure");
    assert.equal(manifest.qualification.failureReasonCode, "QUALIFICATION_EVIDENCE_INCOMPLETE");
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mismatched invocation identity cannot satisfy a successful epoch", () => {
  const root = fixture();
  try {
    writeReport(root, "PASS");
    writeAdmission(root);
    const rows = invocationRows();
    rows[1] = { ...rows[1], provider: "openai" };
    writeInvocationRows(root, rows);

    const manifest = buildEvidenceManifest(args(root));
    assert.equal(manifest.invocations.invalidRecordCount, 1);
    assert.equal(manifest.qualification.executionOutcome, "failure");
    assert.equal(manifest.qualification.failureReasonCode, "QUALIFICATION_EVIDENCE_INCOMPLETE");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unknown invocation phase cannot satisfy a successful epoch", () => {
  const root = fixture();
  try {
    writeReport(root, "PASS");
    writeAdmission(root);
    const rows = invocationRows();
    rows[1] = { ...rows[1], phase: "done" };
    writeInvocationRows(root, rows);

    const manifest = buildEvidenceManifest(args(root));
    assert.ok(manifest.invocations.invalidRecordCount > 0);
    assert.equal(manifest.qualification.executionOutcome, "failure");
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("duplicate invocation sequence cannot satisfy a successful epoch", () => {
  const root = fixture();
  try {
    writeReport(root, "PASS");
    writeAdmission(root);
    const [started, completed] = invocationRows();
    writeInvocationRows(root, [started, { ...started }, completed]);

    const manifest = buildEvidenceManifest(args(root));
    assert.ok(manifest.invocations.invalidRecordCount > 0);
    assert.equal(manifest.qualification.executionOutcome, "failure");
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
