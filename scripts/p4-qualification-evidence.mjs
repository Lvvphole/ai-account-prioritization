#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const P4_EVIDENCE_CONTRACT_VERSION = "p4-qualification-evidence-v1";

const FAILURE_CODE_PATTERN = /(QUALIFICATION_[A-Z0-9_]+|DRAFT_MODEL_[A-Z0-9_]+|MISSING_CREDENTIAL)/g;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const PROVIDERS = new Set(["anthropic", "openai", "xai", "google"]);

const nonEmpty = (value, name) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
};

const positiveInteger = (value, name) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be positive.`);
  }
  return parsed;
};

const sha256File = (path) => {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
};

const safeRelativePath = (root, path) => {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const value = relative(resolvedRoot, resolvedPath).replaceAll("\\", "/");
  if (value === "" || value === ".." || value.startsWith("../") || isAbsolute(value)) {
    throw new Error(`Evidence path escapes source root: ${path}`);
  }
  return value;
};

const artifactDescriptor = (sourceDir, path, publishEligible = undefined) => {
  const present = existsSync(path);
  const descriptor = {
    path: safeRelativePath(sourceDir, path),
    present,
    sha256: present ? sha256File(path) : null,
  };
  return publishEligible === undefined ? descriptor : { ...descriptor, publishEligible };
};

const parseInvocationAudit = (path) => {
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
  if (text.trim() === "") {
    return {
      present: false,
      sha256: sha256File(path),
      startedCount: 0,
      completedCount: 0,
      invalidRecordCount: 0,
      models: [],
    };
  }

  const rows = [];
  let invalidRecordCount = 0;
  for (const line of text.split("\n").filter((item) => item.trim() !== "")) {
    try {
      const row = JSON.parse(line);
      if (!row || row.kind !== "p4-provider-invocation-v1") {
        invalidRecordCount += 1;
        continue;
      }
      rows.push(row);
    } catch {
      invalidRecordCount += 1;
    }
  }

  const started = rows.filter((row) => row.phase === "started");
  const completed = rows.filter((row) => row.phase === "completed");
  const models = [
    ...new Map(
      started.map((row) => [
        `${row.provider}:${row.model ?? ""}`,
        { provider: row.provider, model: row.model ?? null },
      ]),
    ).values(),
  ].sort((a, b) => {
    const left = `${a.provider}:${a.model ?? ""}`;
    const right = `${b.provider}:${b.model ?? ""}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return {
    present: true,
    sha256: sha256File(path),
    startedCount: started.length,
    completedCount: completed.length,
    invalidRecordCount,
    models,
  };
};

const failureCodeFrom = (stderrText, exitCode) => {
  if (exitCode === 0) return null;
  const matches = stderrText.match(FAILURE_CODE_PATTERN);
  return matches?.at(-1) ?? "UNCLASSIFIED_COMMAND_FAILURE";
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
  const invocationAuditPath = join(outputDir, `invocations-${runId}-${runAttempt}.ndjson`);
  const policyPath = join(sourceDir, "config/p4-qualification-policy.json");
  const invocations = parseInvocationAudit(invocationAuditPath);
  const report = artifactDescriptor(sourceDir, reportPath);
  const admissionPresent = existsSync(admissionPath);

  let outcome = exitCode === 0 ? "success" : "failure";
  let effectiveExitCode = exitCode;
  let effectiveFailureCode = failureReasonCode;

  const successEvidenceComplete =
    report.present &&
    admissionPresent &&
    invocations.present &&
    invocations.startedCount > 0 &&
    invocations.startedCount === invocations.completedCount &&
    invocations.invalidRecordCount === 0;

  if (outcome === "success" && !successEvidenceComplete) {
    outcome = "failure";
    effectiveExitCode = 2;
    effectiveFailureCode = "QUALIFICATION_EVIDENCE_INCOMPLETE";
  } else if (invocations.invalidRecordCount > 0) {
    outcome = "failure";
    effectiveExitCode = 2;
    effectiveFailureCode = "QUALIFICATION_INVOCATION_AUDIT_INVALID";
  }

  const manifest = {
    contractVersion: P4_EVIDENCE_CONTRACT_VERSION,
    workflow: {
      runId: String(runId),
      producerRunAttempt: runAttempt,
      qualificationSourceSha: sourceSha,
    },
    decision: {
      owner: decisionOwner || null,
      ref: decisionRef || null,
    },
    qualification: {
      outcome,
      startedAt,
      completedAt,
      exitCode: effectiveExitCode,
      failureReasonCode:
        outcome === "success" ? null : (effectiveFailureCode ?? "UNCLASSIFIED_COMMAND_FAILURE"),
      failureMessageSha256: outcome === "success" ? null : stderrSha256,
      policyFileSha256: sha256File(policyPath),
    },
    invocations: {
      path: safeRelativePath(sourceDir, invocationAuditPath),
      ...invocations,
    },
    artifacts: {
      report,
      admission: artifactDescriptor(
        sourceDir,
        admissionPath,
        outcome === "success" && admissionPresent,
      ),
    },
    release: {
      tag: `p4-qualification-${runId}-${runAttempt}`,
      transferArtifact,
    },
  };

  validateEvidenceManifest(manifest);
  return manifest;
}

const assertArtifact = (artifact, name) => {
  if (!artifact || typeof artifact !== "object") throw new Error(`${name} is required.`);
  if (typeof artifact.path !== "string" || !artifact.path.startsWith("p4-output/")) {
    throw new Error(`${name}.path must stay under p4-output/.`);
  }
  if (typeof artifact.present !== "boolean") {
    throw new Error(`${name}.present must be boolean.`);
  }
  if (artifact.present) {
    if (typeof artifact.sha256 !== "string" || !SHA256_PATTERN.test(artifact.sha256)) {
      throw new Error(`${name}.sha256 is invalid.`);
    }
  } else if (artifact.sha256 !== null) {
    throw new Error(`${name}.sha256 must be null when absent.`);
  }
};

export function validateEvidenceManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Evidence manifest must be an object.");
  }
  if (manifest.contractVersion !== P4_EVIDENCE_CONTRACT_VERSION) {
    throw new Error("Unsupported P4 evidence contract version.");
  }

  const runId = nonEmpty(manifest.workflow?.runId, "workflow.runId");
  const runAttempt = positiveInteger(
    manifest.workflow?.producerRunAttempt,
    "workflow.producerRunAttempt",
  );
  const sourceSha = nonEmpty(
    manifest.workflow?.qualificationSourceSha,
    "workflow.qualificationSourceSha",
  );
  if (!SHA_PATTERN.test(sourceSha)) throw new Error("workflow.qualificationSourceSha is invalid.");
  if (manifest.decision?.owner !== null) nonEmpty(manifest.decision?.owner, "decision.owner");
  if (manifest.decision?.ref !== null) nonEmpty(manifest.decision?.ref, "decision.ref");

  const qualification = manifest.qualification;
  if (!qualification || !["success", "failure"].includes(qualification.outcome)) {
    throw new Error("qualification.outcome is invalid.");
  }
  if (!Number.isSafeInteger(qualification.exitCode) || qualification.exitCode < 0) {
    throw new Error("qualification.exitCode is invalid.");
  }
  nonEmpty(qualification.startedAt, "qualification.startedAt");
  nonEmpty(qualification.completedAt, "qualification.completedAt");
  if (
    !SHA256_PATTERN.test(
      nonEmpty(qualification.policyFileSha256, "qualification.policyFileSha256"),
    )
  ) {
    throw new Error("qualification.policyFileSha256 is invalid.");
  }
  if (qualification.outcome === "success") {
    if (
      qualification.exitCode !== 0 ||
      qualification.failureReasonCode !== null ||
      qualification.failureMessageSha256 !== null
    ) {
      throw new Error("Successful qualification contains failure state.");
    }
  } else {
    nonEmpty(qualification.failureReasonCode, "qualification.failureReasonCode");
    if (
      qualification.failureMessageSha256 !== null &&
      !SHA256_PATTERN.test(qualification.failureMessageSha256)
    ) {
      throw new Error("qualification.failureMessageSha256 is invalid.");
    }
  }

  const invocations = manifest.invocations;
  if (!invocations || typeof invocations.path !== "string" || !invocations.path.startsWith("p4-output/")) {
    throw new Error("invocations.path is invalid.");
  }
  for (const [key, value] of [
    ["startedCount", invocations.startedCount],
    ["completedCount", invocations.completedCount],
    ["invalidRecordCount", invocations.invalidRecordCount],
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`invocations.${key} is invalid.`);
    }
  }
  if (typeof invocations.present !== "boolean") {
    throw new Error("invocations.present must be boolean.");
  }
  if (invocations.present) {
    if (!SHA256_PATTERN.test(nonEmpty(invocations.sha256, "invocations.sha256"))) {
      throw new Error("invocations.sha256 is invalid.");
    }
  } else if (
    invocations.startedCount !== 0 ||
    invocations.completedCount !== 0 ||
    invocations.invalidRecordCount !== 0
  ) {
    throw new Error("Absent invocation evidence contains invocation state.");
  }
  if (!Array.isArray(invocations.models)) throw new Error("invocations.models must be an array.");
  for (const model of invocations.models) {
    if (!PROVIDERS.has(model.provider)) {
      throw new Error("invocations.models provider is invalid.");
    }
    if (model.model !== null) nonEmpty(model.model, "invocations.models.model");
  }

  assertArtifact(manifest.artifacts?.report, "artifacts.report");
  assertArtifact(manifest.artifacts?.admission, "artifacts.admission");
  if (typeof manifest.artifacts.admission.publishEligible !== "boolean") {
    throw new Error("artifacts.admission.publishEligible must be boolean.");
  }

  if (manifest.release?.tag !== `p4-qualification-${runId}-${runAttempt}`) {
    throw new Error("release.tag is not bound to producer identity.");
  }
  if (
    nonEmpty(manifest.release?.transferArtifact, "release.transferArtifact") !==
    `p4-qualification-transfer-${runId}-${runAttempt}`
  ) {
    throw new Error("release.transferArtifact is not bound to producer identity.");
  }

  if (qualification.outcome === "success") {
    if (
      !manifest.artifacts.report.present ||
      !manifest.artifacts.admission.present ||
      !manifest.artifacts.admission.publishEligible ||
      !invocations.present ||
      invocations.startedCount === 0 ||
      invocations.startedCount !== invocations.completedCount ||
      invocations.invalidRecordCount !== 0
    ) {
      throw new Error("Successful qualification has incomplete evidence.");
    }
  } else if (manifest.artifacts.admission.publishEligible) {
    throw new Error("Failed qualification cannot publish an admission artifact.");
  }

  return manifest;
}

const runQualification = async ({ sourceDir }) => {
  const absoluteSourceDir = resolve(sourceDir);
  const runId = nonEmpty(process.env.GITHUB_RUN_ID, "GITHUB_RUN_ID");
  const runAttempt = positiveInteger(process.env.GITHUB_RUN_ATTEMPT, "GITHUB_RUN_ATTEMPT");
  const sourceSha = nonEmpty(
    process.env.P4_QUALIFICATION_SOURCE_SHA,
    "P4_QUALIFICATION_SOURCE_SHA",
  );
  const transferArtifact = nonEmpty(process.env.P4_TRANSFER_ARTIFACT, "P4_TRANSFER_ARTIFACT");
  const outputDir = join(absoluteSourceDir, "p4-output");
  mkdirSync(outputDir, { recursive: true });

  const reportPath = join(outputDir, `qualification-${runId}-${runAttempt}.json`);
  const admissionPath = join(outputDir, `admission-${runId}-${runAttempt}.json`);
  const invocationAuditPath = join(outputDir, `invocations-${runId}-${runAttempt}.ndjson`);
  const manifestPath = join(outputDir, "evidence-manifest.json");
  const auditPreloadPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "p4-provider-invocation-audit.cjs",
  );
  const stderrHash = createHash("sha256");
  let stderrText = "";
  const startedAt = new Date().toISOString();

  const childEnv = {
    ...process.env,
    P4_QUALIFICATION_REPORT: safeRelativePath(absoluteSourceDir, reportPath),
    P4_PRODUCTION_MODEL_ADMISSION_OUTPUT: safeRelativePath(absoluteSourceDir, admissionPath),
    P4_INVOCATION_AUDIT: invocationAuditPath,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${auditPreloadPath}`]
      .filter(Boolean)
      .join(" "),
  };

  let exitCode = 2;
  let spawnFailure = null;
  await new Promise((resolveChild) => {
    const child = spawn("pnpm", ["qualify:models"], {
      cwd: absoluteSourceDir,
      env: childEnv,
      stdio: ["inherit", "inherit", "pipe"],
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      stderrHash.update(chunk);
      stderrText = `${stderrText}${chunk.toString("utf8")}`.slice(-131072);
    });
    child.on("error", (error) => {
      spawnFailure = error;
      const message = error instanceof Error ? error.message : String(error);
      stderrHash.update(message);
      stderrText = `${stderrText}${message}`.slice(-131072);
      resolveChild();
    });
    child.on("close", (code) => {
      exitCode = Number.isSafeInteger(code) && code >= 0 ? code : 2;
      resolveChild();
    });
  });

  const completedAt = new Date().toISOString();
  const stderrSha256 = exitCode === 0 && !spawnFailure ? null : stderrHash.digest("hex");
  const failureReasonCode = spawnFailure
    ? "QUALIFICATION_COMMAND_START_FAILED"
    : failureCodeFrom(stderrText, exitCode);

  let manifest;
  try {
    manifest = buildEvidenceManifest({
      sourceDir: absoluteSourceDir,
      runId,
      runAttempt,
      sourceSha,
      transferArtifact,
      decisionOwner: process.env.P4_ADMISSION_DECISION_OWNER,
      decisionRef: process.env.P4_ADMISSION_DECISION_REF,
      startedAt,
      completedAt,
      exitCode,
      stderrSha256,
      failureReasonCode,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    manifest = {
      contractVersion: P4_EVIDENCE_CONTRACT_VERSION,
      workflow: {
        runId,
        producerRunAttempt: runAttempt,
        qualificationSourceSha: sourceSha,
      },
      decision: {
        owner: process.env.P4_ADMISSION_DECISION_OWNER || null,
        ref: process.env.P4_ADMISSION_DECISION_REF || null,
      },
      qualification: {
        outcome: "failure",
        startedAt,
        completedAt,
        exitCode: 2,
        failureReasonCode: "QUALIFICATION_EVIDENCE_BUILD_FAILED",
        failureMessageSha256: createHash("sha256").update(reason).digest("hex"),
        policyFileSha256: sha256File(
          join(absoluteSourceDir, "config/p4-qualification-policy.json"),
        ),
      },
      invocations: {
        path: safeRelativePath(absoluteSourceDir, invocationAuditPath),
        ...parseInvocationAudit(invocationAuditPath),
      },
      artifacts: {
        report: artifactDescriptor(absoluteSourceDir, reportPath),
        admission: artifactDescriptor(absoluteSourceDir, admissionPath, false),
      },
      release: {
        tag: `p4-qualification-${runId}-${runAttempt}`,
        transferArtifact,
      },
    };
    exitCode = 2;
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.exitCode = manifest.qualification.outcome === "success" ? 0 : (exitCode || 2);
};

const parseArgs = (argv) => {
  if (argv[0] !== "run") {
    throw new Error("Usage: p4-qualification-evidence.mjs run --source-dir <path>");
  }
  const index = argv.indexOf("--source-dir");
  if (index < 0 || !argv[index + 1]) throw new Error("--source-dir is required.");
  return { sourceDir: argv[index + 1] };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runQualification(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
}
