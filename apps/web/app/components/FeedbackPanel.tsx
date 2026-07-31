"use client";

import { useState } from "react";
import { FEEDBACK_REASONS } from "../lib/account-context";

/**
 * Operational feedback, not a thumbs-up.
 *
 * Each reason states what it actually changes — this recommendation, future
 * recommendations for the account, a review queue, or effectiveness reporting —
 * before the rep commits to it. Telling someone their input "improves the
 * model" without saying when or how is not meaningful.
 */
export default function FeedbackPanel({ account }: { account: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const effect = FEEDBACK_REASONS.find((r) => r.reason === selected)?.effect;

  if (sent) {
    return (
      <div className="feedback sent">
        <strong>Feedback recorded for {account}.</strong>
        <p className="muted">{effect}</p>
        <p className="note">
          Recorded locally in this demo. In production this writes an audit event
          and, where the reason calls for it, opens a review queue item.
        </p>
      </div>
    );
  }

  return (
    <div className="feedback">
      <button className="action-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "Close feedback" : "Report a problem with this recommendation"}
      </button>

      {open ? (
        <div className="feedback-body">
          <p className="card-sub">
            Pick the reason that fits. Each one changes something different.
          </p>
          <div className="feedback-list">
            {FEEDBACK_REASONS.map((r) => (
              <label
                key={r.reason}
                className={`feedback-opt${selected === r.reason ? " on" : ""}`}
              >
                <input
                  type="radio"
                  name="feedback"
                  value={r.reason}
                  checked={selected === r.reason}
                  onChange={() => setSelected(r.reason)}
                />
                <span>
                  <span className="feedback-reason">{r.reason}</span>
                  <span className="feedback-effect">{r.effect}</span>
                </span>
              </label>
            ))}
          </div>
          <button
            className="action-btn btn-primary"
            disabled={!selected}
            onClick={() => setSent(true)}
          >
            Submit feedback
          </button>
        </div>
      ) : null}
    </div>
  );
}
