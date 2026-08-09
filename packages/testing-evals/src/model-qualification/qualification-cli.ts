import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseModelQualificationConfig } from "./qualification-contract";
import { createNetworkQualificationResolver } from "./qualification-provider-clients";
import { runLockedP4QualificationEpoch } from "./locked-qualification";

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
  const configPath = resolve(
    process.env.P4_QUALIFICATION_CONFIG ?? "config/p4-qualification-policy.json",
  );
  const reportPath = resolve(
    process.env.P4_QUALIFICATION_REPORT ??
      `packages/testing-evals/src/eval-results/model-qualification-${Date.now()}.json`,
  );
  const admissionPath = resolve(
    process.env.P4_PRODUCTION_MODEL_ADMISSION_OUTPUT ?? "config/production-model-admission.json",
  );
  const replaceExisting = boolFromEnv(process.env.P4_ADMISSION_REPLACE_EXISTING);

  // Refuse replacement before any provider spend. A new admission requires an
  // explicit replacement decision even though the artifact contains no secret.
  if (existsSync(admissionPath) && !replaceExisting) {
    throw new Error(
      `Production admission already exists at ${admissionPath}. Set P4_ADMISSION_REPLACE_EXISTING=true only for an explicit replacement decision.`,
    );
  }

  const config = parseModelQualificationConfig(
    JSON.parse(readFileSync(configPath, "utf8")) as unknown,
  );
  const result = await runLockedP4QualificationEpoch(
    config,
    createNetworkQualificationResolver(process.env),
    {
      decisionOwner: required(
        process.env.P4_ADMISSION_DECISION_OWNER,
        "P4_ADMISSION_DECISION_OWNER",
      ),
      decisionRef: required(process.env.P4_ADMISSION_DECISION_REF, "P4_ADMISSION_DECISION_REF"),
    },
  );

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");

  if (result.admission) {
    mkdirSync(dirname(admissionPath), { recursive: true });
    writeFileSync(admissionPath, `${JSON.stringify(result.admission, null, 2)}\n`, "utf8");
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
    console.log(`Production admission: ${admissionPath}`);
  }

  process.exitCode = result.verdict === "PASS" ? 0 : 2;
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
