import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const requireUnusedOutput = (path: string, label: string): void => {
  if (!existsSync(path)) return;
  throw new Error(`${label} already exists at ${path}. Choose a new unused output path.`);
};

const validateOutputParentCreatable = (path: string): void => {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  const probeDir = mkdtempSync(join(parent, ".p4-output-probe-"));
  try {
    writeFileSync(join(probeDir, "probe"), "", {
      encoding: "utf8",
      flag: "wx",
    });
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
};

const validateUnusedCreatableOutput = (path: string, label: string): void => {
  requireUnusedOutput(path, label);
  validateOutputParentCreatable(path);
};

/**
 * Validate qualification output paths before provider spend.
 *
 * Audit reports and admission artifacts are immutable. Current P4 does not
 * overwrite, revoke, or hot-replace either artifact type. Parent creatability is
 * verified before qualification so a passing epoch cannot fail only when it
 * attempts to persist its outputs.
 */
export function prepareQualificationOutputPaths(
  reportPath: string,
  admissionPath: string,
): void {
  if (reportPath === admissionPath) {
    throw new Error(
      "P4_QUALIFICATION_REPORT and P4_PRODUCTION_MODEL_ADMISSION_OUTPUT must resolve to different paths.",
    );
  }
  validateUnusedCreatableOutput(reportPath, "Qualification report output");
  validateUnusedCreatableOutput(admissionPath, "Production admission output");
}

/**
 * Require a new creatable admission artifact path before qualification spends
 * provider tokens. Current P4 does not hot-replace or revoke an active admission.
 */
export function prepareProductionAdmissionOutput(admissionPath: string): void {
  if (existsSync(admissionPath)) {
    throw new Error(
      `Production admission output already exists at ${admissionPath}. Current P4 does not hot-replace or revoke active admissions. Choose a new unused P4_PRODUCTION_MODEL_ADMISSION_OUTPUT path.`,
    );
  }
  validateOutputParentCreatable(admissionPath);
}

const writeImmutableOutput = (path: string, serialized: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialized, {
    encoding: "utf8",
    flag: "wx",
  });
};

/** Write one immutable qualification report without overwriting audit evidence. */
export function writeQualificationReportOutput(
  reportPath: string,
  serializedReport: string,
): void {
  writeImmutableOutput(reportPath, serializedReport);
}

/** Write one immutable admission artifact without overwriting an existing file. */
export function writeProductionAdmissionOutput(
  admissionPath: string,
  serializedAdmission: string,
): void {
  writeImmutableOutput(admissionPath, serializedAdmission);
}
