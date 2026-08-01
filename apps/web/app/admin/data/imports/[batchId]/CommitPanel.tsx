"use client";

import { useState } from "react";
import type { IngestionState, SecondApprovalTrigger } from "@repo/shared-schemas";
import type { ApprovalState } from "../../../../lib/imports-data";

/**
 * Step 9: commit (section 7.2).
 *
 * Three things this deliberately does not do.
 *
 * It does not pre-fill the business reason. A reason somebody accepted is not a
 * reason somebody gave, and this text is what an incident review reads back.
 *
 * It does not let the first approver name the second. `secondApprovedBy` is a
 * record of who has approved so far, not a promise about who will, so the
 * second approval is a separate action taken by a different person from their
 * own session.
 *
 * It does not enable while a blocker is present — the parent renders a refusal
 * instead of this panel, because a disabled button next to a "request approval"
 * link would suggest the refusal is negotiable.
 */
export default function CommitPanel({
  batchId,
  state,
  mayCommit,
  committableRows,
  totalRows,
  approval,
  thresholds,
}: {
  batchId: string;
  state: IngestionState;
  mayCommit: boolean;
  committableRows: number;
  totalRows: number;
  approval: ApprovalState | null;
  thresholds: SecondApprovalTrigger;
}) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const alreadyCommitted =
    state === "committed" ||
    state === "completed" ||
    state === "processing_events" ||
    state === "rolled_back" ||
    state === "partially_rolled_back";

  const reasonOk = reason.trim().length >= 10;
  const ready = mayCommit && !alreadyCommitted && reasonOk && confirmed && committableRows > 0;

  if (alreadyCommitted) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Commit</h3>
            <p className="card-sub">This batch has already been committed.</p>
          </div>
        </div>
        <dl className="rule-list tight">
          <div>
            <dt>Approved by</dt>
            <dd>{approval?.approvedBy ?? "—"}</dd>
          </div>
          {approval?.secondApprovedBy ? (
            <div>
              <dt>Second approval</dt>
              <dd>{approval.secondApprovedBy}</dd>
            </div>
          ) : null}
          <div>
            <dt>Business reason</dt>
            <dd>{approval?.businessReason ?? "—"}</dd>
          </div>
        </dl>
        <p className="note">
          Imports have no delete. A rollback creates a compensating commit and leaves this record
          and its audit evidence exactly as they are.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Commit</h3>
          <p className="card-sub">
            {committableRows.toLocaleString("en-US")} of {totalRows.toLocaleString("en-US")} rows
            will be written. Quarantined and rejected rows stay staged and are not part of this.
          </p>
        </div>
      </div>

      {!mayCommit ? (
        <p className="note">
          <span className="badge">Read only</span> Committing an import needs the
          <code> commit_manual_import</code> capability. You can read everything on this page and
          nothing here will write.
        </p>
      ) : null}

      {approval?.secondApprovalRequired ? (
        <div className="note note-warn">
          <span className="badge tag-warn">Second approval required</span>{" "}
          {approval.reasons.join("; ")}. Your approval is recorded first; a second administrator
          approves from their own session, and the commit runs only once both are on record.
        </div>
      ) : null}

      <label className="field">
        <span className="field-label">Business reason</span>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={!mayCommit}
          placeholder="Why this import is being applied, in enough detail that somebody reading it in six months understands the decision."
        />
        <span className="muted small">
          {reasonOk
            ? "Recorded on the commit and the audit entry."
            : "At least 10 characters. This is what an incident review reads back."}
        </span>
      </label>

      <label className="confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          disabled={!mayCommit}
        />
        <span>
          I have read the change set above and I am approving these writes under my own name.
        </span>
      </label>

      <div className="actions">
        <button
          type="button"
          className="action-btn btn-primary"
          disabled={!ready}
          onClick={() =>
            setOutcome(
              `This deploy has no ingestion worker attached, so nothing was written. In a wired deployment this would create the approval for batch ${batchId}, run planCommit, and refuse if the plan contained a row that is not ready or warning.`,
            )
          }
        >
          Commit import
        </button>
      </div>

      {outcome ? (
        <p className="note">
          <span className="badge">Not wired</span> {outcome}
        </p>
      ) : null}

      <details className="thresholds">
        <summary>When a second approver is required</summary>
        <ul className="rule-list tight">
          <li>More than {thresholds.recordsChanged.toLocaleString("en-US")} operational records change.</li>
          <li>
            More than {Math.round(thresholds.workspaceAccountFraction * 100)} percent of workspace
            accounts change.
          </li>
          <li>
            More than {Math.round(thresholds.ownerChangeFraction * 100)} percent of account owners
            change.
          </li>
          <li>
            The absolute pipeline delta exceeds $
            {thresholds.absolutePipelineDeltaUsd.toLocaleString("en-US")}.
          </li>
        </ul>
        <p className="muted small">
          A cross-workspace reference and a hard security finding are not on this list. Neither is
          a bigger approval — both refuse the commit outright, and listing them here would imply
          two people could wave one through.
        </p>
      </details>
    </div>
  );
}
