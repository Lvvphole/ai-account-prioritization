import { can } from "@repo/security";
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
import { IngestionStatePill, SampleNotice } from "../../../components/ImportBits";
import { Section } from "../../../components/AdminBits";
import DataSubnav from "../../../components/DataSubnav";

export const metadata = { title: "Imports" };

/**
 * Manual CSV imports (secure-ingestion spec, section 7).
 *
 * The list is the audit surface as much as the working surface: every batch
 * ever started stays here with its disposition counts, including the ones that
 * were refused, because "why did that file not import" is the question this
 * page exists to answer.
 *
 * The capability checks below are the page's own, and today they are the looser
 * of two: the admin layout still gates the whole section on `edit_scoring_config`,
 * which only an admin holds, so the manager read-only path these checks describe
 * is not reachable yet. They are written to the RBAC matrix rather than to the
 * layout so that opening the section to managers is a change in one place.
 */
export default async function ImportsPage() {
  const ctx = await requireCapability("view_ingestion_batches");
  const mayImport = can(ctx.role, "create_manual_import");

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
        {IMPORT_HISTORY_IS_SAMPLE ? <SampleNotice what="The batch history below" /> : null}

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
              {IMPORT_BATCHES.map((b) => {
                const rows = totalRows(b.dispositions);
                const ok = committableRows(b.dispositions);
                return (
                  <tr key={b.batchId}>
                    <td>
                      <a href={`/admin/data/imports/${b.batchId}`}>{b.name}</a>
                      <div className="muted small">
                        {shortId(b.batchId)} · {b.originalFilename} · {formatBytes(b.bytes)}
                      </div>
                    </td>
                    <td>{b.mappingVersion}</td>
                    <td>
                      <IngestionStatePill state={b.state} />
                    </td>
                    <td className="num">{rows.toLocaleString("en-US")}</td>
                    <td className="num">
                      {ok.toLocaleString("en-US")}
                      {rows > 0 && ok < rows ? (
                        <span className="muted"> of {rows.toLocaleString("en-US")}</span>
                      ) : null}
                    </td>
                    <td>
                      {b.uploadedAt}
                      <div className="muted small">{b.uploadedBy}</div>
                    </td>
                  </tr>
                );
              })}
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

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-val">{value}</span>
    </div>
  );
}
