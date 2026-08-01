import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  OPERATIONAL_TABLES,
  INGESTION_TABLES,
  ADAPTER_ALLOWED_TABLES,
  isOperationalTable,
  isIngestionTable,
  assertAdapterTableAccess,
  assertStagingTableAccess,
  assertCommitAuthorized,
  TableAccessError,
  CommitNotAuthorizedError,
  type CommitAuthorization,
} from "@repo/security";

/**
 * Epic 1 exit gate, part two: "No operational CRM table can be reached from a
 * source adapter directly."
 *
 * That is a claim about code, so it is checked against code. The runtime
 * assertions below cover the guards, and the source scan at the bottom covers
 * the thing guards cannot: a future adapter that simply imports a database
 * client and never calls them.
 */

// Vitest runs with the package directory as cwd.
const REPO_ROOT = join(process.cwd(), "..", "..");
const INGESTION_DIR = join(REPO_ROOT, "apps", "agent-runtime", "src", "ingestion");

function readAllSources(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...readAllSources(full));
    } else if (entry.endsWith(".ts")) {
      out.push({ path: full, text: readFileSync(full, "utf8") });
    }
  }
  return out;
}

describe("table catalogues", () => {
  it("keeps operational and ingestion tables disjoint", () => {
    const overlap = OPERATIONAL_TABLES.filter((t) => INGESTION_TABLES.includes(t));
    expect(overlap).toEqual([]);
  });

  it("names the tables the product treats as true", () => {
    for (const table of ["accounts", "contacts", "opportunities", "recommendations"]) {
      expect(isOperationalTable(table)).toBe(true);
      expect(isIngestionTable(table)).toBe(false);
    }
  });

  it("names the staging tables", () => {
    for (const table of ["staged_records", "ingestion_findings", "change_sets"]) {
      expect(isIngestionTable(table)).toBe(true);
      expect(isOperationalTable(table)).toBe(false);
    }
  });

  it("grants a source adapter no table at all", () => {
    expect(ADAPTER_ALLOWED_TABLES).toEqual([]);
  });
});

describe("adapters cannot reach the database", () => {
  it("refuses every operational table", () => {
    for (const table of OPERATIONAL_TABLES) {
      expect(() => assertAdapterTableAccess(table)).toThrow(TableAccessError);
    }
  });

  it("refuses every ingestion table too", () => {
    // Persistence is the ingestion service's job. An adapter that wrote its own
    // staging rows would bypass validation and disposition.
    for (const table of INGESTION_TABLES) {
      expect(() => assertAdapterTableAccess(table)).toThrow(TableAccessError);
    }
  });

  it("reports which layer refused, for audit evidence", () => {
    try {
      assertAdapterTableAccess("accounts");
    } catch (error) {
      const e = error as TableAccessError;
      expect(e.code).toBe("INGEST_TABLE_ACCESS_FORBIDDEN");
      expect(e.table).toBe("accounts");
      expect(e.layer).toBe("source adapter");
    }
  });
});

describe("staging cannot write product data", () => {
  it("refuses operational tables to the pipeline", () => {
    for (const table of OPERATIONAL_TABLES) {
      expect(() => assertStagingTableAccess(table)).toThrow(TableAccessError);
    }
  });

  it("permits the staging tables", () => {
    for (const table of INGESTION_TABLES) {
      expect(() => assertStagingTableAccess(table)).not.toThrow();
    }
  });

  it("refuses a table it has never heard of", () => {
    // Fails closed. An unrecognised name is not assumed harmless.
    expect(() => assertStagingTableAccess("some_new_table")).toThrow(TableAccessError);
  });
});

describe("the commit seam", () => {
  const base: CommitAuthorization = {
    workspaceId: "ws-1",
    batchId: "batch-1",
    approvalId: "approval-1",
    approvedBy: "user-1",
    secondApprovalRequired: false,
    secondApprovedBy: null,
  };

  it("accepts a properly approved commit", () => {
    expect(() => assertCommitAuthorized(base, "ws-1")).not.toThrow();
  });

  it("refuses a commit with no approval", () => {
    expect(() => assertCommitAuthorized({ ...base, approvalId: "" }, "ws-1")).toThrow(
      CommitNotAuthorizedError,
    );
    expect(() => assertCommitAuthorized({ ...base, approvedBy: "" }, "ws-1")).toThrow(
      CommitNotAuthorizedError,
    );
  });

  it("refuses an approval from another workspace", () => {
    expect(() => assertCommitAuthorized(base, "ws-2")).toThrow(CommitNotAuthorizedError);
  });

  it("refuses a missing second approver when one was required", () => {
    expect(() =>
      assertCommitAuthorized({ ...base, secondApprovalRequired: true }, "ws-1"),
    ).toThrow(CommitNotAuthorizedError);
  });

  it("refuses one person approving twice", () => {
    expect(() =>
      assertCommitAuthorized(
        { ...base, secondApprovalRequired: true, secondApprovedBy: "user-1" },
        "ws-1",
      ),
    ).toThrow(CommitNotAuthorizedError);
  });
});

describe("the adapter contract as written", () => {
  const adapterFile = join(INGESTION_DIR, "source-adapter.ts");
  const source = readFileSync(adapterFile, "utf8");

  it("hands the adapter no database client", () => {
    // The structural half of the exit gate. `SourceContext` is everything an
    // adapter receives, so if it carries no client there is nothing to misuse.
    const contextBlock = source.slice(
      source.indexOf("export interface SourceContext"),
      source.indexOf("export interface ConnectionTestResult"),
    );
    expect(contextBlock).not.toMatch(/supabase|SupabaseClient|Repository|db|pool|sql/i);
    expect(contextBlock).toMatch(/credentialRef/);
  });

  it("imports nothing that could reach the database", () => {
    const imports = source.match(/^import .*$/gm) ?? [];
    for (const line of imports) {
      expect(line).not.toMatch(/supabase|pg|postgres|repository|ports/i);
    }
  });

  it("names no operational table anywhere in its text", () => {
    for (const table of OPERATIONAL_TABLES) {
      expect(source).not.toContain(`"${table}"`);
      expect(source).not.toContain(`'${table}'`);
    }
  });

  it("returns data from every method rather than a persistence result", () => {
    const adapterBlock = source.slice(source.indexOf("export interface SourceAdapter"));
    expect(adapterBlock).not.toMatch(/save|insert|write|commit|persist|upsert/i);
  });
});

describe("no ingestion module reaches a CRM table by name", () => {
  const files = readAllSources(INGESTION_DIR);

  it("finds the ingestion modules to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("keeps operational table names out of adapter and port definitions", () => {
    // The ports describe what may be done, not how. A literal CRM table name in
    // this layer would mean an adapter or a parser had been handed a direct
    // path to product data.
    for (const { path, text } of files) {
      for (const table of OPERATIONAL_TABLES) {
        const quoted = new RegExp(`["'\`]${table}["'\`]`);
        expect(quoted.test(text), `${path} names the operational table ${table}`).toBe(
          false,
        );
      }
    }
  });

  it("routes every product write through the commit port", () => {
    const ports = readFileSync(join(INGESTION_DIR, "ports.ts"), "utf8");
    // One interface owns promotion to product data, and its write method takes
    // the approval as an argument.
    expect(ports).toMatch(/interface CommitRepository/);
    expect(ports).toMatch(/applyCommit[\s\S]{0,200}approvalId: string/);
    // Staging holds no method that writes an operational row.
    const staging = ports.slice(
      ports.indexOf("export interface StagingRepository"),
      ports.indexOf("export interface CommitRepository"),
    );
    expect(staging).not.toMatch(/account|opportunity|recommendation/i);
  });
});
