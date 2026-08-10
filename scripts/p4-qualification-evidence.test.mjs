import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  P4_EVIDENCE_CONTRACT_VERSION,
  buildEvidenceManifest,
} from "./p4-qualification-evidence.mjs";

const SOURCE_SHA = "66554636d6de2f9167ae7611448b3c17a41f542e";

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
    requestBodySha256: "a".repeat(64),
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

const writeInvocations = (root) =>
  writeFileSync(
    join(root, "p4-output/invocations-1234-2.ndjson"),
    `${invocationRows().map((row) => JSON.stringify(row)).join("\n")}\n`,
  );

test("success requires report, admission, and completed invocation evidence", () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "p4-output/qualification-1234-2.json"), "{\"verdict\":\"PASS\"}\n");
    writeFileSync(join(root, "p4-output/admission-1234-2.json"), "{\"decision\":\"ADMITTED\"}\n");
    writeInvocations(root);

    const manifest = buildEvidenceManifest(args(root));
    assert.equal(manifest.contractVersion, P4_EVIDENCE_CONTRACT_VERSION);
    assert.equal(manifest.qualification.outcome, "success");
    assert.equal(manifest.invocations.startedCount, 1);
    assert.equal(manifest.invocations.completedCount, 1);
    assert.deepEqual(manifest.invocations.models, [{ provider: "anthropic", model: "claude-test" }]);
    assert.equal(manifest.artifacts.admission.publishEligible, true);
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

    assert.equal(manifest.qualification.outcome, "failure");
    assert.equal(manifest.qualification.failureReasonCode, "DRAFT_MODEL_HTTP_ERROR");
    assert.equal(manifest.decision.owner, "Lvvphole");
    assert.match(manifest.qualification.policyFileSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(manifest.invocations.models, [{ provider: "anthropic", model: "claude-test" }]);
    assert.equal(manifest.artifacts.report.present, false);
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an apparent command success fails closed when evidence is incomplete", () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "p4-output/qualification-1234-2.json"), "{\"verdict\":\"PASS\"}\n");
    const manifest = buildEvidenceManifest(args(root));
    assert.equal(manifest.qualification.outcome, "failure");
    assert.equal(manifest.qualification.exitCode, 2);
    assert.equal(manifest.qualification.failureReasonCode, "QUALIFICATION_EVIDENCE_INCOMPLETE");
    assert.equal(manifest.artifacts.admission.publishEligible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
