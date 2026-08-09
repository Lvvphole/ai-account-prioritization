import { existsSync, unlinkSync } from "node:fs";

/**
 * Prepare the production-admission output before a qualification epoch starts.
 *
 * An explicit replacement decision is fail-closed: remove the previous admission
 * before any provider spend. If the new epoch blocks or the process fails after
 * this point, the prior model does not retain admission authority.
 */
export function prepareProductionAdmissionOutput(
  admissionPath: string,
  replaceExisting: boolean,
): boolean {
  if (!existsSync(admissionPath)) return false;
  if (!replaceExisting) {
    throw new Error(
      `Production admission already exists at ${admissionPath}. Set P4_ADMISSION_REPLACE_EXISTING=true only for an explicit replacement decision.`,
    );
  }

  unlinkSync(admissionPath);
  return true;
}
