import {
  isAllowedUploadFilename,
  isPlausibleCsvContentType,
  checkDecodedText,
} from "@repo/security";
import type { ImportLimits, ImportTemplateKind } from "@repo/shared-schemas";
import { IMPORT_TEMPLATES, checkTemplateHeaders } from "@repo/shared-schemas";

/**
 * Browser-side pre-flight for a chosen CSV (secure-ingestion spec, section 7.1).
 *
 * Every check here also runs on the server against the bytes it actually
 * received. This copy exists so a 10 MB upload does not have to complete before
 * a user learns their file has a NUL byte in it — not to establish anything.
 * Nothing downstream may treat a passing pre-flight as evidence: the browser is
 * not a trusted party, and `runPreflight` returning `ok` grants no permission.
 *
 * The header check is deliberately shallow. It reads the first line to tell
 * somebody they picked the wrong template; the real parse is streaming, bounded
 * and server-side.
 */

export type PreflightSeverity = "blocked" | "warning";

export interface PreflightIssue {
  severity: PreflightSeverity;
  /** Matches a `ParseRejection` or finding rule id where one exists. */
  code: string;
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  issues: PreflightIssue[];
  /** Headers read from line 1, empty when the file could not be read. */
  headers: string[];
  bytes: number;
}

const blocked = (code: string, message: string): PreflightIssue => ({
  severity: "blocked",
  code,
  message,
});

const warn = (code: string, message: string): PreflightIssue => ({
  severity: "warning",
  code,
  message,
});

/**
 * Split the header line only. Quoted headers are rare but legal, so this
 * handles them rather than reporting a spurious mismatch on a valid file.
 */
function parseHeaderLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === ",") {
      out.push(field.trim());
      field = "";
    } else {
      field += char;
    }
  }
  out.push(field.trim());
  return out;
}

/** Decode the leading bytes strictly so an encoding problem is reported as one. */
function decodeStrict(bytes: Uint8Array): { text: string; failed: boolean } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), failed: false };
  } catch {
    return { text: "", failed: true };
  }
}

export interface PreflightInput {
  filename: string;
  contentType: string | undefined;
  bytes: number;
  /** The first slice of the file, for the header and encoding checks. */
  head: Uint8Array;
  /** True when `head` is the whole file, so a decode failure is conclusive. */
  headIsWholeFile: boolean;
}

export function runPreflight(
  input: PreflightInput,
  kind: ImportTemplateKind,
  limits: ImportLimits,
): PreflightResult {
  const issues: PreflightIssue[] = [];

  if (!isAllowedUploadFilename(input.filename)) {
    issues.push(
      blocked(
        "filename_not_allowed",
        "The file must be a plain .csv with no path separators and no second extension.",
      ),
    );
  }

  if (!isPlausibleCsvContentType(input.contentType)) {
    // Advisory only (section 21.1). A browser chooses this freely, so it can
    // hint at a wrong file but must never be the thing that refuses one.
    issues.push(
      warn(
        "implausible_content_type",
        `The browser reported this file as ${input.contentType}. That is advisory, and the contents are what will be checked.`,
      ),
    );
  }

  if (input.bytes === 0) {
    issues.push(blocked("empty_file", "The file is empty."));
  } else if (input.bytes > limits.maxBytes) {
    issues.push(
      blocked(
        "byte_limit_exceeded",
        `The file is ${formatBytes(input.bytes)}. The limit is ${formatBytes(limits.maxBytes)}.`,
      ),
    );
  }

  const { text, failed } = decodeStrict(input.head);
  let headers: string[] = [];

  if (failed) {
    if (input.headIsWholeFile) {
      issues.push(blocked("not_utf8", "The file is not valid UTF-8."));
    } else {
      // A multi-byte character can straddle the slice boundary, so a failure on
      // a partial read is not evidence the file is bad. Say so rather than
      // refusing a valid file, and let the server decide on the whole stream.
      issues.push(
        warn(
          "encoding_unverified",
          "The start of the file could not be decoded as UTF-8. This may be a truncated read; the server checks the whole file.",
        ),
      );
    }
  } else {
    const encodingProblem = checkDecodedText(text, false);
    if (encodingProblem) {
      issues.push(
        blocked(
          encodingProblem,
          encodingProblem === "nul_byte"
            ? "The file contains a NUL byte, which a CSV never legitimately holds."
            : "The file contains control characters that are not tab, carriage return or line feed.",
        ),
      );
    }

    const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
    if (!firstLine.trim()) {
      issues.push(blocked("missing_header", "The first line is empty, so there is no header row."));
    } else {
      headers = parseHeaderLine(firstLine);
      issues.push(...checkHeaders(headers, kind, limits));
    }
  }

  return {
    ok: !issues.some((i) => i.severity === "blocked"),
    issues,
    headers,
    bytes: input.bytes,
  };
}

/**
 * Phrase the shared header verdict for a person.
 *
 * The decisions — which columns a template requires, what counts as a
 * duplicate, whether an extra column is fatal — belong to
 * `checkTemplateHeaders` so the server reaches the same verdict. Only the
 * wording is chosen here.
 */
function checkHeaders(
  headers: string[],
  kind: ImportTemplateKind,
  limits: ImportLimits,
): PreflightIssue[] {
  const template = IMPORT_TEMPLATES[kind];
  return checkTemplateHeaders(headers, kind, limits.maxColumns).map((problem) => {
    switch (problem.code) {
      case "column_limit_exceeded":
        return blocked(
          problem.code,
          `The file has ${headers.length} columns. The limit is ${limits.maxColumns}.`,
        );
      case "duplicate_header":
        return blocked(
          problem.code,
          `Repeated column name: ${problem.columns.join(", ")}. Each column must appear once.`,
        );
      case "missing_required_column":
        return blocked(
          problem.code,
          `The ${template.label} template requires ${problem.columns.join(", ")}. Download the template if the column names have drifted.`,
        );
      case "unmapped_column":
        return warn(
          problem.code,
          `${problem.columns.length} column${problem.columns.length === 1 ? "" : "s"} not in this template will be ignored, not imported: ${problem.columns.slice(0, 5).join(", ")}${problem.columns.length > 5 ? "…" : ""}.`,
        );
    }
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
