import {
  prepareQualificationReportOutput,
  releaseQualificationReportOutput,
  writeQualificationReportOutput,
} from "./admission-output-lifecycle";
import type {
  ModelQualificationConfig,
  QualificationClientResolver,
} from "./qualification-contract";
import {
  runCurrentSpineModelQualification,
  type ModelQualificationReport,
} from "./qualification-runner";

/**
 * Execute the canonical qualification evaluator and persist audit evidence only.
 * This boundary cannot create a production admission artifact.
 */
export async function runQualificationReportOnly(
  config: ModelQualificationConfig,
  resolveClient: QualificationClientResolver,
  reportPath: string,
  now: () => string = () => new Date().toISOString(),
): Promise<ModelQualificationReport> {
  const reservation = prepareQualificationReportOutput(reportPath);
  try {
    const report = await runCurrentSpineModelQualification(config, resolveClient, now);
    writeQualificationReportOutput(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    releaseQualificationReportOutput(reservation);
  }
}
