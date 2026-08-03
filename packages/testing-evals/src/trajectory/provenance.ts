import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const ManifestSchema = z
  .object({
    version: z.literal("trajectory-corpus-v2"),
    corpusKind: z.literal("synthetic-canonical-state-policy-regression"),
    inputContractVersion: z.literal("current-input-contract-v2"),
    oracleClass: z.literal(
      "policy-lock-regression-not-independent-ground-truth",
    ),
    seed: z.literal(23),
    caseCount: z.literal(500),
    evaluationNow: z.string().datetime(),
    expectedMaxRecommendations: z.literal(25),
    oracleSha256: z.string().regex(/^[a-f0-9]{64}$/),
    datasetProfileSha256: z.string().regex(/^[a-f0-9]{64}$/),
    scoreRoundingCorrections: z.record(z.number().min(0).max(100)).default({}),
    sourceDataset: z.object({
      file: z.literal("sales_pipeline.csv"),
      records: z.literal(8800),
      fields: z.literal(8),
      role: z.literal("shape-reference-only"),
      contentSha256: z.null(),
      recordMapping: z.literal("none"),
      reproducibleFromCommittedArtifacts: z.literal(false),
    }),
  })
  .strict();

const DatasetProfileSchema = z
  .object({
    provenance_classification: z.literal("source-shape-reference-only"),
    source_file: z.literal("sales_pipeline.csv"),
    source_content_sha256: z.null(),
    source_to_case_mapping: z.literal("none"),
    generator_reproducible_from_committed_artifacts: z.literal(false),
    actual_source_shape: z.object({
      records: z.literal(8800),
      fields: z.literal(8),
      field_names: z.array(z.string()).length(8),
    }),
    synthetic_generation: z.object({
      classification: z.literal("reverse-generated-policy-lock"),
      input_contract_version: z.literal("current-input-contract-v2"),
      runtime_eval_cases: z.literal(500),
      seed: z.literal(23),
      evaluation_now: z.string().datetime(),
    }),
  })
  .passthrough();

export type TrajectoryProvenanceManifest = z.infer<typeof ManifestSchema>;

function fixtureRoot(): string {
  const packageRoot = resolve(process.cwd(), "src/fixtures/trajectory");
  if (existsSync(packageRoot)) return packageRoot;
  const repositoryRoot = resolve(
    process.cwd(),
    "packages/testing-evals/src/fixtures/trajectory",
  );
  if (existsSync(repositoryRoot)) return repositoryRoot;
  throw new Error(
    `Trajectory fixture directory not found from cwd=${process.cwd()}.`,
  );
}

const readFixture = (name: string): string =>
  readFileSync(resolve(fixtureRoot(), name), "utf8");

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export function loadTrajectoryProvenance(): {
  manifest: TrajectoryProvenanceManifest;
} {
  const manifest = ManifestSchema.parse(
    JSON.parse(readFixture("manifest.json")),
  );
  const profileText = readFixture("dataset_profile.json");

  if (sha256(profileText) !== manifest.datasetProfileSha256) {
    throw new Error("Trajectory dataset profile hash mismatch.");
  }

  const profile = DatasetProfileSchema.parse(JSON.parse(profileText));
  if (
    profile.source_file !== manifest.sourceDataset.file ||
    profile.actual_source_shape.records !== manifest.sourceDataset.records ||
    profile.actual_source_shape.fields !== manifest.sourceDataset.fields
  ) {
    throw new Error(
      "Trajectory source-shape profile does not match the manifest.",
    );
  }
  if (
    profile.synthetic_generation.runtime_eval_cases !== manifest.caseCount ||
    profile.synthetic_generation.seed !== manifest.seed ||
    profile.synthetic_generation.evaluation_now !== manifest.evaluationNow
  ) {
    throw new Error(
      "Trajectory synthetic-generation profile does not match the manifest.",
    );
  }

  return { manifest };
}
