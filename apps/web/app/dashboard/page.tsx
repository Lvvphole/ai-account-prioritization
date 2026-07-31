import type { Recommendation } from "../lib/types";
import {
  DEMO_REP_ID,
  MOCK_RECOMMENDATIONS,
  accountProfile,
  accountValue,
  repName,
} from "../lib/mock-data";
import { actionLabel, formatUsd, humanizeCode } from "../lib/display";
import { exportRows } from "../lib/analytics";
import ExportButtons from "../components/ExportButtons";
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
  // A rep sees their own book. Managers get the whole team on /manager.
  const recs = MOCK_RECOMMENDATIONS.filter((r) => r.ownerId === DEMO_REP_ID).sort(
    (a, b) => a.rank - b.rank,
  );
  const pipeline = recs.reduce((sum, r) => sum + accountValue(r.accountId), 0);
  // Work still outstanding, not every action that was ever gated. Approved
  // recommendations need nothing further from the rep.
  const pending = recs.filter((r) => r.approvalStatus === "pending_approval").length;

  return (
    <section>
      <div className="page-header">
        <h1>Rep Dashboard</h1>
        <p className="muted">
          {repName(DEMO_REP_ID)} · your ranked accounts for today, with evidence and
          next steps.
        </p>
      </div>
      {denied ? (
        <p className="alert" role="alert">
          You don’t have access to that page.
        </p>
      ) : null}

      <div className="kpi-row">
        <Kpi value={String(recs.length)} label="Accounts Today" />
        <Kpi value={formatUsd(pipeline)} label="Revenue in View" />
        <Kpi value={String(pending)} label="Awaiting Your Approval" tone="warn" />
      </div>

      <div className="toolbar">
        <span className="muted">Export your list</span>
        <ExportButtons rows={exportRows(recs)} filename="my-accounts" />
      </div>

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

function Kpi({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="kpi">
      <span className={`kpi-val${tone ? ` kpi-${tone}` : ""}`}>{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}
