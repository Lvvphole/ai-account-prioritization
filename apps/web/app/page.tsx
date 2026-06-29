import { MOCK_RECOMMENDATIONS } from "./lib/mock-data";

export default function HomePage() {
  const top = [...MOCK_RECOMMENDATIONS].sort((a, b) => a.rank - b.rank).slice(0, 3);

  return (
    <section>
      <div className="hero">
        <div className="hero-rating">
          <span className="stars">★★★★★</span> Deterministic · eval-gated · human-approved
        </div>
        <h1>
          Turn CRM noise into a <span className="hl">verified</span> daily action plan
        </h1>
        <p className="hero-sub">
          Which accounts to contact first, why they matter, what to do next, and the
          evidence behind it — with a safety gate on every recommendation.
        </p>
        <a className="btn-cta" href="/login">
          Enter the portal →
        </a>

        <div className="panel">
          <div className="panel-head">
            <h3>Today’s plan · top accounts</h3>
            <a href="/dashboard">View all →</a>
          </div>
          {top.map((rec) => (
            <div className="panel-row" key={rec.id}>
              <span className="rank">{rec.rank}</span>
              <div className="grow">
                <div className="acct">{rec.accountId}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {rec.nextBestAction.objective}
                </div>
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                <span className="badge tag-accent">score {rec.score}</span>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {(rec.confidence * 100).toFixed(0)}% confidence
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="pillars">
          <span className="label">Built on guarantees, not vibes</span>
          <span>Deterministic scoring</span>
          <span>Reason codes</span>
          <span>Human approval</span>
          <span>Immutable audit</span>
          <span>Eval-gated CI</span>
        </div>
      </div>
    </section>
  );
}
