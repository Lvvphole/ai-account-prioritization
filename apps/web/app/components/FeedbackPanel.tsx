"use client";

import { useState } from "react";
import { FEEDBACK_REASONS } from "../lib/account-context";

/**
 * Operational feedback, not a thumbs-up.
 *
 * Each reason states what it actually changes — this recommendation, future
 * recommendations for the account, a review queue, or effectiveness reporting —
 * before the rep commits to it.
 *
 * Submission is a real POST. The confirmation is rendered by the server from
 * what was persisted, so the panel can never claim feedback was recorded when
 * it was not.
 */
export default function FeedbackPanel({
  accountId,
  account,
  recorded,
  failed,
}: {
  accountId: string;
  account: string;
  recorded?: string;
  failed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  if (recorded) {
    const effect = FEEDBACK_REASONS.find((r) => r.reason === recorded)?.effect;
    return (
      <div className="feedback sent">
        <strong>
          Recorded for {account}: {recorded}
        </strong>
        <p className="muted">{effect}</p>
        <p className="note">
          Persisted and written to the activity log. In production this is an
          immutable audit event, and reasons that call for it enqueue a review item.
        </p>
      </div>
    );
  }

  return (
    <div className="feedback">
      {failed ? (
        <p className="alert" role="alert">
          That feedback was not recorded. Pick a reason and submit again.
        </p>
      ) : null}

      <button className="action-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "Close feedback" : "Report a problem with this recommendation"}
      </button>

      {open ? (
        <form action="/api/feedback" method="post" className="feedback-body">
          <input type="hidden" name="accountId" value={accountId} />
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
                  name="reason"
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
          <button type="submit" className="action-btn btn-primary" disabled={!selected}>
            Submit feedback
          </button>
        </form>
      ) : null}
    </div>
  );
}
