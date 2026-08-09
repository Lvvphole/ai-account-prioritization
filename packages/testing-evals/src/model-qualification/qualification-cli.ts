import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { prepareProductionAdmissionOutput } from "./admission-output-lifecycle";
import { parseModelQualificationConfig } from "./qualification-contract";
import { createNetworkQualificationResolver } from "./qualification-provider-clients";
import { runLockedP4QualificationEpoch } from "./locked-qualification";

const CANONICAL_P4_QUALIFICATION_POLICY = "config/p4-qualification-policy.json";

const boolFromEnv = (value: string | undefined): boolean => {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`Invalid boolean environment value: ${value}`);
};

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
  const replaceExisting = boolFromEnv(process.env.P4_ADMISSION_REPLACE_EXISTING);

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

  // A replacement decision revokes the previous admission before provider spend.
  // This keeps the replacement path fail-closed if qualification blocks or the
  // process fails before a new admission artifact is written.
  const revokedExistingAdmission = prepareProductionAdmissionOutput(
    admissionPath,
    replaceExisting,
  );

  const result = await runLockedP4QualificationEpoch(
    config,
    createNetworkQualificationResolver(process.env),
    decision,
  );

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");

  if (result.admission) {
    mkdirSync(dirname(admissionPath), { recursive: true });
    writeFileSync(admissionPath, `${JSON.stringify(result.admission, null, 2)}\n`, "utf8");
  }

  // eslint-disable-next-line no-console
  console.log(`P4 locked qualification epoch: ${result.verdict}`);
  if (revokedExistingAdmission) {
    // eslint-disable-next-line no-console
    console.log(`Previous production admission revoked before qualification: ${admissionPath}`);
  }
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
    console.log(`Production admission: ${admissionPath}`);
  }

  process.exitCode = result.verdict === "PASS" ? 0 : 2;
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
