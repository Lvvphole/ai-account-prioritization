import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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

/** Write one immutable admission artifact without overwriting an existing file. */
export function writeProductionAdmissionOutput(
  admissionPath: string,
  serializedAdmission: string,
): void {
  mkdirSync(dirname(admissionPath), { recursive: true });
  writeFileSync(admissionPath, serializedAdmission, {
    encoding: "utf8",
    flag: "wx",
  });
}
