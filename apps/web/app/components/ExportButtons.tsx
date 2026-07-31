"use client";

import { useState } from "react";

type Row = Record<string, string | number>;

/**
 * Download the current view as CSV or JSON. The rows are already rendered on
 * the page, so the export is built in the browser from the same data — no
 * second query, and nothing can be exported that the viewer could not already
 * see.
 */
export default function ExportButtons({
  rows,
  filename,
}: {
  rows: Row[];
  filename: string;
}) {
  const [done, setDone] = useState<string | null>(null);

  function save(content: string, mime: string, ext: string) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setDone(ext.toUpperCase());
    setTimeout(() => setDone(null), 1600);
  }

  return (
    <div className="actions">
      <button className="action-btn" onClick={() => save(toCsv(rows), "text/csv", "csv")}>
        ↓ CSV
      </button>
      <button
        className="action-btn"
        onClick={() => save(JSON.stringify(rows, null, 2), "application/json", "json")}
      >
        ↓ JSON
      </button>
      <span className="export-note">
        {done ? `${done} downloaded ✓` : `${rows.length} rows`}
      </span>
    </div>
  );
}

/** RFC 4180: quote every field, double any embedded quote. */
function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] as Row);
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const lines = [
    headers.map(escape).join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h] ?? "")).join(",")),
  ];
  return lines.join("\r\n");
}
