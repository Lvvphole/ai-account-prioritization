"use client";

import { useState } from "react";
import type { IngestionState, SecondApprovalTrigger } from "@repo/shared-schemas";
import type { ApprovalState } from "../../../../lib/imports-data";

interface ApiResult {
  status?: unknown;
  commitId?: unknown;
  recordsCreated?: unknown;
  recordsUpdated?: unknown;
  detail?: unknown;
  error?: unknown;
}

async function readResult(response: Response): Promise<ApiResult> {
  const value = (await response.json().catch(() => ({}))) as unknown;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ApiResult)
    : {};
}

function refusalMessage(result: ApiResult): string {
  if (typeof result.detail === "string" && result.detail) return result.detail;
  if (typeof result.error === "string" && result.error) return result.error;
  return "The server refused the import operation.";
}

/**
 * Step 9: approve and commit the reviewed change set.
 *
 * The browser supplies only the batch id and the business reason. The server
 * resolves workspace, change set, staged rows, approver identity, approval
 * threshold, and commit targets from persistence. A second approval is recorded
 * only when the second administrator acts from their own authenticated session.
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
  const [reason, setReason] = useState(approval?.businessReason ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const alreadyCommitted =
    state === "committed" ||
    state === "completed" ||
    state === "processing_events" ||
    state === "rolled_back" ||
    state === "partially_rolled_back";

  const reasonLocked = approval?.approvedBy !== null && approval?.approvedBy !== undefined;
  const awaitingSecond =
    approval?.secondApprovalRequired === true &&
    approval.approvedBy !== null &&
    approval.secondApprovedBy === null;
  const reasonOk = reason.trim().length >= 10;
  const ready =
    mayCommit &&
    !alreadyCommitted &&
    !busy &&
    reasonOk &&
    confirmed &&
    committableRows > 0;

  async function approveAndCommit(): Promise<void> {
    setBusy(true);
    setOutcome(null);
    try {
      const approvalResponse = await fetch(`/api/admin/data/imports/${batchId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessReason: reason.trim() }),
      });
      const approvalResult = await readResult(approvalResponse);
      if (!approvalResponse.ok) {
        setOutcome(`Commit refused: ${refusalMessage(approvalResult)}`);
        return;
      }

      if (approvalResult.status === "awaiting_second_approval") {
        setOutcome(
          "Your approval is recorded. A different workspace administrator must approve this same change set from their own session before it can commit.",
        );
        return;
      }

      if (approvalResult.status !== "approved") {
        setOutcome("Commit refused: the approval service returned an invalid state.");
        return;
      }

      const commitResponse = await fetch(`/api/admin/data/imports/${batchId}/commit`, {
        method: "POST",
      });
      const commitResult = await readResult(commitResponse);
      if (!commitResponse.ok) {
        setOutcome(`Commit refused: ${refusalMessage(commitResult)}`);
        return;
      }

      if (commitResult.status !== "committed") {
        setOutcome("Commit refused: the commit service returned an invalid state.");
        return;
      }

      const created =
        typeof commitResult.recordsCreated === "number" ? commitResult.recordsCreated : 0;
      const updated =
        typeof commitResult.recordsUpdated === "number" ? commitResult.recordsUpdated : 0;
      const commitId = typeof commitResult.commitId === "string" ? commitResult.commitId : "unknown";
      setOutcome(
        `Committed ${created.toLocaleString("en-US")} new and ${updated.toLocaleString("en-US")} updated records. Commit ${commitId}.`,
      );
      setConfirmed(false);
    } catch {
      setOutcome("Commit refused: the ingestion service could not be reached.");
    } finally {
      setBusy(false);
    }
  }

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
          {approval.reasons.join("; ")}. The second administrator must approve the same recorded
          business reason from their own session.
        </div>
      ) : null}

      <label className="field">
        <span className="field-label">Business reason</span>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={!mayCommit || reasonLocked || busy}
          placeholder="Why this import is being applied, in enough detail that somebody reading it in six months understands the decision."
        />
        <span className="muted small">
          {reasonLocked
            ? "This is the reason already bound to the recorded approval and it cannot be changed."
            : reasonOk
              ? "Recorded on the approval, commit, and audit evidence."
              : "At least 10 characters. This is what an incident review reads back."}
        </span>
      </label>

      <label className="confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          disabled={!mayCommit || busy}
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
          onClick={() => void approveAndCommit()}
        >
          {busy ? "Working…" : awaitingSecond ? "Approve and commit import" : "Commit import"}
        </button>
      </div>

      {outcome ? <p className="note">{outcome}</p> : null}

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
          a bigger approval. Both refuse the commit outright.
        </p>
      </details>
    </div>
  );
}
