import type { Recommendation } from "../lib/types";
import { MOCK_RECOMMENDATIONS, accountProfile } from "../lib/mock-data";
import { actionLabel, humanizeCode } from "../lib/display";
import { requireSession } from "../lib/auth";

function ActionBadge({ rec }: { rec: Recommendation }) {
  const gated = rec.nextBestAction.customerFacing || rec.nextBestAction.crmWriteBack;
  return (
    <>
      <span className="badge tag-accent">{actionLabel(rec.nextBestAction.type)}</span>
      {gated ? (
        <span className="badge tag-warn">approval-gated</span>
      ) : (
        <span className="badge tag-good">auto</span>
      )}
    </>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  await requireSession();
  const { denied } = await searchParams;
  const recs = [...MOCK_RECOMMENDATIONS].sort((a, b) => a.rank - b.rank);
  return (
    <section>
      <div className="page-header">
        <h1>Rep Dashboard</h1>
        <p className="muted">Your ranked accounts for today, with evidence and next steps.</p>
      </div>
      {denied ? (
        <p className="alert" role="alert">
          You don’t have access to that page.
        </p>
      ) : null}
      {recs.map((rec) => {
        const profile = accountProfile(rec.accountId);
        return (
        <article key={rec.id} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <h3 style={{ margin: 0 }}>
              #{rec.rank} ·{" "}
              <a href={`/accounts/${rec.accountId}`}>{profile?.name ?? rec.accountId}</a>
              {profile ? (
                <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                  {" "}
                  · {profile.industry} · {profile.tier}
                </span>
              ) : null}
            </h3>
            <div style={{ flex: "none" }}>
              <span className="badge tag-accent">score {rec.score}</span>
              <span className="badge">conf {(rec.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
          <p style={{ marginBottom: 8 }}>{rec.reasonNarrative}</p>
          <div style={{ marginBottom: 8 }}>
            {rec.reasonCodes.map((c) => (
              <span key={c} className="badge">
                {humanizeCode(c)}
              </span>
            ))}
          </div>
          <div>
            <strong>Next Best Action:</strong> {rec.nextBestAction.objective}{" "}
            <ActionBadge rec={rec} />
          </div>
          <div style={{ marginTop: 10 }}>
            <a className="btn-sm" href={`/accounts/${rec.accountId}`}>
              Take Action →
            </a>
          </div>
          <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            Verification: {rec.verification.status} · {rec.sourceSignals.length} verified
            signal(s)
          </div>
        </article>
        );
      })}
    </section>
  );
}
