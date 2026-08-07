import { notFound } from "next/navigation";
import { can } from "@repo/security";
import { requireCapability } from "../../../../lib/auth";
import {
  CHANGE_KIND_LABEL,
  SECOND_APPROVAL_TRIGGER,
  findBatch,
  formatUsd,
  shortId,
  committableRows,
  totalRows,
} from "../../../../lib/imports-data";
import { formatBytes } from "../../../../lib/import-preflight";
import { loadLiveImportBatch, type LiveImportBatch } from "../../../../lib/live-imports-data";
import { isSupabaseConfigured } from "../../../../lib/supabase/config";
import { Section } from "../../../../components/AdminBits";
import {
  DispositionBar,
  FindingsTable,
  IngestionStatePill,
  Lineage,
  SampleNotice,
  ScanChecklist,
} from "../../../../components/ImportBits";
import DataSubnav from "../../../../components/DataSubnav";
import CommitPanel from "./CommitPanel";

/**
 * One import batch, end to end (section 7.2 steps 5 to 10).
 *
 * A configured deployment reads this page from persistence before it can render
 * the live commit control. Demo fixtures remain isolated to unconfigured sample
 * mode and never provide ids to the live approval or commit endpoints.
 */
export default async function ImportBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const ctx = await requireCapability("view_ingestion_batches");
  const { batchId } = await params;
  const mayCommit = can(ctx.role, "commit_manual_import");

  if (isSupabaseConfigured()) {
    const batch = await loadLiveImportBatch(batchId);
    if (!batch) notFound();
    return <LiveImportDetail batch={batch} mayCommit={mayCommit} />;
  }

  const batch = findBatch(batchId);
  if (!batch) notFound();

  const rows = totalRows(batch.dispositions);
  const committable = committableRows(batch.dispositions);
  const blockers = batch.approval?.blockers ?? [];

  return (
    <section>
      <div className="page-header">
        <h1>
          {batch.name} <IngestionStatePill state={batch.state} />
        </h1>
        <p className="muted">
          Batch {shortId(batch.batchId)} · {batch.originalFilename} · {formatBytes(batch.bytes)} ·
          uploaded by {batch.uploadedBy} at {batch.uploadedAt}
        </p>
      </div>

      <DataSubnav />
      <SampleNotice what="This batch" />

      <Section
        title="File"
        sub="The raw upload lives in a private quarantine bucket and is deleted after 7 days. What survives is the batch, the staged rows and the audit evidence."
      >
        <dl className="rule-list tight">
          <div>
            <dt>Mapping version</dt>
            <dd>
              <code>{batch.mappingVersion}</code> — the exact mapping this file was read with. A
              published mapping is never edited in place, so this reference stays true.
            </dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd>
              <code className="hash">{batch.sha256}</code>
            </dd>
          </div>
          <div>
            <dt>Template</dt>
            <dd>{batch.templateKind.replace(/_/g, " ")}</dd>
          </div>
        </dl>
      </Section>

      <Section title="Security scan" sub="Section 7.2 step 5. Every check is shown, whether it passed or not.">
        {batch.scan ? (
          <ScanChecklist
            checks={batch.scan.checks}
            malwareStatus={batch.scan.malwareStatus}
            providerId={batch.scan.providerId}
          />
        ) : (
          <p className="muted">Not scanned yet.</p>
        )}
      </Section>

      <Section
        title="Parse"
        sub="Streaming, bounded, and never evaluating a cell. A malformed row is refused on its own; the rest of the file still parses."
      >
        {batch.parse ? (
          <>
            <div className="metric-grid compact">
              <Fact label="Rows parsed" value={batch.parse.rowsParsed.toLocaleString("en-US")} />
              <Fact label="Columns" value={String(batch.parse.headers.length)} />
              <Fact label="Duration" value={`${(batch.parse.durationMs / 1000).toFixed(1)} s`} />
              <Fact
                label="Row errors"
                value={String(batch.parse.rowErrors.length)}
                tone={batch.parse.rowErrors.length > 0 ? "warn" : undefined}
              />
            </div>
            {batch.parse.rowErrors.length > 0 ? (
              <ul className="issue-list">
                {batch.parse.rowErrors.map((e) => (
                  <li key={e.rowNumber} className="issue-warn">
                    <span className="badge tag-warn">row {e.rowNumber}</span>
                    <span>
                      <code>{e.reason}</code>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {batch.parse.truncated ? (
              <p className="note note-bad">
                The file hit a parser bound and was truncated. Counts below describe what was read,
                not what the file contains.
              </p>
            ) : null}
          </>
        ) : (
          <p className="muted">Not parsed yet.</p>
        )}
      </Section>

      <Section
        title="Rows"
        sub={`${rows.toLocaleString("en-US")} staged. ${committable.toLocaleString("en-US")} can commit.`}
      >
        <DispositionBar dispositions={batch.dispositions} />
      </Section>

      <Section
        title="Findings"
        sub="Grouped by rule. Values are redacted before they are stored, so nothing here carries a raw customer value."
      >
        <FindingsTable findings={batch.findings} />
      </Section>

      {batch.changeSet ? (
        <Section
          title="Change set"
          sub="Derived only from the staged rows and the current snapshot. What you read here is what a commit applies."
        >
          <div className="metric-grid compact">
            <Fact label="New records" value={batch.changeSet.newRecords.toLocaleString("en-US")} />
            <Fact label="Updated" value={batch.changeSet.updatedRecords.toLocaleString("en-US")} />
            <Fact label="Unchanged" value={batch.changeSet.unchangedRecords.toLocaleString("en-US")} />
            <Fact
              label="Ownership changes"
              value={batch.changeSet.ownerChanges.toLocaleString("en-US")}
              tone={batch.changeSet.ownerChanges > 0 ? "warn" : undefined}
            />
            <Fact
              label="Referential failures"
              value={batch.changeSet.referentialFailures.toLocaleString("en-US")}
              tone={batch.changeSet.referentialFailures > 0 ? "bad" : undefined}
            />
            <Fact label="Duplicates" value={batch.changeSet.duplicateRecords.toLocaleString("en-US")} />
            <Fact
              label="Pipeline delta"
              value={formatUsd(batch.changeSet.pipelineDeltaUsd)}
              tone={batch.changeSet.pipelineDeltaUsd < 0 ? "warn" : undefined}
              hint="Signed. An import that lowers pipeline reads as a cut."
            />
            <Fact
              label="Predicted guardrail holds"
              value={batch.changeSet.predictedGuardrailHolds.toLocaleString("en-US")}
            />
          </div>

          <div className="rank-impact">
            <span className="writeback-title">Top-N movement</span>
            {batch.changeSet.rankImpact ? (
              <p>
                <strong>{batch.changeSet.rankImpact.accountsEnteringTopN}</strong> accounts enter
                and <strong>{batch.changeSet.rankImpact.accountsLeavingTopN}</strong> leave the top{" "}
                {batch.changeSet.rankImpact.topN}, computed by running the deterministic scorer
                over a scratch projection that is then discarded. No recommendation is published by
                previewing.
              </p>
            ) : (
              <p className="muted">
                <span className="badge">Not computed</span>{" "}
                {batch.changeSet.rankImpactUnavailableReason}
              </p>
            )}
          </div>

          {batch.changeSet.concentrationNotes ? (
            <p className="note">{batch.changeSet.concentrationNotes}</p>
          ) : null}

          {batch.changeSet.items.length > 0 ? (
            <>
              <span className="writeback-title">Sample of what changes</span>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Record</th>
                      <th scope="col">Change</th>
                      <th scope="col">Before</th>
                      <th scope="col">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.changeSet.items.map((item) => (
                      <tr key={`${item.sourceRowNumber}-${item.externalId}`}>
                        <td className="num">{item.sourceRowNumber}</td>
                        <td>
                          <code>{item.externalId}</code>
                        </td>
                        <td>
                          <span
                            className={`badge${item.changeKind === "owner_change" ? " tag-warn" : ""}`}
                          >
                            {CHANGE_KIND_LABEL[item.changeKind]}
                          </span>
                        </td>
                        <td>
                          <FieldValues values={item.beforeValues} empty="—" />
                        </td>
                        <td>
                          <FieldValues values={item.afterValues} empty="—" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">
                Before and after are recorded for every changed field, not a fixed subset. That is
                what makes a rollback exact rather than approximate.
              </p>
            </>
          ) : null}
        </Section>
      ) : null}

      {blockers.length > 0 ? (
        <CommitRefusal blockers={blockers} />
      ) : (
        <CommitPanel
          batchId={batch.batchId}
          state={batch.state}
          mayCommit={mayCommit}
          committableRows={committable}
          totalRows={rows}
          approval={batch.approval}
          thresholds={SECOND_APPROVAL_TRIGGER}
        />
      )}

      {batch.lineage.length > 0 ? (
        <Section
          title="Results"
          sub="Section 7.2 step 10. The full path from the file you uploaded to the recommendations it moved."
        >
          <Lineage hops={batch.lineage} />
        </Section>
      ) : null}

      {batch.rollback ? (
        <Section title="Rollback" sub="Compensating, never destructive. The original commit and its audit evidence stay exactly as they were.">
          <dl className="rule-list tight">
            <div>
              <dt>Issued</dt>
              <dd>
                {batch.rollback.issuedAt} by {batch.rollback.issuedBy}
              </dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>{batch.rollback.reason}</dd>
            </div>
            <div>
              <dt>Records restored</dt>
              <dd>{batch.rollback.recordsRestored.toLocaleString("en-US")}</dd>
            </div>
          </dl>
          {batch.rollback.conflicts.length > 0 ? (
            <>
              <p className="note">
                These records changed after the original commit and were left alone. Restoring them
                would destroy somebody's later edit, so the rollback reports them instead.
              </p>
              <ul className="issue-list">
                {batch.rollback.conflicts.map((c) => (
                  <li key={c.externalId} className="issue-warn">
                    <span className="badge tag-warn">{c.externalId}</span>
                    <span>{c.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Section>
      ) : null}
    </section>
  );
}

function LiveImportDetail({ batch, mayCommit }: { batch: LiveImportBatch; mayCommit: boolean }) {
  const committable = batch.readyRows + batch.warningRows;
  const commitState = batch.state === "ready_for_review" || batch.state === "awaiting_approval";
  const liveMayCommit = mayCommit && commitState && batch.changeSet !== null;

  return (
    <section>
      <div className="page-header">
        <h1>
          {batch.name} <IngestionStatePill state={batch.state} />
        </h1>
        <p className="muted">
          Batch {shortId(batch.batchId)} · created by {batch.createdBy} at {batch.createdAt}
        </p>
      </div>

      <DataSubnav />

      <Section
        title="File"
        sub="Live persisted evidence for the file and mapping used by this batch."
      >
        <dl className="rule-list tight">
          <div>
            <dt>Mapping version id</dt>
            <dd><code>{batch.mappingVersionId ?? "—"}</code></dd>
          </div>
          <div>
            <dt>Original file</dt>
            <dd>{batch.file?.originalFilename ?? "—"}</dd>
          </div>
          <div>
            <dt>File size</dt>
            <dd>{batch.file ? formatBytes(batch.file.bytes) : "—"}</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd><code className="hash">{batch.file?.sha256 ?? "—"}</code></dd>
          </div>
          <div>
            <dt>Scan status</dt>
            <dd>{batch.file?.scanStatus ?? "—"}</dd>
          </div>
        </dl>
      </Section>

      <Section
        title="Rows"
        sub={`${batch.totalRows.toLocaleString("en-US")} staged. ${committable.toLocaleString("en-US")} can commit.`}
      >
        <DispositionBar
          dispositions={{
            ready: batch.readyRows,
            warning: batch.warningRows,
            quarantined: batch.quarantinedRows,
            rejected: batch.rejectedRows,
            duplicate: batch.duplicateRows,
          }}
        />
      </Section>

      {batch.changeSet ? (
        <Section
          title="Change set"
          sub="This persisted preview is the change set that the approval boundary binds before commit."
        >
          <div className="metric-grid compact">
            <Fact label="New records" value={batch.changeSet.newRecords.toLocaleString("en-US")} />
            <Fact label="Updated" value={batch.changeSet.updatedRecords.toLocaleString("en-US")} />
            <Fact label="Unchanged" value={batch.changeSet.unchangedRecords.toLocaleString("en-US")} />
            <Fact
              label="Ownership changes"
              value={batch.changeSet.ownerChanges.toLocaleString("en-US")}
              tone={batch.changeSet.ownerChanges > 0 ? "warn" : undefined}
            />
            <Fact
              label="Referential failures"
              value={batch.changeSet.referentialFailures.toLocaleString("en-US")}
              tone={batch.changeSet.referentialFailures > 0 ? "bad" : undefined}
            />
            <Fact label="Duplicates" value={batch.changeSet.duplicateRecords.toLocaleString("en-US")} />
            <Fact
              label="Pipeline delta"
              value={formatUsd(batch.changeSet.pipelineDeltaUsd)}
              tone={batch.changeSet.pipelineDeltaUsd < 0 ? "warn" : undefined}
            />
            <Fact
              label="Predicted guardrail holds"
              value={batch.changeSet.predictedGuardrailHolds.toLocaleString("en-US")}
            />
          </div>
          {batch.changeSet.concentrationNotes ? (
            <p className="note">{batch.changeSet.concentrationNotes}</p>
          ) : null}
        </Section>
      ) : (
        <Section title="Change set" sub="No persisted preview is available.">
          <p className="note note-bad">Commit stays disabled until a persisted change set exists.</p>
        </Section>
      )}

      {batch.blockers.length > 0 ? (
        <CommitRefusal blockers={batch.blockers} />
      ) : (
        <CommitPanel
          batchId={batch.batchId}
          state={batch.state}
          mayCommit={liveMayCommit}
          committableRows={committable}
          totalRows={batch.totalRows}
          approval={batch.approval}
          thresholds={SECOND_APPROVAL_TRIGGER}
        />
      )}
    </section>
  );
}

function CommitRefusal({ blockers }: { blockers: string[] }) {
  return (
    <Section title="Commit refused" sub="These are not approvals that are missing. They are refusals.">
      <ul className="issue-list">
        {blockers.map((blocker) => (
          <li key={blocker} className="issue-blocked">
            <span className="badge tag-bad">{blocker}</span>
            <span>
              {blocker === "cross_workspace_reference"
                ? "The file references records belonging to another workspace. No number of approvers makes this safe, so it is refused rather than escalated."
                : "A hard security finding is present. It is not approvable by anyone."}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function FieldValues({ values, empty }: { values: Record<string, string>; empty: string }) {
  const entries = Object.entries(values);
  if (entries.length === 0) return <span className="muted">{empty}</span>;
  return (
    <ul className="kv">
      {entries.map(([field, value]) => (
        <li key={field}>
          <span className="kv-key">{field}</span>
          <span className="kv-val">{value === "" ? <em className="muted">cleared</em> : value}</span>
        </li>
      ))}
    </ul>
  );
}

function Fact({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "warn" | "bad";
  hint?: string;
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className={`metric-val${tone ? ` m-${tone}` : ""}`}>{value}</span>
      {hint ? <span className="metric-hint">{hint}</span> : null}
    </div>
  );
}
