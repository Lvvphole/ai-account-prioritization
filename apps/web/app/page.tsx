export default function HomePage() {
  return (
    <section>
      <h1>Verified daily sales action plans</h1>
      <p className="muted">
        This product turns messy B2B CRM data into a verified daily action plan:
        which accounts to contact first, why they matter, what to do next, the
        evidence behind it, and whether it passed every safety gate.
      </p>
      <div className="card">
        <h3>Start here</h3>
        <ul>
          <li>
            <a href="/dashboard">Rep Dashboard</a> — your ranked priority list with
            reason codes and next best actions.
          </li>
          <li>
            <a href="/manager">Manager View</a> — team coverage gaps and blocked
            recommendations.
          </li>
          <li>
            <a href="/admin/scoring">Admin · Scoring</a> — the deterministic scoring
            configuration.
          </li>
        </ul>
      </div>
      <p className="muted">
        Ranking is deterministic. The LLM never ranks accounts; it only narrates
        the deterministic result, and nothing publishes without passing
        verification.
      </p>
    </section>
  );
}
