import { can } from "@repo/security";
import type { IngestionState } from "@repo/shared-schemas";
import { requireCapability } from "../../../lib/auth";
import {
  IMPORT_BATCHES,
  IMPORT_HISTORY_IS_SAMPLE,
  IMPORT_LIMITS,
  committableRows,
  shortId,
  totalRows,
} from "../../../lib/imports-data";
import { formatBytes } from "../../../lib/import-preflight";
import { loadLiveImportList, type LiveImportListRow } from "../../../lib/live-imports-data";
import { isSupabaseConfigured } from "../../../lib/supabase/config";
import { IngestionStatePill, SampleNotice } from "../../../components/ImportBits";
import { Section } from "../../../components/AdminBits";
import DataSubnav from "../../../components/DataSubnav";

export const metadata = { title: "Imports" };

interface ImportListRow {
  batchId: string;
  name: string;
  detail: string;
  type: string;
  state: IngestionState;
  rows: number;
  committable: number;
  uploaded: string;
  uploadedBy: string;
}

/**
 * Manual CSV imports (secure-ingestion spec, section 7).
 *
 * A configured deployment reads batch history from persistence. Static fixtures
 * remain available only in explicit demo mode and stay visibly labeled as
 * sample data.
 */
export default async function ImportsPage() {
  const ctx = await requireCapability("view_ingestion_batches");
  const mayImport = can(ctx.role, "create_manual_import");
  const live = isSupabaseConfigured();
  const rows = live ? liveRows(await loadLiveImportList()) : sampleRows();

  return (
    <section>
      <div className="page-header">
        <h1>Imports</h1>
        <p className="muted">
          Upload a CSV, review exactly what would change, and commit it under your name. Nothing
          reaches an operational record without a person approving the change set first.
        </p>
      </div>

      <DataSubnav />

      <Section
        title="Batches"
        sub="Every import, including refused ones. A batch is never deleted; a rollback appends a compensating commit."
        action={
          mayImport ? (
            <a className="action-btn btn-primary" href="/admin/data/imports/new">
              New import
            </a>
          ) : (
            <span className="badge">Read only</span>
          )
        }
      >
        {!live && IMPORT_HISTORY_IS_SAMPLE ? <SampleNotice what="The batch history below" /> : null}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Batch</th>
                <th scope="col">Type</th>
                <th scope="col">State</th>
                <th scope="col">Rows</th>
                <th scope="col">Committable</th>
                <th scope="col">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No persisted import batches are visible to this workspace.
                  </td>
                </tr>
              ) : (
                rows.map((b) => (
                  <tr key={b.batchId}>
                    <td>
                      <a href={`/admin/data/imports/${b.batchId}`}>{b.name}</a>
                      <div className="muted small">{b.detail}</div>
                    </td>
                    <td>{b.type}</td>
                    <td>
                      <IngestionStatePill state={b.state} />
                    </td>
                    <td className="num">{b.rows.toLocaleString("en-US")}</td>
                    <td className="num">
                      {b.committable.toLocaleString("en-US")}
                      {b.rows > 0 && b.committable < b.rows ? (
                        <span className="muted"> of {b.rows.toLocaleString("en-US")}</span>
                      ) : null}
                    </td>
                    <td>
                      {b.uploaded}
                      <div className="muted small">{b.uploadedBy}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Limits"
        sub="Server-configured and shown before upload, so a rejection is predictable rather than a surprise after a long wait."
      >
        <div className="metric-grid compact">
          <Limit label="Maximum file size" value={formatBytes(IMPORT_LIMITS.maxBytes)} />
          <Limit label="Maximum rows" value={IMPORT_LIMITS.maxRows.toLocaleString("en-US")} />
          <Limit label="Maximum columns" value={String(IMPORT_LIMITS.maxColumns)} />
          <Limit
            label="Maximum cell length"
            value={`${IMPORT_LIMITS.maxCellCharacters.toLocaleString("en-US")} chars`}
          />
          <Limit
            label="Maximum processing time"
            value={`${Math.round(IMPORT_LIMITS.maxProcessingMs / 60000)} min`}
          />
          <Limit
            label="Concurrent batches"
            value={String(IMPORT_LIMITS.maxConcurrentBatches)}
          />
        </div>
        <p className="note">
          UTF-8 only. A CSV has no magic signature, so no single check establishes that a file is
          safe — the extension, the declared type, the encoding, the control characters, the
          structure and the parser bounds are all checked, and the declared type is treated as
          advisory rather than as evidence.
        </p>
      </Section>
    </section>
  );
}

function liveRows(batches: LiveImportListRow[]): ImportListRow[] {
  return batches.map((batch) => ({
    batchId: batch.batchId,
    name: batch.name,
    detail: shortId(batch.batchId),
    type: batch.objectType ?? batch.mappingVersionId ?? "—",
    state: batch.state,
    rows: batch.totalRows,
    committable: batch.committableRows,
    uploaded: batch.createdAt,
    uploadedBy: batch.createdBy,
  }));
}

function sampleRows(): ImportListRow[] {
  return IMPORT_BATCHES.map((batch) => {
    const rows = totalRows(batch.dispositions);
    return {
      batchId: batch.batchId,
      name: batch.name,
      detail: `${shortId(batch.batchId)} · ${batch.originalFilename} · ${formatBytes(batch.bytes)}`,
      type: batch.mappingVersion,
      state: batch.state,
      rows,
      committable: committableRows(batch.dispositions),
      uploaded: batch.uploadedAt,
      uploadedBy: batch.uploadedBy,
    };
  });
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-val">{value}</span>
    </div>
  );
}
