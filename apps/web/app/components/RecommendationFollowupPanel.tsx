"use client";

import { useState } from "react";
import {
  FEEDBACK_CODES,
  OUTCOME_CODES,
  parseRecommendationFollowupState,
  type RecommendationFollowupCode,
  type RecommendationFollowupKind,
  type RecommendationFollowupState,
} from "../lib/recommendation-followup-contract";

const FEEDBACK_LABELS: Record<(typeof FEEDBACK_CODES)[number], string> = {
  accepted: "Recommendation was useful",
  rejected: "Recommendation was not useful",
  snoozed: "Timing is not right",
  completed: "Action was already completed",
  edited: "Action needed edits",
};

const OUTCOME_LABELS: Record<(typeof OUTCOME_CODES)[number], string> = {
  meeting_booked: "Meeting booked",
  opportunity_advanced: "Opportunity advanced",
  renewal_completed: "Renewal completed",
  expansion: "Expansion",
  closed_won: "Closed won",
  closed_lost: "Closed lost",
  churned: "Churned",
  no_response: "No response",
};

function defaultCode(kind: RecommendationFollowupKind): RecommendationFollowupCode {
  if (kind === "feedback") return FEEDBACK_CODES[0];
  if (kind === "outcome") return OUTCOME_CODES[0];
  return "unknown";
}

function recordedLabel(state: RecommendationFollowupState): string {
  if (state.status === "none") return "No follow-up recorded yet.";
  if (state.kind === "feedback") {
    return `Feedback: ${FEEDBACK_LABELS[state.code as (typeof FEEDBACK_CODES)[number]]}`;
  }
  if (state.kind === "outcome") {
    return `Outcome: ${OUTCOME_LABELS[state.code as (typeof OUTCOME_CODES)[number]]}`;
  }
  return "Outcome: not known yet";
}

export default function RecommendationFollowupPanel({
  workspaceId,
  recommendationId,
  initialState,
}: {
  workspaceId: string;
  recommendationId: string;
  initialState: RecommendationFollowupState;
}) {
  const [kind, setKind] = useState<RecommendationFollowupKind>(
    initialState.status === "recorded" ? initialState.kind : "feedback",
  );
  const [code, setCode] = useState<RecommendationFollowupCode>(
    initialState.status === "recorded" ? initialState.code : FEEDBACK_CODES[0],
  );
  const [state, setState] = useState<RecommendationFollowupState>(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeKind(next: RecommendationFollowupKind) {
    setKind(next);
    setCode(defaultCode(next));
    setError(null);
  }

  async function record() {
    const submittedKind = kind;
    const submittedCode = code;
    const expectedEventId = state.status === "recorded" ? state.eventId : null;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/recommendation-followups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          recommendationId,
          kind: submittedKind,
          code: submittedCode,
          expectedEventId,
        }),
      });

      if (!response.ok) {
        if (response.status === 409) {
          setError("FOLLOWUP_STALE_REFRESH_REQUIRED");
          return;
        }
        setError("FOLLOWUP_RECORDING_FAILED");
        return;
      }

      const body = (await response.json()) as { followup?: unknown };
      const recorded = parseRecommendationFollowupState(body.followup);
      if (
        recorded.status !== "recorded" ||
        recorded.kind !== submittedKind ||
        recorded.code !== submittedCode
      ) {
        setError("FOLLOWUP_RESULT_MISMATCH");
        return;
      }
      setState(recorded);
    } catch {
      setError("FOLLOWUP_RECORDING_FAILED");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="feedback">
      <p className="note">
        {recordedLabel(state)}
        {state.status === "recorded"
          ? ` · recorded ${new Date(state.recordedAt).toISOString()}`
          : ""}
      </p>
      <p className="muted">
        This record is durable and provenance-bound. It does not change the account rank,
        score, reason codes, source evidence, or next-best-action type.
      </p>

      {error ? (
        <p className="alert" role="alert">
          {error === "FOLLOWUP_STALE_REFRESH_REQUIRED"
            ? "The recorded follow-up changed. Refresh this page before submitting another update."
            : "The follow-up was not recorded. No success state was assumed."}
        </p>
      ) : null}

      <div className="feedback-body">
        <label>
          <span className="feedback-reason">Record</span>
          <select
            value={kind}
            disabled={busy}
            onChange={(event) => changeKind(event.target.value as RecommendationFollowupKind)}
          >
            <option value="feedback">Recommendation feedback</option>
            <option value="outcome">Known outcome</option>
            <option value="unknown">Outcome not known</option>
          </select>
        </label>

        {kind === "feedback" ? (
          <label>
            <span className="feedback-reason">Feedback</span>
            <select
              value={code}
              disabled={busy}
              onChange={(event) => setCode(event.target.value as RecommendationFollowupCode)}
            >
              {FEEDBACK_CODES.map((value) => (
                <option value={value} key={value}>
                  {FEEDBACK_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {kind === "outcome" ? (
          <label>
            <span className="feedback-reason">Outcome</span>
            <select
              value={code}
              disabled={busy}
              onChange={(event) => setCode(event.target.value as RecommendationFollowupCode)}
            >
              {OUTCOME_CODES.map((value) => (
                <option value={value} key={value}>
                  {OUTCOME_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {kind === "unknown" ? (
          <p className="muted">Record explicitly that the outcome is not known yet.</p>
        ) : null}

        <button type="button" className="action-btn btn-primary" disabled={busy} onClick={record}>
          {busy ? "Recording…" : "Record follow-up"}
        </button>
      </div>
    </div>
  );
}
