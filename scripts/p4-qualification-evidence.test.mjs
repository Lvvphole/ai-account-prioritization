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

const invocationRows = () => [
  {
    kind: "p4-provider-invocation-v1",
    phase: "started",
    sequence: 1,
    timestamp: "2026-08-10T13:00:00.100Z",
    provider: "anthropic",
    model: "claude-test",
    requestBodySha256: REQUEST_BODY_SHA256,
    requestBodyJson: REQUEST_BODY_JSON,
  },
  {
    kind: "p4-provider-invocation-v1",
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

test("provider audit preserves the exact request body without credential headers", () => {
  const root = fixture();
  try {
    const auditPath = join(root, "p4-output/provider-audit.ndjson");
    const secret = "qualification-test-secret";
    const childScript = `
      globalThis.fetch = async () => ({ status: 200 });
      require(${JSON.stringify(AUDIT_MODULE_PATH)});
      (async () => {
        await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": process.env.TEST_PROVIDER_SECRET },
          body: process.env.TEST_REQUEST_BODY_JSON,
        });
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `;
    const result = spawnSync(process.execPath, ["-e", childScript], {
      env: {
        ...process.env,
        P4_INVOCATION_AUDIT: auditPath,
        TEST_PROVIDER_SECRET: secret,
        TEST_REQUEST_BODY_JSON: REQUEST_BODY_JSON,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const auditText = readFileSync(auditPath, "utf8");
    const records = auditText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(records.length, 2);
    assert.equal(records[0].phase, "started");
    assert.equal(records[0].requestBodyJson, REQUEST_BODY_JSON);
    assert.equal(records[0].requestBodySha256, REQUEST_BODY_SHA256);
    assert.equal(auditText.includes(secret), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("success requires PASS, admission, completed invocation evidence, and decision metadata", () => {
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
    assert.equal(manifest.invocations.invalidRecordCount, 0);
    assert.equal(manifest.artifacts.admission.publishEligible, true);
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
