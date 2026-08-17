import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseModelQualificationConfig } from "./qualification-contract";
import { createNetworkQualificationResolver } from "./qualification-provider-clients";
import { runQualificationReportOnly } from "./qualification-report";

const CANONICAL_P4_QUALIFICATION_POLICY = "config/p4-qualification-policy.json";

async function main(): Promise<void> {
  const configPath = resolve(CANONICAL_P4_QUALIFICATION_POLICY);
  const reportPath = resolve(
    process.env.P4_QUALIFICATION_REPORT ??
      `packages/testing-evals/src/eval-results/model-qualification-${Date.now()}.json`,
  );
  const config = parseModelQualificationConfig(
    JSON.parse(readFileSync(configPath, "utf8")) as unknown,
  );
  const report = await runQualificationReportOnly(
    config,
    createNetworkQualificationResolver(process.env),
    reportPath,
  );

  // eslint-disable-next-line no-console
  console.log(`P4 qualification-only epoch: ${report.verdict}`);
  for (const candidate of report.candidates) {
    // eslint-disable-next-line no-console
    console.log(
      `${candidate.candidate.id}: ${candidate.verdict}` +
        (candidate.reasons.length ? ` (${candidate.reasons.join(",")})` : ""),
    );
  }
  // eslint-disable-next-line no-console
  console.log(`Audit report: ${reportPath}`);

  process.exitCode = report.verdict === "PASS" ? 0 : 2;
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
