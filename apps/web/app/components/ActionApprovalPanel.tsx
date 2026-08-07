"use client";

import { useRef, useState } from "react";
import {
  ACTION_PAYLOAD_MAX_CHARS,
  approvalStateForSubmittedPayload,
  type ActionApprovalState,
  type VisibleActionPayload,
} from "../lib/live-action-detail";

interface Props {
  workspaceId: string;
  recommendationId: string;
  payload: VisibleActionPayload;
  initialApproval: ActionApprovalState;
}

interface DecidedPayload {
  content: string;
  approval: ActionApprovalState;
}

export default function ActionApprovalPanel({
  workspaceId,
  recommendationId,
  payload,
  initialApproval,
}: Props) {
  const [content, setContent] = useState(payload.content);
  const contentRef = useRef(payload.content);
  const [approval, setApproval] = useState(initialApproval);
  const [decidedPayload, setDecidedPayload] = useState<DecidedPayload>({
    content: payload.content,
    approval: initialApproval,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateContent(next: string) {
    contentRef.current = next;
    setContent(next);
    setError(null);
    if (next === decidedPayload.content) {
      setApproval(decidedPayload.approval);
    } else {
      setApproval({ status: "pending_approval", payloadHash: null, decidedAt: null });
    }
  }

  async function decide(decision: "approved" | "rejected") {
    const submittedContent = content;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/action-approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          recommendationId,
          content: submittedContent,
          decision,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { approval?: ActionApprovalState; error?: string }
        | null;
      if (!response.ok || !body?.approval) {
        setError(body?.error ?? "ACTION_APPROVAL_FAILED");
        return;
      }

      const decided = { content: submittedContent, approval: body.approval };
      setDecidedPayload(decided);
      const visibleApproval = approvalStateForSubmittedPayload(
        contentRef.current,
        submittedContent,
        body.approval,
      );
      if (visibleApproval) setApproval(visibleApproval);
    } catch {
      setError("ACTION_APPROVAL_FAILED");
    } finally {
      setBusy(false);
    }
  }

  const exactDecision =
    approval.status === "approved"
      ? "Approved for this exact payload"
      : approval.status === "rejected"
        ? "Rejected for this exact payload"
        : approval.status === "not_required"
          ? "Approval is not required for this action"
          : "Awaiting your decision";

  return (
    <div className="action-panel">
      <p className="note">
        This is the exact payload you are reviewing. Editing any character creates a new
        payload that does not reuse a previous approval.
      </p>
      <div className="field">
        <label>
          Visible action payload
          <textarea
            rows={10}
            value={content}
            readOnly={!payload.requiresApproval}
            disabled={busy}
            maxLength={ACTION_PAYLOAD_MAX_CHARS}
            onChange={(event) => updateContent(event.target.value)}
          />
        </label>
      </div>

      <div className="chip-row">
        <span
          className={`badge ${
            approval.status === "approved"
              ? "tag-good"
              : approval.status === "rejected"
                ? "tag-bad"
                : "tag-warn"
          }`}
        >
          {exactDecision}
        </span>
        {approval.decidedAt ? (
          <span className="muted">Recorded {new Date(approval.decidedAt).toLocaleString()}</span>
        ) : null}
      </div>

      {payload.requiresApproval ? (
        payload.approvable ? (
          <div className="actions" style={{ marginTop: 12 }}>
            <button
              className="action-btn btn-primary"
              disabled={busy || content.trim().length === 0}
              onClick={() => void decide("approved")}
            >
              {busy ? "Recording…" : "Approve exact payload"}
            </button>
            <button
              className="action-btn"
              disabled={busy || content.trim().length === 0}
              onClick={() => void decide("rejected")}
            >
              Reject payload
            </button>
          </div>
        ) : (
          <p className="alert" role="alert">
            This payload cannot be approved. It is empty or exceeds the permitted size.
          </p>
        )
      ) : null}

      {error ? (
        <p className="alert" role="alert">
          Approval could not be recorded. No protected action was executed. ({error})
        </p>
      ) : null}

      <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
        This control records approval only. It does not send a customer message, schedule a
        meeting, or write to the CRM.
      </p>
    </div>
  );
}
