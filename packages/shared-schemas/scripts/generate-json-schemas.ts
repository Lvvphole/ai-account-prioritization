/**
 * generate-json-schemas.ts
 *
 * Emits JSON Schema artifacts from the authoritative Zod schemas.
 * Run via: pnpm generate:schemas
 *
 * Outputs to BOTH consumers (Schema Path, handoff §10):
 *   - packages/shared-schemas/generated/json-schema
 *   - apps/api-python/src/schemas/generated
 *
 * Deterministic: schemas are sorted by name and serialized with stable spacing
 * so repeated runs produce byte-identical output (no spurious git diffs).
 */
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";

import { SCHEMA_REGISTRY } from "../src/index";

const repoRoot = resolve(__dirname, "..", "..", "..");

const OUTPUT_DIRS = [
  resolve(__dirname, "..", "generated", "json-schema"),
  join(repoRoot, "apps", "api-python", "src", "schemas", "generated"),
];

function resetDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
}

function main(): void {
  const names = Object.keys(SCHEMA_REGISTRY).sort();
  const manifest: { generatedAt: string; schemas: string[] } = {
    // Fixed timestamp keyword to keep output deterministic; the real run time
    // lives in the verification report, not in committed schema artifacts.
    generatedAt: "DETERMINISTIC",
    schemas: names,
  };

  for (const dir of OUTPUT_DIRS) {
    resetDir(dir);

    for (const name of names) {
      const schema = SCHEMA_REGISTRY[name as keyof typeof SCHEMA_REGISTRY];
      const jsonSchema = zodToJsonSchema(schema, {
        name,
        target: "jsonSchema7",
        $refStrategy: "none",
      });
      const file = join(dir, `${name}.json`);
      writeFileSync(file, JSON.stringify(jsonSchema, null, 2) + "\n", "utf8");
    }

    writeFileSync(
      join(dir, "index.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8",
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[generate:schemas] wrote ${names.length} schemas to ${OUTPUT_DIRS.length} targets:\n` +
      names.map((n) => `  - ${n}`).join("\n"),
  );
}

main();
