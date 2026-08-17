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

export interface QualificationOnlyModelReport extends ModelQualificationReport {
  qualificationSource: {
    mode: "qualification_only";
    candidateSet: "qualificationOnlyCandidates";
    canonicalPolicyHash: string;
  };
}

const requireCanonicalPolicyHash = (value: string): string => {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("canonicalPolicyHash must be a lowercase SHA-256 digest.");
  }
  return value;
};

/**
 * Execute the canonical qualification evaluator and persist audit evidence only.
 * This boundary cannot create a production admission artifact.
 */
export async function runQualificationReportOnly(
  config: ModelQualificationConfig,
  resolveClient: QualificationClientResolver,
  reportPath: string,
  canonicalPolicyHash: string,
  now: () => string = () => new Date().toISOString(),
): Promise<QualificationOnlyModelReport> {
  const sourcePolicyHash = requireCanonicalPolicyHash(canonicalPolicyHash);
  const reservation = prepareQualificationReportOutput(reportPath);
  try {
    const baseReport = await runCurrentSpineModelQualification(config, resolveClient, now);
    const report: QualificationOnlyModelReport = {
      ...baseReport,
      qualificationSource: {
        mode: "qualification_only",
        candidateSet: "qualificationOnlyCandidates",
        canonicalPolicyHash: sourcePolicyHash,
      },
    };
    writeQualificationReportOutput(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    releaseQualificationReportOutput(reservation);
  }
}
