import type { Recommendation } from "../lib/types";
import { MOCK_RECOMMENDATIONS } from "../lib/mock-data";

function ActionBadge({ rec }: { rec: Recommendation }) {
  const gated = rec.nextBestAction.customerFacing || rec.nextBestAction.crmWriteBack;
  return (
    <>
      <span className="badge">{rec.nextBestAction.type}</span>
      {gated ? (
        <span className="badge tag-warn">approval-gated</span>
      ) : (
        <span className="badge tag-good">auto</span>
      )}
    </>
  );
}

export default function DashboardPage() {
  const recs = [...MOCK_RECOMMENDATIONS].sort((a, b) => a.rank - b.rank);
  return (
    <section>
      <h1>Rep Dashboard</h1>
      <p className="muted">Your ranked accounts for today, with evidence and next steps.</p>
      {recs.map((rec) => (
        <article key={rec.id} className="card">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>
              #{rec.rank} ·{" "}
              <a href={`/accounts/${rec.accountId}`}>{rec.accountId}</a>
            </h3>
            <div>
              <span className="badge tag-good">score {rec.score}</span>
              <span className="badge">conf {(rec.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
          <p style={{ marginBottom: 8 }}>{rec.reasonNarrative}</p>
          <div style={{ marginBottom: 8 }}>
            {rec.reasonCodes.map((c) => (
              <span key={c} className="badge">
                {c}
              </span>
            ))}
          </div>
          <div>
            <strong>Next best action:</strong> {rec.nextBestAction.objective}{" "}
            <ActionBadge rec={rec} />
          </div>
          <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            Verification: {rec.verification.status} · {rec.sourceSignals.length} verified
            signal(s)
          </div>
        </article>
      ))}
    </section>
  );
}
