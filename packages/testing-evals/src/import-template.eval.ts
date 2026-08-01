import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AccountSchema,
  ActivitySchema,
  ContactSchema,
  OpportunitySchema,
  DEFAULT_IMPORT_LIMITS,
  IMPORT_TEMPLATES,
  IMPORT_TEMPLATE_KINDS,
  ImportTemplateSchema,
  checkTemplateHeaders,
  renderTemplateCell,
  renderTemplateCsv,
  requiredColumns,
  templateFilename,
} from "@repo/shared-schemas";
import type { ImportTemplateKind, ParsedRow, SourceFieldMapping } from "@repo/shared-schemas";
import { isAllowedUploadFilename, looksLikeFormula } from "@repo/security";
import { parseCsvStream, normalizeRow, validateBatch } from "agent-runtime";
import type { ValidationContext, NormalizedRow } from "agent-runtime";

/**
 * The template is a contract (spec section 7.2 step 2), and this file is what
 * makes it one.
 *
 * A downloadable template that disagrees with the validator is worse than no
 * template: it tells somebody exactly how to build a file and then refuses the
 * file they built. So the central test here does not inspect the template — it
 * runs the template's own bytes through the real parser, the real mapper and
 * the real validator, and fails if a file produced exactly as instructed does
 * not come out `ready`.
 */

const WORKSPACE = "ws-1";

/** The mapping a workspace gets when it adopts a template unchanged. */
function mappingFromTemplate(kind: ImportTemplateKind): SourceFieldMapping[] {
  const template = IMPORT_TEMPLATES[kind];
  const mappingVersionId = randomUUID();
  return template.columns.map((column) => ({
    id: randomUUID(),
    workspaceId: randomUUID(),
    mappingVersionId,
    objectType: template.objectType ?? "account",
    sourceField: column.canonicalField,
    canonicalField: column.canonicalField,
    disposition: "mapped" as const,
    transform: column.transform,
    required: column.required,
    // A template column is an explicit decision, not a suggestion the mapper
    // guessed at, so there is no confidence to report and nothing to warn about.
    suggestionConfidence: null,
    warning: null,
  }));
}

async function* bytesOf(text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text);
}

async function parseTemplate(kind: ImportTemplateKind): Promise<{
  rows: ParsedRow[];
  outcome: Awaited<ReturnType<typeof parseCsvStream>>;
}> {
  const rows: ParsedRow[] = [];
  const outcome = await parseCsvStream(
    bytesOf(renderTemplateCsv(kind)),
    (row) => rows.push(row),
    { limits: DEFAULT_IMPORT_LIMITS },
  );
  return { rows, outcome };
}

function ctxFor(normalized: NormalizedRow[]): ValidationContext {
  // Everything the examples reference is present, so the only findings that can
  // survive are ones the template itself causes.
  const owners = new Set<string>();
  const parents = new Set<string>();
  for (const row of normalized) {
    const owner = row.payload.ownerId;
    if (typeof owner === "string" && owner) owners.add(owner);
    const parent = row.payload.accountExternalId;
    if (typeof parent === "string" && parent) parents.add(parent);
  }
  return {
    workspaceId: WORKSPACE,
    knownExternalIds: new Set(),
    knownAccountExternalIds: parents,
    workspaceMemberIds: owners,
    baseline: { accountCount: 500, totalOpenPipelineUsd: 50_000_000 },
    now: new Date("2026-08-01T00:00:00.000Z"),
  };
}

describe("every template is a valid, self-consistent definition", () => {
  it.each(IMPORT_TEMPLATE_KINDS)("%s parses against its own schema", (kind) => {
    expect(() => ImportTemplateSchema.parse(IMPORT_TEMPLATES[kind])).not.toThrow();
  });

  it.each(IMPORT_TEMPLATE_KINDS)("%s has no repeated column", (kind) => {
    const names = IMPORT_TEMPLATES[kind].columns.map((c) => c.canonicalField);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(IMPORT_TEMPLATE_KINDS)("%s requires externalId", (kind) => {
    // Without it a re-import cannot match a record and creates a duplicate
    // instead of updating. Every template has to demand one.
    expect(requiredColumns(kind)).toContain("externalId");
  });

  it.each(IMPORT_TEMPLATE_KINDS)("%s fills every required column in its examples", (kind) => {
    for (const example of IMPORT_TEMPLATES[kind].examples) {
      for (const column of requiredColumns(kind)) {
        expect(example[column] ?? "").not.toBe("");
      }
    }
  });

  it.each(IMPORT_TEMPLATE_KINDS)("%s example values respect their own enums", (kind) => {
    for (const column of IMPORT_TEMPLATES[kind].columns) {
      if (!column.enumValues) continue;
      for (const example of IMPORT_TEMPLATES[kind].examples) {
        const value = example[column.canonicalField];
        if (value === undefined || value === "") continue;
        expect(column.enumValues).toContain(value);
      }
    }
  });

  it.each(IMPORT_TEMPLATE_KINDS)("%s downloads under a filename the uploader accepts", (kind) => {
    // A template whose own name the upload allowlist rejects is a trap: the
    // obvious thing to do with a downloaded template is upload it back.
    expect(isAllowedUploadFilename(templateFilename(kind))).toBe(true);
  });
});

describe("rendered templates are safe CSV", () => {
  it.each(IMPORT_TEMPLATE_KINDS)("%s emits no live formula cell", async (kind) => {
    const { rows } = await parseTemplate(kind);
    for (const row of rows) {
      for (const value of Object.values(row.values) as string[]) {
        // Cross-checked against @repo/security's rule rather than the copy in
        // the renderer, so the two cannot drift apart unnoticed.
        expect(looksLikeFormula(value)).toBe(false);
      }
    }
  });

  it.each([
    ["=cmd|'/c calc'!A0", "'=cmd|'/c calc'!A0"],
    ["+1234", "'+1234"],
    ["-5+cmd", "'-5+cmd"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\t=1+1", "'\t=1+1"],
  ])("neutralizes %j on the way out", (hostile: string, expected: string) => {
    // Every shipped example is benign, so the guard would otherwise be
    // exercised only by input that never reaches it.
    expect(renderTemplateCell(hostile)).toBe(expected);
    expect(looksLikeFormula(renderTemplateCell(hostile))).toBe(false);
  });

  it("puts the apostrophe inside the quotes, not outside them", () => {
    // Quoting alone does not stop a spreadsheet evaluating a cell, because the
    // quotes are stripped at parse. An apostrophe outside them would be data.
    const cell = renderTemplateCell('=HYPERLINK("http://x"),y');
    expect(cell.startsWith(`"'`)).toBe(true);
    expect(cell.startsWith(`'"`)).toBe(false);
  });

  it("escapes an embedded quote by doubling it", () => {
    expect(renderTemplateCell('a"b')).toBe('"a""b"');
  });

  it.each(IMPORT_TEMPLATE_KINDS)("%s round-trips its header through the parser", async (kind) => {
    const { outcome } = await parseTemplate(kind);
    expect(outcome.fatal).toBeNull();
    expect(outcome.rowErrors).toEqual([]);
    expect(outcome.headers).toEqual(
      IMPORT_TEMPLATES[kind].columns.map((c) => c.canonicalField),
    );
  });

  it.each(IMPORT_TEMPLATE_KINDS)("%s stays inside the declared limits", (kind) => {
    const csv = renderTemplateCsv(kind);
    expect(new TextEncoder().encode(csv).length).toBeLessThan(DEFAULT_IMPORT_LIMITS.maxBytes);
    expect(IMPORT_TEMPLATES[kind].columns.length).toBeLessThanOrEqual(
      DEFAULT_IMPORT_LIMITS.maxColumns,
    );
  });
});

describe("a file built exactly as the template instructs validates clean", () => {
  // The combined template carries its object type per row, so a single-type
  // mapping cannot describe it. It is covered by the structural tests above.
  const singleType = IMPORT_TEMPLATE_KINDS.filter((k) => k !== "combined_crm");

  it.each(singleType)("%s example rows come out ready", async (kind) => {
    const { rows, outcome } = await parseTemplate(kind);
    expect(outcome.fatal).toBeNull();
    expect(rows.length).toBe(IMPORT_TEMPLATES[kind].examples.length);

    const mappings = mappingFromTemplate(kind);
    const objectType = IMPORT_TEMPLATES[kind].objectType ?? "account";
    const normalized = rows.map((row) => normalizeRow(row, objectType, mappings));

    for (const row of normalized) {
      // A transform that cannot read its own example means the template is
      // instructing people to write a value the pipeline will not accept.
      expect(row.failures).toEqual([]);
      expect(row.missingRequired).toEqual([]);
      expect(row.unmappedColumns).toEqual([]);
      expect(row.externalId).toBeTruthy();
    }

    const result = validateBatch(normalized, ctxFor(normalized));
    const notReady = result.rows.filter((r) => r.disposition !== "ready");
    expect(
      notReady.map((r) => ({
        row: r.row.sourceRowNumber,
        disposition: r.disposition,
        findings: r.findings.map((f) => f.ruleId),
      })),
    ).toEqual([]);
  });
});

/**
 * The cross-check that has an authority outside the template.
 *
 * Everything above derives its mapping from the template, so the template
 * cannot disagree with itself: loosen a `required` flag and the derived mapping
 * loosens with it, and the round-trip still passes. The canonical record
 * schemas are the independent side. If `AccountSchema` demands `tier` and the
 * accounts template calls it optional, a created account fails the contract the
 * product reads it back through — and only a comparison against the schema
 * catches that.
 */
describe("templates satisfy the canonical record schemas", () => {
  /**
   * Fields the server owns. A template that asked for these would be inviting
   * somebody to forge provenance, so their absence is correct and this list
   * says so explicitly rather than exempting anything that happens to be
   * missing.
   */
  const SERVER_OWNED = new Set(["createdAt", "updatedAt"]);

  /** Canonical name to template column, where the import names it differently. */
  const COLUMN_FOR: Record<string, string> = {
    id: "externalId",
    accountId: "accountExternalId",
    contactId: "contactExternalId",
  };

  /**
   * Peel optional/nullable/default wrappers and report the inner type by name.
   *
   * Deliberately not `instanceof`. Under vitest the test file and the built
   * package can end up holding different `zod` module instances, and every
   * `instanceof z.ZodEnum` then returns false — which does not fail anything,
   * it just makes the loop below skip every field and pass while checking
   * nothing. `_def.typeName` is the same string in both copies.
   */
  function unwrap(def: z.ZodTypeAny): { typeName: string; options?: string[] } {
    let inner = def as z.ZodTypeAny & { _def: { typeName: string; innerType?: z.ZodTypeAny } };
    while (
      inner._def.typeName === "ZodOptional" ||
      inner._def.typeName === "ZodNullable" ||
      inner._def.typeName === "ZodDefault"
    ) {
      inner = inner._def.innerType as typeof inner;
    }
    return {
      typeName: inner._def.typeName,
      options: (inner as unknown as { options?: string[] }).options,
    };
  }

  function requiredCanonicalFields(schema: z.ZodObject<z.ZodRawShape>): string[] {
    // Optional, nullable and defaulted fields can all be absent from a create.
    // Everything else has to come from the file or the record cannot be built.
    return Object.entries(schema.shape)
      .filter(([, def]) => {
        const d = def as z.ZodTypeAny;
        return !d.isOptional() && !d.isNullable();
      })
      .map(([key]) => key)
      .filter((key) => !SERVER_OWNED.has(key));
  }

  /**
   * The enum-backed canonical fields each template is expected to cover, named
   * rather than counted so adding one to a schema shows up here as a failure
   * instead of quietly going unchecked.
   */
  const ENUM_COLUMNS: Record<string, string[]> = {
    accounts: ["tier", "lifecycleStage"],
    contacts: ["role"],
    opportunities: ["stage"],
    activities: ["type"],
  };

  const pairs: [ImportTemplateKind, z.ZodObject<z.ZodRawShape>][] = [
    ["accounts", AccountSchema as unknown as z.ZodObject<z.ZodRawShape>],
    ["contacts", ContactSchema as unknown as z.ZodObject<z.ZodRawShape>],
    ["opportunities", OpportunitySchema as unknown as z.ZodObject<z.ZodRawShape>],
    ["activities", ActivitySchema as unknown as z.ZodObject<z.ZodRawShape>],
  ];

  it.each(pairs)("%s offers every field a create needs", (kind, schema) => {
    const columns = new Map(
      IMPORT_TEMPLATES[kind].columns.map((c) => [c.canonicalField, c.required]),
    );
    const missing: string[] = [];
    const optionalButRequired: string[] = [];
    for (const field of requiredCanonicalFields(schema)) {
      const column = COLUMN_FOR[field] ?? field;
      if (!columns.has(column)) missing.push(column);
      else if (!columns.get(column)) optionalButRequired.push(column);
    }
    expect({ missing, optionalButRequired }).toEqual({ missing: [], optionalButRequired: [] });
  });

  it.each(pairs)("%s enum columns list exactly the canonical values", (kind, schema) => {
    // A template offering a value the schema rejects is worse than offering
    // none: it instructs somebody to write a value that will be refused.
    const compared: string[] = [];
    for (const [field, def] of Object.entries(schema.shape)) {
      const inner = unwrap(def as z.ZodTypeAny);
      if (inner.typeName !== "ZodEnum" || !inner.options) continue;

      const column = IMPORT_TEMPLATES[kind].columns.find(
        (c) => c.canonicalField === (COLUMN_FOR[field] ?? field),
      );
      if (!column) continue;
      compared.push(field);
      expect({ field, values: column.enumValues ?? [] }).toEqual({
        field,
        values: inner.options,
      });
    }
    // Without this the loop passes by comparing nothing, which is exactly how
    // the first version of this test passed while an enum was wrong.
    expect(compared).toEqual(ENUM_COLUMNS[kind]);
  });
});

describe("header check agrees with the template it is checking against", () => {
  const MAX_COLUMNS = DEFAULT_IMPORT_LIMITS.maxColumns;

  it.each(IMPORT_TEMPLATE_KINDS)("%s accepts its own header row", (kind) => {
    const headers = IMPORT_TEMPLATES[kind].columns.map((c) => c.canonicalField);
    expect(checkTemplateHeaders(headers, kind, MAX_COLUMNS)).toEqual([]);
  });

  it.each(IMPORT_TEMPLATE_KINDS)("%s blocks a header missing a required column", (kind) => {
    const required = requiredColumns(kind);
    const headers = IMPORT_TEMPLATES[kind].columns
      .map((c) => c.canonicalField)
      .filter((h) => h !== required[0]);
    const problems = checkTemplateHeaders(headers, kind, MAX_COLUMNS);
    expect(problems).toContainEqual({
      code: "missing_required_column",
      blocking: true,
      columns: [required[0]],
    });
  });

  it("blocks a repeated column", () => {
    const headers = ["externalId", "name", "name"];
    const problems = checkTemplateHeaders(headers, "accounts", MAX_COLUMNS);
    expect(problems).toContainEqual({
      code: "duplicate_header",
      blocking: true,
      columns: ["name"],
    });
  });

  it("reports an unknown column without blocking on it", () => {
    // Dropped rather than guessed at. Blocking here would refuse every export
    // that carries one extra field, which is most of them.
    const headers = [
      ...IMPORT_TEMPLATES.accounts.columns.map((c) => c.canonicalField),
      "our_internal_code",
    ];
    const problems = checkTemplateHeaders(headers, "accounts", MAX_COLUMNS);
    expect(problems).toEqual([
      { code: "unmapped_column", blocking: false, columns: ["our_internal_code"] },
    ]);
    expect(problems.some((p) => p.blocking)).toBe(false);
  });

  it("blocks a header wider than the column limit", () => {
    const headers = Array.from({ length: 5 }, (_, i) => `c${i}`);
    const problems = checkTemplateHeaders(headers, "accounts", 3);
    expect(problems.some((p) => p.code === "column_limit_exceeded" && p.blocking)).toBe(true);
  });

  it("blocks the wrong template's header", () => {
    // Picking accounts and uploading the contacts export is the likeliest
    // mistake on this screen, so it has to be caught by name rather than by
    // the row-level findings 100,000 rows later.
    const contactHeaders = IMPORT_TEMPLATES.contacts.columns.map((c) => c.canonicalField);
    const problems = checkTemplateHeaders(contactHeaders, "accounts", MAX_COLUMNS);
    expect(problems.some((p) => p.code === "missing_required_column" && p.blocking)).toBe(true);
  });
});

describe("templates move as a set", () => {
  it("shares one version across every kind", () => {
    // A per-template version would let one drift while the mapping that reads
    // all of them stayed on the old contract.
    const versions = new Set(IMPORT_TEMPLATE_KINDS.map((k) => IMPORT_TEMPLATES[k].version));
    expect([...versions]).toHaveLength(1);
  });

  it("names the version in the filename", () => {
    for (const kind of IMPORT_TEMPLATE_KINDS) {
      expect(templateFilename(kind)).toContain(IMPORT_TEMPLATES[kind].version);
    }
  });
});
