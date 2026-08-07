"use client";

export default function AccountDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section>
      <div className="page-header">
        <h1>Recommendation unavailable</h1>
        <p className="muted">Live recommendation detail could not be loaded.</p>
      </div>
      <p className="alert" role="alert">
        BLOCKED: no mock account context or approval state was substituted. No customer or CRM
        action was authorized.
      </p>
      {error.digest ? <p className="muted">Reference: {error.digest}</p> : null}
      <div className="actions">
        <button className="action-btn" onClick={reset}>
          Retry live recommendation
        </button>
        <a className="action-btn" href="/dashboard">
          Back to dashboard
        </a>
      </div>
    </section>
  );
}
