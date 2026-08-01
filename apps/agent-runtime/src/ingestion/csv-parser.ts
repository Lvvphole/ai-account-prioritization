import {
  checkDecodedText,
  type EncodingRejection,
} from "@repo/security";
import type {
  ImportLimits,
  ParseOutcome,
  ParsedRow,
  ParseRejection,
} from "@repo/shared-schemas";

/**
 * Streaming RFC 4180 CSV parser (secure-ingestion spec, sections 7.1, 7.2 step 6
 * and 21.1).
 *
 * Three properties matter more than throughput:
 *
 *   1. It streams. A 10 MB file with 100,000 rows is parsed a chunk at a time
 *      and rows are handed to the caller as they complete, so peak memory is
 *      bounded by one row rather than by the file.
 *   2. It evaluates nothing. A cell beginning `=` is a string that begins with
 *      an equals sign. There is no formula path to reach.
 *   3. It stops at the first structural violation. Limits are checked while
 *      reading, not after, so an oversized file costs the limit rather than the
 *      whole file.
 *
 * There is deliberately no archive handling. A `.zip` never becomes a `.csv`
 * here, because the decompression step the spec forbids does not exist.
 */

/** A row the caller can accept or reject without the parser retaining it. */
export type RowHandler = (row: ParsedRow) => void;

export interface ParseOptions {
  limits: ImportLimits;
  /** Injected so tests can drive the clock rather than sleep. */
  now?: () => number;
}

const QUOTE = '"';
const COMMA = ",";
const CR = "\r";
const LF = "\n";

/** Maps an encoding rejection onto the parse vocabulary. */
function fromEncoding(rejection: EncodingRejection): ParseRejection {
  return rejection;
}

class ParseAbort extends Error {
  constructor(readonly rejection: ParseRejection) {
    super(rejection);
  }
}

/**
 * Parse a UTF-8 CSV stream, invoking `onRow` per data row.
 *
 * Returns an outcome rather than throwing for expected refusals: a rejected
 * file is a normal result the review UI has to display, not an exception.
 * `fatal` is set when the file was refused outright; `rowErrors` collects
 * per-row refusals while the rest of the file continues.
 */
export async function parseCsvStream(
  source: AsyncIterable<Uint8Array>,
  onRow: RowHandler,
  options: ParseOptions,
): Promise<ParseOutcome> {
  const { limits } = options;
  const now = options.now ?? Date.now;
  const startedAt = now();

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let headers: string[] = [];
  let bytesRead = 0;
  let rowsParsed = 0;
  let fatal: ParseRejection | null = null;
  const rowErrors: { rowNumber: number; reason: ParseRejection }[] = [];
  let truncated = false;

  // Parser state carried across chunk boundaries. `field` and `row` are the
  // only unbounded-ish buffers, and both are checked against the cell and
  // column limits on every append.
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let quoteJustClosed = false;
  let rowNumber = 1;
  let sawAnyContent = false;

  const finishField = (): void => {
    if (field.length > limits.maxCellCharacters) {
      throw new ParseAbort("cell_length_exceeded");
    }
    row.push(field);
    field = "";
    if (row.length > limits.maxColumns) {
      throw new ParseAbort("column_limit_exceeded");
    }
  };

  const finishRow = (): void => {
    finishField();
    // A trailing newline produces one empty field; that is not a row.
    if (row.length === 1 && row[0] === "") {
      row = [];
      return;
    }

    if (headers.length === 0) {
      headers = row.map((h) => h.trim());
      if (headers.length === 0) throw new ParseAbort("missing_header");
      const seen = new Set<string>();
      for (const h of headers) {
        if (seen.has(h)) throw new ParseAbort("duplicate_header");
        seen.add(h);
      }
      row = [];
      rowNumber += 1;
      return;
    }

    if (row.length !== headers.length) {
      // A row with the wrong shape is refused on its own. Continuing lets an
      // administrator see every bad row at once instead of one per re-upload.
      rowErrors.push({ rowNumber, reason: "inconsistent_column_count" });
      row = [];
      rowNumber += 1;
      return;
    }

    rowsParsed += 1;
    if (rowsParsed > limits.maxRows) {
      throw new ParseAbort("row_limit_exceeded");
    }

    const values: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      values[headers[i] as string] = row[i] as string;
    }
    onRow({ rowNumber, values });

    row = [];
    rowNumber += 1;
  };

  try {
    for await (const chunk of source) {
      bytesRead += chunk.byteLength;
      if (bytesRead > limits.maxBytes) throw new ParseAbort("byte_limit_exceeded");
      if (now() - startedAt > limits.maxProcessingMs) {
        throw new ParseAbort("duration_exceeded");
      }

      let text: string;
      try {
        text = decoder.decode(chunk, { stream: true });
      } catch {
        throw new ParseAbort("not_utf8");
      }

      const encodingProblem = checkDecodedText(text, false);
      if (encodingProblem) throw new ParseAbort(fromEncoding(encodingProblem));

      for (const char of text) {
        sawAnyContent = true;

        if (inQuotes) {
          if (quoteJustClosed) {
            quoteJustClosed = false;
            if (char === QUOTE) {
              field += QUOTE; // Escaped quote inside a quoted field.
              continue;
            }
            inQuotes = false;
            // Fall through so the character is handled unquoted.
          } else if (char === QUOTE) {
            quoteJustClosed = true;
            continue;
          } else {
            field += char;
            if (field.length > limits.maxCellCharacters) {
              throw new ParseAbort("cell_length_exceeded");
            }
            continue;
          }
        }

        if (char === QUOTE) {
          inQuotes = true;
          continue;
        }
        if (char === COMMA) {
          finishField();
          continue;
        }
        if (char === LF) {
          finishRow();
          continue;
        }
        if (char === CR) {
          continue; // CRLF: the LF does the work.
        }
        field += char;
        if (field.length > limits.maxCellCharacters) {
          throw new ParseAbort("cell_length_exceeded");
        }
      }
    }

    // Flush the decoder to catch a truncated multi-byte sequence at EOF.
    try {
      const tail = decoder.decode();
      if (tail.length > 0) {
        const problem = checkDecodedText(tail, false);
        if (problem) throw new ParseAbort(fromEncoding(problem));
      }
    } catch (error) {
      if (error instanceof ParseAbort) throw error;
      throw new ParseAbort("not_utf8");
    }

    if (!sawAnyContent) throw new ParseAbort("empty_file");
    if (inQuotes && !quoteJustClosed) throw new ParseAbort("unterminated_quote");

    // A final row with no trailing newline still counts.
    if (field.length > 0 || row.length > 0) finishRow();
  } catch (error) {
    if (error instanceof ParseAbort) {
      fatal = error.rejection;
      truncated = true;
    } else {
      throw error;
    }
  }

  return {
    headers,
    rowsParsed,
    bytesRead,
    durationMs: now() - startedAt,
    fatal,
    rowErrors: rowErrors.slice(0, 1000),
    truncated,
  };
}
