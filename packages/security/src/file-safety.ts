/**
 * Upload safety primitives (secure-ingestion spec, sections 7.1 and 21.1).
 *
 * A CSV has no magic signature, so there is no single check that establishes
 * a file is safe. The spec's answer is a control set, and this module is that
 * set: extension, MIME as advisory only, encoding, control characters, formula
 * shapes, and server-generated paths.
 *
 * Every function fails closed. An input this module does not recognise is
 * refused rather than assumed benign.
 *
 * Pure and dependency free, matching the rest of `@repo/security`.
 */

/* ------------------------------------------------------------- filename -- */

/**
 * Refuse anything that is not a plain `.csv`.
 *
 * The double-extension case (`payload.csv.exe`) is why this checks the whole
 * name rather than the last segment after a dot: `.csv.exe` ends in `.exe`,
 * but `report.csv.exe` also *contains* `.csv`, and a naive "includes csv"
 * check would pass it.
 */
export function isAllowedUploadFilename(filename: string): boolean {
  if (!filename || filename.length > 255) return false;
  // Path separators and traversal. The name is metadata, but a name shaped
  // like a path invites someone downstream to treat it as one.
  if (/[\\/]/.test(filename)) return false;
  if (filename.includes("..")) return false;
  // C0 controls and DEL, written as escapes so the source stays readable
  // ASCII. NUL matters most: `evil.exe\u0000.csv` reads as `evil.exe` to any
  // consumer that treats the name as a C string.
  if (/[\u0000-\u001f\u007f]/.test(filename)) return false;
  // At most one extra dot, and the name must end in .csv. This rejects
  // `payload.csv.exe`, which ends in .exe while still containing ".csv".
  if (!/^[^.]+(?:\.[^.]+)?\.csv$/i.test(filename)) return false;
  // And reject an executable extension smuggled into the middle segment.
  return !/\.(exe|sh|bat|cmd|com|scr|js|jsx|htm|html|svg|zip|gz|tar|7z|rar|dll|ps1)\.csv$/i.test(
    filename,
  );
}

/**
 * MIME is advisory (section 21.1). This reports whether the declared type is
 * plausible, and callers must not treat `true` as evidence of anything: a
 * client chooses this header freely.
 */
export function isPlausibleCsvContentType(contentType: string | undefined): boolean {
  if (!contentType) return true; // Absent is not suspicious; browsers vary.
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return [
    "text/csv",
    "application/csv",
    "text/plain",
    "application/vnd.ms-excel",
    "application/octet-stream",
  ].includes(base);
}

/* ------------------------------------------------------------- encoding -- */

export type EncodingRejection = "not_utf8" | "nul_byte" | "forbidden_control_character";

/**
 * Control characters a CSV may legitimately contain. Tab is data, CR and LF
 * are structure. Everything else in C0, plus DEL, is refused: it has no meaning
 * in a spreadsheet export and is a common way to smuggle a payload past a
 * naive filter.
 */
const ALLOWED_CONTROL = new Set([0x09, 0x0a, 0x0d]);

/**
 * Validate a decoded chunk. Returns null when the text is acceptable.
 *
 * `decoded` must come from a strict UTF-8 decoder; this cannot detect invalid
 * UTF-8 itself because a lossy decoder has already replaced it. Callers pass
 * `sawReplacementChar` from the decoder so the two signals stay distinct: a
 * genuine U+FFFD in the source is different from a decode failure.
 *
 * Decoding itself belongs to the parser, which owns the streaming decoder. This
 * package stays free of runtime APIs so it can be imported anywhere.
 */
export function checkDecodedText(
  decoded: string,
  sawReplacementChar: boolean,
): EncodingRejection | null {
  if (sawReplacementChar) return "not_utf8";
  for (let i = 0; i < decoded.length; i += 1) {
    const code = decoded.charCodeAt(i);
    if (code === 0) return "nul_byte";
    if (code < 0x20 && !ALLOWED_CONTROL.has(code)) return "forbidden_control_character";
    if (code === 0x7f) return "forbidden_control_character";
  }
  return null;
}

/* -------------------------------------------------------------- formula -- */

/**
 * Section 21.1. A cell starting with one of these is interpreted as a formula
 * by spreadsheet software. The parser never evaluates anything, so this is not
 * about protecting us: it is about not handing a weapon to whoever opens an
 * export later.
 *
 * The leading characters are the standard set, plus the tab and carriage
 * return that Excel skips before deciding a cell is a formula.
 */
const FORMULA_START = /^[\t\r ]*[=+\-@]/;

export function looksLikeFormula(value: string): boolean {
  return FORMULA_START.test(value);
}

/**
 * Render a value inert for export. Prefixing an apostrophe is the documented
 * neutralization; control characters are stripped first so they cannot
 * reintroduce a formula start after the prefix.
 */
export function neutralizeForExport(value: string | number): string {
  const text = String(value).replace(/[\r\n\t]+/g, " ");
  return looksLikeFormula(text) ? `'${text}` : text;
}

/* ---------------------------------------------------------- storage path -- */

/** Characters permitted in a server-generated storage path segment. */
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Build the object path for an upload.
 *
 * The client's filename never appears here. The path is derived only from ids
 * the server already trusts, so a crafted filename cannot traverse out of the
 * workspace prefix or collide with another tenant's object.
 */
export function buildQuarantinePath(
  workspaceId: string,
  batchId: string,
  uploadId: string,
): string {
  for (const segment of [workspaceId, batchId, uploadId]) {
    if (!SAFE_SEGMENT.test(segment)) {
      throw new UnsafeStoragePathError(segment);
    }
  }
  return `${workspaceId}/${batchId}/${uploadId}.csv`;
}

export class UnsafeStoragePathError extends Error {
  readonly code = "INGEST_UNSAFE_STORAGE_PATH";
  constructor(readonly segment: string) {
    super("Refusing to build a storage path from an untrusted segment");
    this.name = "UnsafeStoragePathError";
  }
}

/**
 * True when `path` is one this server would have generated for `workspaceId`.
 * Finalize uses it so a client cannot point the batch at an object it does not
 * own (section 7.2 step 4).
 */
export function isOwnedQuarantinePath(path: string, workspaceId: string): boolean {
  if (!SAFE_SEGMENT.test(workspaceId)) return false;
  return new RegExp(
    `^${workspaceId}/[a-z0-9][a-z0-9-]{0,63}/[a-z0-9][a-z0-9-]{0,63}\\.csv$`,
  ).test(path);
}
