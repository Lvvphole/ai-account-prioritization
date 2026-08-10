import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface QualificationOutputReservation {
  reportLockPath: string;
  admissionLockPath: string;
}

const lockPathFor = (path: string): string => `${path}.p4-lock`;

const requireUnusedOutput = (path: string, label: string): void => {
  if (!existsSync(path)) return;
  throw new Error(`${label} already exists at ${path}. Choose a new unused output path.`);
};

const isNodeError = (error: unknown, code: string): error is NodeJS.ErrnoException =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === code;

const acquireOutputLock = (path: string, label: string): string => {
  const lockPath = lockPathFor(path);
  mkdirSync(dirname(path), { recursive: true });
  requireUnusedOutput(path, label);

  try {
    writeFileSync(lockPath, "", {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      throw new Error(
        `${label} is reserved by another qualification process at ${path}. Wait for that process to finish or choose a new unused output path.`,
      );
    }
    throw error;
  }

  try {
    requireUnusedOutput(path, label);
    return lockPath;
  } catch (error) {
    rmSync(lockPath, { force: true });
    throw error;
  }
};

const validateReservationPathSeparation = (
  reportPath: string,
  admissionPath: string,
): void => {
  const paths = [reportPath, admissionPath, lockPathFor(reportPath), lockPathFor(admissionPath)];
  if (new Set(paths).size !== paths.length) {
    throw new Error(
      "Qualification output paths must not collide with each other or with their reservation paths.",
    );
  }
};

/**
 * Reserve both qualification outputs before provider spend.
 *
 * The sidecar reservations use exclusive-create semantics. A concurrent
 * qualification process that targets either reserved destination fails before
 * it can invoke a provider. The final report and admission files remain absent
 * until the epoch persists them.
 */
export function prepareQualificationOutputPaths(
  reportPath: string,
  admissionPath: string,
): QualificationOutputReservation {
  if (reportPath === admissionPath) {
    throw new Error(
      "P4_QUALIFICATION_REPORT and P4_PRODUCTION_MODEL_ADMISSION_OUTPUT must resolve to different paths.",
    );
  }
  validateReservationPathSeparation(reportPath, admissionPath);

  const reportLockPath = acquireOutputLock(reportPath, "Qualification report output");
  try {
    const admissionLockPath = acquireOutputLock(admissionPath, "Production admission output");
    return { reportLockPath, admissionLockPath };
  } catch (error) {
    rmSync(reportLockPath, { force: true });
    throw error;
  }
}

/** Release only the sidecar reservations created by qualification preflight. */
export function releaseQualificationOutputPaths(
  reservation: QualificationOutputReservation,
): void {
  rmSync(reservation.reportLockPath, { force: true });
  rmSync(reservation.admissionLockPath, { force: true });
}

/**
 * Check that a successor admission path is unused and its parent is creatable.
 * This helper does not reserve the path for a qualification epoch.
 */
export function prepareProductionAdmissionOutput(admissionPath: string): void {
  if (existsSync(admissionPath)) {
    throw new Error(
      `Production admission output already exists at ${admissionPath}. Current P4 does not hot-replace or revoke active admissions. Choose a new unused P4_PRODUCTION_MODEL_ADMISSION_OUTPUT path.`,
    );
  }

  const lockPath = acquireOutputLock(admissionPath, "Production admission output");
  rmSync(lockPath, { force: true });
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
