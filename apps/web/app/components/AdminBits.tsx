import type { ReactNode } from "react";
import type { ChangeState, Health, Metric } from "../lib/admin-data";

/** Small shared pieces for the control plane. Server components, no state. */

export function Section({
  title,
  sub,
  action,
  children,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {sub ? <p className="card-sub">{sub}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function MetricGrid({ items }: { items: Metric[] }) {
  return (
    <div className="metric-grid">
      {items.map((m) => (
        <div className="metric" key={m.label}>
          <span className="metric-label">{m.label}</span>
          <span className={`metric-val${m.tone ? ` m-${m.tone}` : ""}`}>{m.value}</span>
          {m.delta ? <span className="metric-delta">{m.delta}</span> : null}
          {m.hint ? <span className="metric-hint">{m.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function StatusDot({ status }: { status: Health }) {
  return <span className={`sdot sdot-${status}`} aria-hidden="true" />;
}

export function HealthPill({ status }: { status: Health }) {
  const label =
    status === "healthy" ? "Healthy" : status === "degraded" ? "Degraded" : "Failed";
  return (
    <span className={`badge ${status === "healthy" ? "tag-good" : status === "degraded" ? "tag-warn" : "tag-bad"}`}>
      {label}
    </span>
  );
}

const STATE_LABEL: Record<ChangeState, string> = {
  draft: "Draft",
  evaluating: "Evaluating",
  approved: "Approved",
  scheduled: "Scheduled",
  live: "Live",
  paused: "Paused",
  rolled_back: "Rolled back",
};

export function StatePill({ state }: { state: ChangeState }) {
  const tone =
    state === "live" || state === "approved"
      ? "tag-good"
      : state === "rolled_back" || state === "paused"
        ? "tag-bad"
        : "tag-warn";
  return <span className={`badge ${tone}`}>{STATE_LABEL[state]}</span>;
}

/** Read-only by default: configuration is shown, editing is an explicit step. */
export function ReadOnlyBar({ what }: { what: string }) {
  return (
    <div className="ro-bar">
      <span className="badge">Read only</span>
      <span className="muted">
        {what} is shown as published. Changes are made in a draft, simulated, and
        approved before they reach production.
      </span>
      <button className="btn-sm-solid">Enter edit mode</button>
    </div>
  );
}
