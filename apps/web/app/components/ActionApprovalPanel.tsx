"use client";

import { useRef, useState } from "react";
import {
  ACTION_PAYLOAD_MAX_CHARS,
  approvalStateForSubmittedPayload,
  canRequestProtectedExecution,
  executionStateForSubmittedPayload,
  type ActionApprovalState,
  type ActionExecutionState,
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

interface ExecutedPayload {
  content: string;
  execution: ActionExecutionState;
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
  const [execution, setExecution] = useState<ActionExecutionState | null>(null);
  const [executedPayload, setExecutedPayload] = useState<ExecutedPayload | null>(null);
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

    if (executedPayload?.content === next) {
      setExecution(executedPayload.execution);
    } else {
      setExecution(null);
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
      if (decision === "rejected") {
        setExecution(null);
        setExecutedPayload(null);
      }
    } catch {
      setError("ACTION_APPROVAL_FAILED");
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    const submittedContent = content;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/action-executions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          recommendationId,
          content: submittedContent,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { execution?: ActionExecutionState; error?: string }
        | null;
      if (!response.ok || !body?.execution) {
        setError(body?.error ?? "ACTION_EXECUTION_FAILED");
        return;
      }

      const executed = { content: submittedContent, execution: body.execution };
      setExecutedPayload(executed);
      const visibleExecution = executionStateForSubmittedPayload(
        contentRef.current,
        submittedContent,
        body.execution,
      );
      if (visibleExecution) setExecution(visibleExecution);
    } catch {
      setError("ACTION_EXECUTION_FAILED");
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

  const canExecute = canRequestProtectedExecution(payload);
  const executionLabel =
    execution?.status === "PASS"
      ? "CRM write verified"
      : execution?.status === "FAIL"
        ? `Execution failed: ${execution.resultCode}`
        : execution?.status === "BLOCKED"
          ? `Execution blocked: ${execution.resultCode}`
          : null;

  return (
    <div className="action-panel">
      <p className="note">
        This is the exact payload you are reviewing. Editing any character creates a new
        payload that does not reuse a previous approval or execution result.
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
              {busy ? "Working…" : "Approve exact payload"}
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

      {canExecute && approval.status === "approved" ? (
        <div className="actions" style={{ marginTop: 12 }}>
          <button
            className="action-btn btn-primary"
            disabled={busy || content.trim().length === 0}
            onClick={() => void execute()}
          >
            {busy ? "Working…" : "Execute approved CRM write-back"}
          </button>
        </div>
      ) : null}

      {payload.requiresApproval && approval.status === "approved" && !canExecute ? (
        <p className="note">
          Approval is recorded, but this action has no authorized in-app external executor.
          No customer-facing send, call, or meeting is reported as executed.
        </p>
      ) : null}

      {executionLabel ? (
        <div className="chip-row" style={{ marginTop: 12 }}>
          <span
            className={`badge ${
              execution?.status === "PASS"
                ? "tag-good"
                : execution?.status === "FAIL"
                  ? "tag-bad"
                  : "tag-warn"
            }`}
          >
            {executionLabel}
          </span>
          {execution?.executedAt ? (
            <span className="muted">
              Executed {new Date(execution.executedAt).toLocaleString()}
              {execution.replayed ? " · idempotent replay" : ""}
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="alert" role="alert">
          The request could not be completed. No unverified protected action is reported as
          executed. ({error})
        </p>
      ) : null}

      <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
        Execution rechecks current workspace, account owner, recommendation verification,
        exact-payload approval, and idempotency in PostgreSQL immediately before the write.
        Unit 5 executes only the deterministic CRM research-note action. Customer-facing
        external execution remains blocked.
      </p>
    </div>
  );
}
