#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const P4_EVIDENCE_CONTRACT_VERSION = "p4-qualification-evidence-v1";

const FAILURE_CODE_PATTERN = /(QUALIFICATION_[A-Z0-9_]+|DRAFT_MODEL_[A-Z0-9_]+|MISSING_CREDENTIAL)/g;

const sha256File = (path) =>
  existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;

const relativePath = (root, path) => relative(root, path).replaceAll("\\", "/");

const artifact = (root, path, publishEligible) => ({
  path: relativePath(root, path),
  present: existsSync(path),
  sha256: sha256File(path),
  ...(publishEligible === undefined ? {} : { publishEligible }),
});

const invocationSummary = (path) => {
  if (!existsSync(path)) {
    return { present: false, sha256: null, startedCount: 0, completedCount: 0, models: [] };
  }

  const records = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record?.kind === "p4-provider-invocation-v1") records.push(record);
    } catch {
      // A malformed record makes started/completed counts differ or leaves evidence incomplete.
    }
  }

  const started = records.filter((record) => record.phase === "started");
  const completed = records.filter((record) => record.phase === "completed");
  const models = [
    ...new Map(
      started.map((record) => [
        `${record.provider}:${record.model ?? ""}`,
        { provider: record.provider, model: record.model ?? null },
      ]),
    ).values(),
  ];

  return {
    present: records.length > 0,
    sha256: sha256File(path),
    startedCount: started.length,
    completedCount: completed.length,
    models,
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
  const admissionPresent = existsSync(admissionPath);
  const completeSuccessEvidence =
    report.present &&
    admissionPresent &&
    invocations.present &&
    invocations.startedCount > 0 &&
    invocations.startedCount === invocations.completedCount;
  const success = exitCode === 0 && completeSuccessEvidence;

  return {
    contractVersion: P4_EVIDENCE_CONTRACT_VERSION,
    workflow: {
      runId: String(runId),
      producerRunAttempt: Number(runAttempt),
      qualificationSourceSha: sourceSha,
    },
    decision: {
      owner: decisionOwner || null,
      ref: decisionRef || null,
    },
    qualification: {
      outcome: success ? "success" : "failure",
      startedAt,
      completedAt,
      exitCode: success ? 0 : (exitCode || 2),
      failureReasonCode: success
        ? null
        : exitCode === 0
          ? "QUALIFICATION_EVIDENCE_INCOMPLETE"
          : failureReasonCode,
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
  process.exitCode = manifest.qualification.outcome === "success" ? 0 : 2;
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
