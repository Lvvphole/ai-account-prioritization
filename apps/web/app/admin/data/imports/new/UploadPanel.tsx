"use client";

import { useState } from "react";
import type { ImportLimits, ImportTemplateKind } from "@repo/shared-schemas";
import { runPreflight, formatBytes, type PreflightResult } from "../../../../lib/import-preflight";

/**
 * Step 3: choose a file, check it, ask for an upload intent (section 7.2).
 *
 * The pre-flight here is a courtesy, not a control. Every check it runs also
 * runs server-side on the bytes that actually arrive, and the server does not
 * receive or trust its verdict — a passing pre-flight is a message to the
 * person at the keyboard, nothing more. It exists so somebody with a NUL byte
 * on row 40,000 learns that in a second rather than after uploading 10 MB.
 *
 * The intent request is what actually starts a batch. It is deliberately a
 * separate, explicit action: choosing a file is not consent to upload it.
 */

/** Enough to hold the header row and give the decoder something to judge. */
const HEAD_BYTES = 64 * 1024;

type IntentState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "created"; batchId: string; expiresAt: string }
  | { status: "refused"; reason: string };

export default function UploadPanel({
  kind,
  limits,
}: {
  kind: ImportTemplateKind;
  limits: ImportLimits;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [intent, setIntent] = useState<IntentState>({ status: "idle" });

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setFile(picked);
    setResult(null);
    setIntent({ status: "idle" });
    if (!picked) return;

    setChecking(true);
    try {
      const slice = picked.slice(0, HEAD_BYTES);
      const head = new Uint8Array(await slice.arrayBuffer());
      setResult(
        runPreflight(
          {
            filename: picked.name,
            contentType: picked.type || undefined,
            bytes: picked.size,
            head,
            headIsWholeFile: picked.size <= HEAD_BYTES,
          },
          kind,
          limits,
        ),
      );
    } finally {
      setChecking(false);
    }
  }

  async function requestIntent() {
    if (!file || !result?.ok) return;
    setIntent({ status: "requesting" });
    try {
      const response = await fetch("/api/admin/data/imports/upload-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateKind: kind,
          originalFilename: file.name,
          declaredContentType: file.type || undefined,
          declaredBytes: file.size,
        }),
      });
      const body = (await response.json()) as {
        batchId?: string;
        expiresAt?: string;
        reason?: string;
      };
      if (response.ok && body.batchId && body.expiresAt) {
        setIntent({ status: "created", batchId: body.batchId, expiresAt: body.expiresAt });
      } else {
        setIntent({
          status: "refused",
          reason: body.reason ?? "The server refused the request without giving a reason.",
        });
      }
    } catch {
      setIntent({
        status: "refused",
        reason: "The request could not be sent. Nothing was uploaded and no batch was created.",
      });
    }
  }

  const blocked = result?.issues.filter((i) => i.severity === "blocked") ?? [];
  const warnings = result?.issues.filter((i) => i.severity === "warning") ?? [];

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>3. Choose your file</h3>
          <p className="card-sub">
            UTF-8 CSV, up to {formatBytes(limits.maxBytes)} and{" "}
            {limits.maxRows.toLocaleString("en-US")} rows. Checked here before anything leaves your
            machine, and checked again on the server against the bytes it receives.
          </p>
        </div>
      </div>

      <label className="file-pick">
        <input type="file" accept=".csv,text/csv" onChange={onPick} />
        <span className="muted small">
          Nothing is uploaded when you pick a file. The next step is a separate, explicit action.
        </span>
      </label>

      {checking ? <p className="muted">Checking the file…</p> : null}

      {file && result ? (
        <div className="preflight">
          <div className="preflight-head">
            <span className={`badge ${result.ok ? "tag-good" : "tag-bad"}`}>
              {result.ok ? "Pre-flight passed" : "Pre-flight failed"}
            </span>
            <span className="muted">
              {file.name} · {formatBytes(result.bytes)} ·{" "}
              {result.headers.length > 0
                ? `${result.headers.length} columns`
                : "header not readable"}
            </span>
          </div>

          {blocked.length > 0 ? (
            <ul className="issue-list">
              {blocked.map((issue) => (
                <li key={issue.code} className="issue-blocked">
                  <span className="badge tag-bad">{issue.code}</span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {warnings.length > 0 ? (
            <ul className="issue-list">
              {warnings.map((issue) => (
                <li key={issue.code} className="issue-warn">
                  <span className="badge tag-warn">{issue.code}</span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {result.ok && blocked.length === 0 && warnings.length === 0 ? (
            <p className="muted">
              Filename, size, encoding and header all look right. The server still checks every one
              of these itself; this result grants nothing.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="actions">
        <button
          type="button"
          className="action-btn btn-primary"
          disabled={!result?.ok || intent.status === "requesting"}
          onClick={requestIntent}
        >
          {intent.status === "requesting" ? "Requesting…" : "Request upload intent"}
        </button>
      </div>

      {intent.status === "created" ? (
        <p className="note">
          Batch <code>{intent.batchId}</code> created in <strong>awaiting_upload</strong>. The
          signed URL expires at {intent.expiresAt} and points at a private quarantine path the
          server chose — your filename is recorded as metadata and never used to build it.
        </p>
      ) : null}

      {intent.status === "refused" ? (
        <p className="note note-bad">
          <span className="badge tag-bad">Refused</span> {intent.reason}
        </p>
      ) : null}
    </div>
  );
}
