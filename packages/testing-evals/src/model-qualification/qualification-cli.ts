import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  parseModelQualificationConfig,
  type QualificationOverallVerdict,
} from "./qualification-contract";
import { createNetworkQualificationResolver } from "./qualification-provider-clients";
import { runCurrentSpineModelQualification } from "./qualification-runner";

const exitCodeFor = (verdict: QualificationOverallVerdict): number =>
  verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 2;

async function main(): Promise<void> {
  const configPath = process.env.P4_QUALIFICATION_CONFIG;
  if (!configPath) {
    throw new Error(
      "P4_QUALIFICATION_CONFIG is required. Point it to a locked qualification JSON contract.",
    );
  }

  const absoluteConfigPath = resolve(configPath);
  const config = parseModelQualificationConfig(
    JSON.parse(readFileSync(absoluteConfigPath, "utf8")) as unknown,
  );
  const report = await runCurrentSpineModelQualification(
    config,
    createNetworkQualificationResolver(process.env),
  );
  const outputPath = resolve(
    process.env.P4_QUALIFICATION_REPORT ??
      `packages/testing-evals/src/eval-results/model-qualification-${Date.now()}.json`,
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  // eslint-disable-next-line no-console
  console.log(`P4 offline model qualification: ${report.verdict}`);
  for (const candidate of report.candidates) {
    // eslint-disable-next-line no-console
    console.log(
      `${candidate.candidate.id}: ${candidate.verdict}` +
        (candidate.reasons.length ? ` (${candidate.reasons.join(",")})` : ""),
    );
  }
  // eslint-disable-next-line no-console
  console.log(`Report: ${outputPath}`);
  process.exitCode = exitCodeFor(report.verdict);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
