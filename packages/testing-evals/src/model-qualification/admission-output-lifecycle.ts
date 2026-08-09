import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const requireUnusedOutput = (path: string, label: string): void => {
  if (!existsSync(path)) return;
  throw new Error(`${label} already exists at ${path}. Choose a new unused output path.`);
};

/**
 * Validate qualification output paths before provider spend.
 *
 * Audit reports and admission artifacts are immutable. Current P4 does not
 * overwrite, revoke, or hot-replace either artifact type.
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
  requireUnusedOutput(reportPath, "Qualification report output");
  prepareProductionAdmissionOutput(admissionPath);
}

/**
 * Require a new admission artifact path before qualification spends provider
 * tokens. Current P4 does not hot-replace or revoke an active admission.
 */
export function prepareProductionAdmissionOutput(admissionPath: string): void {
  if (!existsSync(admissionPath)) return;

  throw new Error(
    `Production admission output already exists at ${admissionPath}. Current P4 does not hot-replace or revoke active admissions. Choose a new unused P4_PRODUCTION_MODEL_ADMISSION_OUTPUT path.`,
  );
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
