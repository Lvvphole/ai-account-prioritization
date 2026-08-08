import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  parseProductionModelAdmission,
  productionModelAdmissionHash,
} from "agent-runtime";
import { parseModelQualificationConfig } from "./qualification-contract";
import {
  buildProductionModelAdmission,
  parseQualificationReportForAdmission,
} from "./production-admission";

const requiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

async function main(): Promise<void> {
  const configPath = resolve(requiredEnv("P4_QUALIFICATION_CONFIG"));
  const reportPath = resolve(requiredEnv("P4_QUALIFICATION_REPORT"));
  const candidateId = requiredEnv("P4_ADMISSION_CANDIDATE_ID");
  const decisionOwner = requiredEnv("P4_ADMISSION_DECISION_OWNER");
  const decisionRef = requiredEnv("P4_ADMISSION_DECISION_REF");
  const outputPath = resolve(
    process.env.P4_PRODUCTION_MODEL_ADMISSION_OUTPUT?.trim() ||
      "config/production-model-admission.json",
  );

  if (existsSync(outputPath) && process.env.P4_ADMISSION_REPLACE_EXISTING !== "true") {
    throw new Error(
      `Production admission already exists at ${outputPath}. Set P4_ADMISSION_REPLACE_EXISTING=true only for an explicit replacement decision.`,
    );
  }

  const config = parseModelQualificationConfig(
    JSON.parse(readFileSync(configPath, "utf8")) as unknown,
  );
  const report = parseQualificationReportForAdmission(
    JSON.parse(readFileSync(reportPath, "utf8")) as unknown,
  );
  const admission = parseProductionModelAdmission(
    buildProductionModelAdmission(config, report, {
      candidateId,
      decisionOwner,
      decisionRef,
    }),
  );

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(admission, null, 2)}\n`, "utf8");

  // eslint-disable-next-line no-console
  console.log(`P4 production model admission: ADMITTED ${admission.candidateId}`);
  // eslint-disable-next-line no-console
  console.log(`Provider/model: ${admission.provider}/${admission.modelId}`);
  // eslint-disable-next-line no-console
  console.log(`Admission hash: ${productionModelAdmissionHash(admission)}`);
  // eslint-disable-next-line no-console
  console.log(`Output: ${outputPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
