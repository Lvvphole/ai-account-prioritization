#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const P4_EVIDENCE_CONTRACT_VERSION = "p4-qualification-evidence-v1";

const FAILURE_CODE_PATTERN = /(QUALIFICATION_[A-Z0-9_]+|DRAFT_MODEL_[A-Z0-9_]+|MISSING_CREDENTIAL)/g;
const QUALIFICATION_VERDICTS = new Set(["PASS", "FAIL", "BLOCKED"]);
const MISSING_DECISION_METADATA = "MISSING_DECISION_METADATA";

const sha256Text = (value) => createHash("sha256").update(value).digest("hex");

const sha256File = (path) =>
  existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;

const relativePath = (root, path) => relative(root, path).replaceAll("\\", "/");

const artifact = (root, path, publishEligible) => ({
  path: relativePath(root, path),
  present: existsSync(path),
  sha256: sha256File(path),
  ...(publishEligible === undefined ? {} : { publishEligible }),
});

const reportVerdict = (path) => {
  if (!existsSync(path)) return null;
  try {
    const verdict = JSON.parse(readFileSync(path, "utf8"))?.verdict;
    return QUALIFICATION_VERDICTS.has(verdict) ? verdict : null;
  } catch {
    return null;
  }
};

const hasDecisionMetadata = (value) => typeof value === "string" && value.trim().length > 0;

const validStartedRequestEvidence = (record) => {
  if (typeof record.requestBodyJson !== "string" || record.requestBodyJson.length === 0) return false;
  if (typeof record.requestBodySha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.requestBodySha256)) {
    return false;
  }
  if (sha256Text(record.requestBodyJson) !== record.requestBodySha256) return false;

  try {
    const requestBody = JSON.parse(record.requestBodyJson);
    return (
      requestBody !== null &&
      typeof requestBody === "object" &&
      !Array.isArray(requestBody) &&
      typeof requestBody.model === "string" &&
      requestBody.model.length > 0 &&
      requestBody.model === record.model
    );
  } catch {
    return false;
  }
};

const isInvocationRecord = (record) => {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (record.kind !== "p4-provider-invocation-v1") return false;
  if (record.phase !== "started" && record.phase !== "completed") return false;
  if (!Number.isInteger(record.sequence) || record.sequence < 1) return false;
  if (typeof record.timestamp !== "string" || record.timestamp.length === 0) return false;
  if (typeof record.provider !== "string" || record.provider.length === 0) return false;
  if (record.model !== null && (typeof record.model !== "string" || record.model.length === 0)) {
    return false;
  }

  if (record.phase === "started") return validStartedRequestEvidence(record);

  if (!Number.isInteger(record.durationMs) || record.durationMs < 0) return false;
  if (record.outcome === "http_response") {
    return Number.isInteger(record.httpStatus) && record.httpStatus >= 100 && record.httpStatus <= 599;
  }
  if (record.outcome === "network_error") {
    return typeof record.errorName === "string" && record.errorName.length > 0;
  }
  return false;
};

const invocationSummary = (path) => {
  if (!existsSync(path)) {
    return {
      present: false,
      sha256: null,
      startedCount: 0,
      completedCount: 0,
      invalidRecordCount: 0,
      models: [],
    };
  }

  const text = readFileSync(path, "utf8");
  const startedBySequence = new Map();
  const completedSequences = new Set();
  const modelsByIdentity = new Map();
  let startedCount = 0;
  let completedCount = 0;
  let invalidRecordCount = 0;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      invalidRecordCount += 1;
      continue;
    }

    if (!isInvocationRecord(record)) {
      invalidRecordCount += 1;
      continue;
    }

    if (record.phase === "started") {
      startedCount += 1;
      if (startedBySequence.has(record.sequence)) {
        invalidRecordCount += 1;
        continue;
      }
      startedBySequence.set(record.sequence, record);
      modelsByIdentity.set(`${record.provider}:${record.model ?? ""}`, {
        provider: record.provider,
        model: record.model,
      });
      continue;
    }

    completedCount += 1;
    const started = startedBySequence.get(record.sequence);
    if (!started || completedSequences.has(record.sequence)) {
      invalidRecordCount += 1;
      continue;
    }

    completedSequences.add(record.sequence);
    if (started.provider !== record.provider || started.model !== record.model) {
      invalidRecordCount += 1;
    }
  }

  for (const sequence of startedBySequence.keys()) {
    if (!completedSequences.has(sequence)) invalidRecordCount += 1;
  }

  return {
    present: text.trim() !== "",
    sha256: sha256File(path),
    startedCount,
    completedCount,
    invalidRecordCount,
    models: [...modelsByIdentity.values()],
  };
};

const failureCode = (stderr, exitCode) => {
  if (exitCode === 0) return null;
  return stderr.match(FAILURE_CODE_PATTERN)?.at(-1) ?? "UNCLASSIFIED_COMMAND_FAILURE";
};

export function buildEvidenceManifest({
  sourceDir,
  runId,
  runAttempt,
  sourceSha,
  transferArtifact,
  decisionOwner,
  decisionRef,
  startedAt,
  completedAt,
  exitCode,
  stderrSha256,
  failureReasonCode,
}) {
  const outputDir = join(sourceDir, "p4-output");
  const reportPath = join(outputDir, `qualification-${runId}-${runAttempt}.json`);
  const admissionPath = join(outputDir, `admission-${runId}-${runAttempt}.json`);
  const invocationPath = join(outputDir, `invocations-${runId}-${runAttempt}.ndjson`);
  const invocations = invocationSummary(invocationPath);
  const report = artifact(sourceDir, reportPath);
  const verdict = reportVerdict(reportPath);
  const admissionPresent = existsSync(admissionPath);
  const decisionOwnerPresent = hasDecisionMetadata(decisionOwner);
  const decisionRefPresent = hasDecisionMetadata(decisionRef);
  const commandExitCode = Number.isInteger(exitCode) && exitCode >= 0 ? exitCode : 2;
  const completeSuccessEvidence =
    verdict === "PASS" &&
    admissionPresent &&
    decisionOwnerPresent &&
    decisionRefPresent &&
    invocations.present &&
    invocations.startedCount > 0 &&
    invocations.startedCount === invocations.completedCount &&
    invocations.invalidRecordCount === 0;
  const success = commandExitCode === 0 && completeSuccessEvidence;
  const terminalFailureCode = success
    ? null
    : commandExitCode === 0
      ? "QUALIFICATION_EVIDENCE_INCOMPLETE"
      : verdict && verdict !== "PASS"
        ? `QUALIFICATION_${verdict}`
        : failureReasonCode;

  return {
    contractVersion: P4_EVIDENCE_CONTRACT_VERSION,
    workflow: {
      runId: String(runId),
      producerRunAttempt: Number(runAttempt),
      qualificationSourceSha: sourceSha,
    },
    decision: {
      owner: decisionOwnerPresent ? decisionOwner : MISSING_DECISION_METADATA,
      ref: decisionRefPresent ? decisionRef : MISSING_DECISION_METADATA,
    },
    qualification: {
      executionOutcome: success ? "success" : "failure",
      verdict,
      startedAt,
      completedAt,
      commandExitCode,
      failureReasonCode: terminalFailureCode,
      failureMessageSha256: success ? null : stderrSha256,
      policyFileSha256: sha256File(join(sourceDir, "config/p4-qualification-policy.json")),
    },
    invocations: {
      path: relativePath(sourceDir, invocationPath),
      ...invocations,
    },
    artifacts: {
      report,
      admission: artifact(sourceDir, admissionPath, success && admissionPresent),
    },
    release: {
      tag: `p4-qualification-${runId}-${runAttempt}`,
      transferArtifact,
    },
  };
}

const runQualification = async (sourceDir) => {
  const root = resolve(sourceDir);
  const runId = process.env.GITHUB_RUN_ID;
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
  const sourceSha = process.env.P4_QUALIFICATION_SOURCE_SHA;
  const transferArtifact = process.env.P4_TRANSFER_ARTIFACT;
  if (!runId || !runAttempt || !sourceSha || !transferArtifact) {
    throw new Error("P4 workflow identity is incomplete.");
  }

  const outputDir = join(root, "p4-output");
  mkdirSync(outputDir, { recursive: true });
  const reportPath = join(outputDir, `qualification-${runId}-${runAttempt}.json`);
  const admissionPath = join(outputDir, `admission-${runId}-${runAttempt}.json`);
  const invocationPath = join(outputDir, `invocations-${runId}-${runAttempt}.ndjson`);
  const manifestPath = join(outputDir, "evidence-manifest.json");
  const preload = join(dirname(fileURLToPath(import.meta.url)), "p4-provider-invocation-audit.cjs");
  const stderrHash = createHash("sha256");
  let stderr = "";
  let exitCode = 2;
  let spawnError = null;
  const startedAt = new Date().toISOString();

  const child = spawn("pnpm", ["qualify:models"], {
    cwd: root,
    env: {
      ...process.env,
      P4_QUALIFICATION_REPORT: relativePath(root, reportPath),
      P4_PRODUCTION_MODEL_ADMISSION_OUTPUT: relativePath(root, admissionPath),
      P4_INVOCATION_AUDIT: invocationPath,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${preload}`].filter(Boolean).join(" "),
    },
    stdio: ["inherit", "inherit", "pipe"],
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    stderrHash.update(chunk);
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-131072);
  });

  await new Promise((done) => {
    child.on("error", (error) => {
      spawnError = error;
      const message = error instanceof Error ? error.message : String(error);
      stderrHash.update(message);
      stderr = `${stderr}${message}`.slice(-131072);
      done();
    });
    child.on("close", (code) => {
      exitCode = Number.isInteger(code) && code >= 0 ? code : 2;
      done();
    });
  });

  const manifest = buildEvidenceManifest({
    sourceDir: root,
    runId,
    runAttempt,
    sourceSha,
    transferArtifact,
    decisionOwner: process.env.P4_ADMISSION_DECISION_OWNER,
    decisionRef: process.env.P4_ADMISSION_DECISION_REF,
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode,
    stderrSha256:
      exitCode === 0 && !spawnError ? null : stderrHash.digest("hex"),
    failureReasonCode: spawnError
      ? "QUALIFICATION_COMMAND_START_FAILED"
      : failureCode(stderr, exitCode),
  });

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.exitCode = manifest.qualification.executionOutcome === "success" ? 0 : 2;
};

const args = process.argv.slice(2);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceIndex = args.indexOf("--source-dir");
  if (args[0] !== "run" || sourceIndex < 0 || !args[sourceIndex + 1]) {
    console.error("Usage: p4-qualification-evidence.mjs run --source-dir <path>");
    process.exitCode = 2;
  } else {
    runQualification(args[sourceIndex + 1]).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 2;
    });
  }
}
