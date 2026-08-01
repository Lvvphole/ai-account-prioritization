import { describe, it, expect } from "vitest";
import {
  isAllowedUploadFilename,
  isPlausibleCsvContentType,
  checkDecodedText,
  looksLikeFormula,
  neutralizeForExport,
  buildQuarantinePath,
  isOwnedQuarantinePath,
  UnsafeStoragePathError,
} from "@repo/security";
import { DEFAULT_IMPORT_LIMITS, type ImportLimits, type ParsedRow } from "@repo/shared-schemas";
import { parseCsvStream, evaluateScanGate, runSecurityScan } from "agent-runtime";

/**
 * Adversarial upload suite (secure-ingestion spec, section 22.3).
 *
 * Each case is a hostile file or name the spec names by hand. The assertion is
 * always the same shape: the pipeline refuses it, and refuses it for the stated
 * reason rather than by accident.
 */

const enc = new TextEncoder();

/** Feed a string as a single chunk. */
async function* one(text: string): AsyncIterable<Uint8Array> {
  yield enc.encode(text);
}

/** Feed raw bytes, for cases a string cannot express. */
async function* raw(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

/** Split into small chunks so cross-chunk state is exercised. */
async function* chunked(text: string, size: number): AsyncIterable<Uint8Array> {
  const bytes = enc.encode(text);
  for (let i = 0; i < bytes.length; i += size) {
    yield bytes.slice(i, i + size);
  }
}

async function parse(
  source: AsyncIterable<Uint8Array>,
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
) {
  const rows: ParsedRow[] = [];
  const outcome = await parseCsvStream(source, (r) => rows.push(r), { limits });
  return { outcome, rows };
}

describe("filename allowlist", () => {
  it("accepts an ordinary csv name", () => {
    expect(isAllowedUploadFilename("accounts.csv")).toBe(true);
    expect(isAllowedUploadFilename("q3-accounts.csv")).toBe(true);
    expect(isAllowedUploadFilename("accounts.2026.csv")).toBe(true);
  });

  it("rejects a .csv.exe double extension", () => {
    expect(isAllowedUploadFilename("payload.csv.exe")).toBe(false);
    expect(isAllowedUploadFilename("payload.CSV.EXE")).toBe(false);
  });

  it("rejects an executable smuggled into the middle segment", () => {
    expect(isAllowedUploadFilename("payload.exe.csv")).toBe(false);
    expect(isAllowedUploadFilename("payload.ps1.csv")).toBe(false);
  });

  it("rejects a NUL-truncated name", () => {
    // A consumer treating this as a C string sees `evil.exe`.
    expect(isAllowedUploadFilename("evil.exe\u0000.csv")).toBe(false);
  });

  it("rejects path separators and traversal", () => {
    expect(isAllowedUploadFilename("../../etc/passwd.csv")).toBe(false);
    expect(isAllowedUploadFilename("a/b.csv")).toBe(false);
    expect(isAllowedUploadFilename("a\\b.csv")).toBe(false);
    expect(isAllowedUploadFilename("..csv")).toBe(false);
  });

  it("rejects a name with no extension or the wrong one", () => {
    expect(isAllowedUploadFilename("accounts")).toBe(false);
    expect(isAllowedUploadFilename("accounts.tsv")).toBe(false);
    expect(isAllowedUploadFilename("")).toBe(false);
  });
});

describe("MIME is advisory", () => {
  it("accepts the plausible types a browser actually sends", () => {
    for (const t of ["text/csv", "text/plain", "application/octet-stream", undefined]) {
      expect(isPlausibleCsvContentType(t)).toBe(true);
    }
  });

  it("flags an implausible declared type", () => {
    expect(isPlausibleCsvContentType("application/x-msdownload")).toBe(false);
  });

  it("is never sufficient on its own", () => {
    // A spoofed MIME passes this check, which is exactly why the parser still
    // decodes and structurally validates every byte.
    expect(isPlausibleCsvContentType("text/csv")).toBe(true);
  });
});

describe("encoding controls", () => {
  it("rejects a NUL byte payload", async () => {
    const { outcome } = await parse(one("name,id\nAcme\u0000Corp,1\n"));
    expect(outcome.fatal).toBe("nul_byte");
  });

  it("rejects invalid UTF-8", async () => {
    // 0xFF is not a valid UTF-8 lead byte.
    const bytes = new Uint8Array([...enc.encode("name,id\nA"), 0xff, ...enc.encode(",1\n")]);
    const { outcome } = await parse(raw(bytes));
    expect(outcome.fatal).toBe("not_utf8");
  });

  it("rejects forbidden control characters but allows tab", async () => {
    const bell = await parse(one("name,id\nAcme\u0007,1\n"));
    expect(bell.outcome.fatal).toBe("forbidden_control_character");

    const tab = await parse(one("name,id\n\"Acme\tCorp\",1\n"));
    expect(tab.outcome.fatal).toBeNull();
    expect(tab.rows[0]?.values.name).toBe("Acme\tCorp");
  });

  it("rejects DEL", async () => {
    const { outcome } = await parse(one("name,id\nAcme\u007f,1\n"));
    expect(outcome.fatal).toBe("forbidden_control_character");
  });

  it("checks decoded text directly", () => {
    expect(checkDecodedText("ordinary text", false)).toBeNull();
    expect(checkDecodedText("has\u0000nul", false)).toBe("nul_byte");
    expect(checkDecodedText("bell\u0007", false)).toBe("forbidden_control_character");
    expect(checkDecodedText("fine", true)).toBe("not_utf8");
  });
});

describe("resource limits", () => {
  const tiny: ImportLimits = {
    ...DEFAULT_IMPORT_LIMITS,
    maxBytes: 200,
    maxRows: 3,
    maxColumns: 3,
    maxCellCharacters: 10,
  };

  it("rejects an oversized file", async () => {
    const body = `name,id\n${"x".repeat(500)},1\n`;
    const { outcome } = await parse(one(body), tiny);
    expect(outcome.fatal).toBe("byte_limit_exceeded");
  });

  it("rejects too many rows", async () => {
    const body = `name,id\n${Array.from({ length: 10 }, (_, i) => `a,${i}`).join("\n")}\n`;
    const { outcome } = await parse(one(body), tiny);
    expect(outcome.fatal).toBe("row_limit_exceeded");
  });

  it("rejects too many columns", async () => {
    const { outcome } = await parse(one("a,b,c,d,e\n1,2,3,4,5\n"), tiny);
    expect(outcome.fatal).toBe("column_limit_exceeded");
  });

  it("rejects an oversized cell", async () => {
    const { outcome } = await parse(one(`name,id\n${"x".repeat(50)},1\n`), tiny);
    expect(outcome.fatal).toBe("cell_length_exceeded");
  });

  it("stops at the limit rather than after reading everything", async () => {
    const body = `name,id\n${Array.from({ length: 1000 }, (_, i) => `a,${i}`).join("\n")}\n`;
    const { outcome } = await parse(one(body), tiny);
    // Refused after the fourth row, not after the thousandth.
    expect(outcome.rowsParsed).toBeLessThanOrEqual(tiny.maxRows + 1);
  });

  it("rejects a run that exceeds the processing budget", async () => {
    let clock = 0;
    const rows: ParsedRow[] = [];
    const outcome = await parseCsvStream(
      chunked("name,id\na,1\nb,2\nc,3\n", 4),
      (r) => rows.push(r),
      {
        limits: { ...DEFAULT_IMPORT_LIMITS, maxProcessingMs: 5 },
        now: () => (clock += 10),
      },
    );
    expect(outcome.fatal).toBe("duration_exceeded");
  });
});

describe("structural controls", () => {
  it("rejects malformed quotes", async () => {
    const { outcome } = await parse(one('name,id\n"unterminated,1\n'));
    expect(outcome.fatal).toBe("unterminated_quote");
  });

  it("records a row with the wrong column count without failing the file", async () => {
    const { outcome, rows } = await parse(one("name,id\na,1\nb\nc,3\n"));
    expect(outcome.fatal).toBeNull();
    expect(outcome.rowErrors).toEqual([{ rowNumber: 3, reason: "inconsistent_column_count" }]);
    expect(rows.map((r) => r.values.name)).toEqual(["a", "c"]);
  });

  it("rejects an empty file", async () => {
    const { outcome } = await parse(one(""));
    expect(outcome.fatal).toBe("empty_file");
  });

  it("rejects duplicate headers", async () => {
    const { outcome } = await parse(one("name,name\na,b\n"));
    expect(outcome.fatal).toBe("duplicate_header");
  });

  it("handles quoted commas, newlines and escaped quotes", async () => {
    const { outcome, rows } = await parse(
      one('name,note\n"Acme, Inc","line1\nline2"\n"He said ""hi""",plain\n'),
    );
    expect(outcome.fatal).toBeNull();
    expect(rows[0]?.values.name).toBe("Acme, Inc");
    expect(rows[0]?.values.note).toBe("line1\nline2");
    expect(rows[1]?.values.name).toBe('He said "hi"');
  });

  it("parses identically when the stream is split arbitrarily", async () => {
    const body = 'name,note\n"Acme, Inc","line1\nline2"\nBeta,plain\n';
    const whole = await parse(one(body));
    for (const size of [1, 2, 3, 7, 13]) {
      const split = await parse(chunked(body, size));
      expect(split.outcome.fatal).toBeNull();
      expect(split.rows).toEqual(whole.rows);
    }
  });

  it("accepts a final row with no trailing newline", async () => {
    const { rows } = await parse(one("name,id\na,1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.values.id).toBe("1");
  });
});

describe("formula payloads are data, never executed", () => {
  it("parses a formula cell as a plain string", async () => {
    const { outcome, rows } = await parse(
      one('name,id\n"=cmd|\' /C calc\'!A0",1\n@SUM(1+1)*cmd,2\n'),
    );
    expect(outcome.fatal).toBeNull();
    // The value survives verbatim. There is no evaluation path to reach.
    expect(rows[0]?.values.name).toBe("=cmd|' /C calc'!A0");
    expect(rows[1]?.values.name).toBe("@SUM(1+1)*cmd");
  });

  it("detects every formula lead character", () => {
    for (const payload of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1+1", " =1+1", "\r=1+1"]) {
      expect(looksLikeFormula(payload), payload).toBe(true);
    }
    for (const safe of ["Acme", "1+1", "a=b", "'=1+1"]) {
      expect(looksLikeFormula(safe), safe).toBe(false);
    }
  });

  it("neutralizes a formula for export without losing the value", () => {
    expect(neutralizeForExport("=1+1")).toBe("'=1+1");
    expect(neutralizeForExport("Acme")).toBe("Acme");
    // A control character cannot reintroduce a formula start after the prefix.
    expect(neutralizeForExport("\t=1+1")).toBe("' =1+1");
  });
});

describe("storage paths are server-generated", () => {
  const ws = "11111111-1111-4111-8111-111111111111";
  const batch = "22222222-2222-4222-8222-222222222222";
  const upload = "33333333-3333-4333-8333-333333333333";

  it("builds a workspace-prefixed path from trusted ids only", () => {
    expect(buildQuarantinePath(ws, batch, upload)).toBe(`${ws}/${batch}/${upload}.csv`);
  });

  it("refuses to build a path from anything else", () => {
    for (const bad of ["../etc", "a/b", "UPPER", "with space", "", "x".repeat(80)]) {
      expect(() => buildQuarantinePath(ws, batch, bad)).toThrow(UnsafeStoragePathError);
    }
  });

  it("recognises only paths it would have generated", () => {
    expect(isOwnedQuarantinePath(`${ws}/${batch}/${upload}.csv`, ws)).toBe(true);
    // Another tenant's object, and traversal out of the prefix.
    expect(isOwnedQuarantinePath(`${batch}/${batch}/${upload}.csv`, ws)).toBe(false);
    expect(isOwnedQuarantinePath(`${ws}/../${batch}/${upload}.csv`, ws)).toBe(false);
    expect(isOwnedQuarantinePath(`${ws}/${batch}/${upload}.exe`, ws)).toBe(false);
  });
});

describe("100,000-row fixture stays within limits", () => {
  it("parses the exit-gate fixture without exceeding the configured budget", async () => {
    const rowCount = 100_000;
    // Generated as a stream so the fixture itself never sits in memory whole,
    // which is the property under test.
    async function* generate(): AsyncIterable<Uint8Array> {
      yield enc.encode("external_id,name,amount\n");
      const batchSize = 1000;
      for (let start = 0; start < rowCount; start += batchSize) {
        let block = "";
        for (let i = start; i < start + batchSize; i += 1) {
          block += `EXT-${i},Account ${i},${1000 + i}\n`;
        }
        yield enc.encode(block);
      }
    }

    let seen = 0;
    let lastExternalId = "";
    const started = Date.now();
    const outcome = await parseCsvStream(
      generate(),
      (row) => {
        seen += 1;
        lastExternalId = row.values.external_id ?? "";
      },
      { limits: DEFAULT_IMPORT_LIMITS },
    );
    const elapsed = Date.now() - started;

    expect(outcome.fatal).toBeNull();
    expect(outcome.rowsParsed).toBe(rowCount);
    expect(seen).toBe(rowCount);
    expect(lastExternalId).toBe(`EXT-${rowCount - 1}`);
    expect(outcome.bytesRead).toBeLessThanOrEqual(DEFAULT_IMPORT_LIMITS.maxBytes);
    expect(elapsed).toBeLessThan(DEFAULT_IMPORT_LIMITS.maxProcessingMs);
  }, 120_000);
});

describe("scan gate fails closed in production", () => {
  const base = {
    batchId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    providerId: "test-scanner",
    scannedAt: "2026-08-01T00:00:00.000Z",
  };
  const allPrechecksPass = [
    { check: "authorization" as const, passed: true, detail: null },
    { check: "workspace_binding" as const, passed: true, detail: null },
    { check: "object_ownership" as const, passed: true, detail: null },
    { check: "size_limits" as const, passed: true, detail: null },
    { check: "text_format" as const, passed: true, detail: null },
    { check: "parser_safety" as const, passed: true, detail: null },
  ];
  const scanner = {
    providerId: "test-scanner",
    scan: async () => ({ status: "clean" as const }),
  };

  it("allows a clean file", () => {
    const verdict = { ...base, checks: allPrechecksPass, malwareStatus: "clean" as const };
    expect(evaluateScanGate(verdict, { scanner, isProduction: true })).toEqual({ allowed: true });
  });

  it("blocks an infected file in every environment", () => {
    const verdict = { ...base, checks: allPrechecksPass, malwareStatus: "infected" as const };
    for (const isProduction of [true, false]) {
      expect(evaluateScanGate(verdict, { scanner, isProduction })).toEqual({
        allowed: false,
        reason: "malware_detected",
      });
    }
  });

  it("does not treat an unreachable scanner as a clean file in production", () => {
    // The whole point. `unavailable` must never collapse into `clean`.
    const verdict = { ...base, checks: allPrechecksPass, malwareStatus: "unavailable" as const };
    expect(evaluateScanGate(verdict, { scanner, isProduction: true })).toEqual({
      allowed: false,
      reason: "scanner_unavailable_in_production",
    });
  });

  it("names the missing-provider case separately", () => {
    const verdict = { ...base, checks: allPrechecksPass, malwareStatus: "unavailable" as const };
    expect(evaluateScanGate(verdict, { scanner: null, isProduction: true })).toEqual({
      allowed: false,
      reason: "no_scanner_configured_in_production",
    });
  });

  it("permits an unavailable scanner outside production", () => {
    const verdict = { ...base, checks: allPrechecksPass, malwareStatus: "unavailable" as const };
    expect(evaluateScanGate(verdict, { scanner: null, isProduction: false })).toEqual({
      allowed: true,
    });
  });

  it("blocks when any precheck failed, whatever the scanner said", () => {
    const verdict = {
      ...base,
      checks: [
        ...allPrechecksPass.slice(0, 2),
        { check: "object_ownership" as const, passed: false, detail: "not this workspace" },
        ...allPrechecksPass.slice(3),
      ],
      malwareStatus: "clean" as const,
    };
    expect(evaluateScanGate(verdict, { scanner, isProduction: false })).toEqual({
      allowed: false,
      reason: "precheck_failed",
    });
  });

  it("records unavailable when the provider throws rather than letting it escape", async () => {
    const verdict = await runSecurityScan({
      workspaceId: base.workspaceId,
      batchId: base.batchId,
      bucket: "ingestion-quarantine",
      storagePath: "a/b/c.csv",
      sha256: "a".repeat(64),
      byteSize: 100,
      maxBytes: 1000,
      precheck: {
        authorization: true,
        workspace_binding: true,
        object_ownership: true,
        text_format: true,
        parser_safety: true,
      },
      scanner: {
        providerId: "flaky",
        scan: async () => {
          throw new Error("connection refused");
        },
      },
    });
    expect(verdict.malwareStatus).toBe("unavailable");
    // And that verdict blocks production, so a throwing scanner is not a pass.
    expect(evaluateScanGate(verdict, { scanner, isProduction: true }).allowed).toBe(false);
  });

  it("fails the size check when the object exceeds the limit", async () => {
    const verdict = await runSecurityScan({
      workspaceId: base.workspaceId,
      batchId: base.batchId,
      bucket: "ingestion-quarantine",
      storagePath: "a/b/c.csv",
      sha256: "a".repeat(64),
      byteSize: 5000,
      maxBytes: 1000,
      precheck: { authorization: true, workspace_binding: true, object_ownership: true, text_format: true, parser_safety: true },
      scanner,
    });
    expect(verdict.checks.find((c) => c.check === "size_limits")?.passed).toBe(false);
    expect(evaluateScanGate(verdict, { scanner, isProduction: false })).toEqual({
      allowed: false,
      reason: "precheck_failed",
    });
  });
});
