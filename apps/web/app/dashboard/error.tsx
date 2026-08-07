"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section>
      <div className="page-header">
        <h1>Rep Dashboard</h1>
        <p className="muted">Live recommendation data could not be loaded.</p>
      </div>
      <p className="alert" role="alert">
        BLOCKED: no demo or mock recommendation data was substituted. Retry after the live data
        dependency is available.
      </p>
      {error.digest ? <p className="muted">Reference: {error.digest}</p> : null}
      <button className="action-btn" onClick={reset}>
        Retry live dashboard
      </button>
    </section>
  );
}
