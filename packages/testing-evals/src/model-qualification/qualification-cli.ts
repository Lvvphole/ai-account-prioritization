import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  prepareQualificationOutputPaths,
  releaseQualificationOutputPaths,
  writeProductionAdmissionOutput,
  writeQualificationReportOutput,
} from "./admission-output-lifecycle";
import { parseModelQualificationConfig } from "./qualification-contract";
import { createNetworkQualificationResolver } from "./qualification-provider-clients";
import { runLockedP4QualificationEpoch } from "./locked-qualification";

const CANONICAL_P4_QUALIFICATION_POLICY = "config/p4-qualification-policy.json";

const required = (value: string | undefined, name: string): string => {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value;
};

async function main(): Promise<void> {
  const configPath = resolve(CANONICAL_P4_QUALIFICATION_POLICY);
  const reportPath = resolve(
    process.env.P4_QUALIFICATION_REPORT ??
      `packages/testing-evals/src/eval-results/model-qualification-${Date.now()}.json`,
  );
  const admissionPath = resolve(
    process.env.P4_PRODUCTION_MODEL_ADMISSION_OUTPUT ?? "config/production-model-admission.json",
  );

  const config = parseModelQualificationConfig(
    JSON.parse(readFileSync(configPath, "utf8")) as unknown,
  );
  const decision = {
    decisionOwner: required(
      process.env.P4_ADMISSION_DECISION_OWNER,
      "P4_ADMISSION_DECISION_OWNER",
    ),
    decisionRef: required(process.env.P4_ADMISSION_DECISION_REF, "P4_ADMISSION_DECISION_REF"),
  };

  // Reserve both immutable outputs before any provider spend. A concurrent
  // qualification process that targets either destination must fail here.
  const outputReservation = prepareQualificationOutputPaths(reportPath, admissionPath);
  try {
    const result = await runLockedP4QualificationEpoch(
      config,
      createNetworkQualificationResolver(process.env),
      decision,
    );

    writeQualificationReportOutput(reportPath, `${JSON.stringify(result.report, null, 2)}\n`);

    if (result.admission) {
      writeProductionAdmissionOutput(
        admissionPath,
        `${JSON.stringify(result.admission, null, 2)}\n`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(`P4 locked qualification epoch: ${result.verdict}`);
    for (const candidate of result.report.candidates) {
      // eslint-disable-next-line no-console
      console.log(
        `${candidate.candidate.id}: ${candidate.verdict}` +
          (candidate.reasons.length ? ` (${candidate.reasons.join(",")})` : ""),
      );
    }
    // eslint-disable-next-line no-console
    console.log(`Selected: ${result.selectedCandidateId ?? "BLOCK/template"}`);
    // eslint-disable-next-line no-console
    console.log(`Audit report: ${reportPath}`);
    if (result.admission) {
      // eslint-disable-next-line no-console
      console.log(`Production admission artifact: ${admissionPath}`);
    }

    process.exitCode = result.verdict === "PASS" ? 0 : 2;
  } finally {
    releaseQualificationOutputPaths(outputReservation);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
