import type { Recommendation } from "../lib/types";
import {
  DEMO_REP_ID,
  MOCK_RECOMMENDATIONS,
  accountProfile,
  accountValue,
  repName,
} from "../lib/mock-data";
import {
  NOT_A_WIN_PROBABILITY,
  actionLabel,
  evidenceBand,
  formatUsd,
  humanizeCode,
  priorityTier,
} from "../lib/display";
import { WORKFLOW_LABEL, workspaceMeta } from "../lib/account-context";
import { exportRows } from "../lib/analytics";
import ExportButtons from "../components/ExportButtons";
import { requireSession } from "../lib/auth";
import {
  liveDashboardExportRows,
  resolveDashboardDataMode,
  type LiveDashboardData,
  type LiveDashboardWorkspace,
} from "../lib/live-dashboard-data";
import { loadLiveDashboardForCurrentUser } from "../lib/live-recommendations-data";
import { isSupabaseConfigured } from "../lib/supabase/config";

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

function WorkspaceLinks({
  workspaces,
  activeWorkspaceId,
}: {
  workspaces: LiveDashboardWorkspace[];
  activeWorkspaceId: string | null;
}) {
  if (workspaces.length <= 1) return null;
  return (
    <div className="toolbar" aria-label="Workspace selector">
      <span className="muted">Workspace</span>
      {workspaces.map((workspace) => (
        <a
          key={workspace.id}
          className={workspace.id === activeWorkspaceId ? "btn-sm" : "badge"}
          href={`/dashboard?workspace=${encodeURIComponent(workspace.id)}`}
        >
          {workspace.name}
        </a>
      ))}
    </div>
  );
}

function stableUpdatedAt(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function LiveDashboard({ data, denied }: { data: LiveDashboardData; denied?: string }) {
  const activeWorkspace = data.workspaces.find(
    (workspace) => workspace.id === data.activeWorkspaceId,
  );

  if (data.status !== "ready") {
    const message =
      data.status === "no_workspace"
        ? "No authorized workspace is available for this account."
        : data.status === "invalid_workspace"
          ? "The requested workspace is not authorized or is ambiguous for this account."
          : "Choose a workspace to load your live daily plan.";
    return (
      <section>
        <div className="page-header">
          <h1>Rep Dashboard</h1>
          <p className="muted">Your live daily plan is scoped to one authorized workspace.</p>
        </div>
        {denied ? (
          <p className="alert" role="alert">
            You don’t have access to that page.
          </p>
        ) : null}
        <p className="alert" role="status">
          {message}
        </p>
        <WorkspaceLinks workspaces={data.workspaces} activeWorkspaceId={null} />
      </section>
    );
  }

  const recs = data.recommendations;
  const pipeline = recs.reduce(
    (sum, rec) => sum + (data.accountsById[rec.accountId]?.openPipelineUsd ?? 0),
    0,
  );
  const protectedActions = recs.filter(
    (rec) => rec.nextBestAction.customerFacing || rec.nextBestAction.crmWriteBack,
  ).length;

  return (
    <section>
      <div className="page-header">
        <h1>Rep Dashboard</h1>
        <p className="muted">
          {activeWorkspace?.name ?? data.activeWorkspaceId} · your latest verified published
          daily plan.
        </p>
      </div>
      {denied ? (
        <p className="alert" role="alert">
          You don’t have access to that page.
        </p>
      ) : null}

      <WorkspaceLinks
        workspaces={data.workspaces}
        activeWorkspaceId={data.activeWorkspaceId}
      />

      <div className="kpi-row">
        <Kpi value={String(recs.length)} label="Accounts Today" />
        <Kpi value={formatUsd(pipeline)} label="Revenue in View" />
        <Kpi value={String(protectedActions)} label="Protected Actions to Review" tone="warn" />
      </div>

      <p className="disclaimer">{NOT_A_WIN_PROBABILITY}</p>

      <div className="toolbar">
        <span className="muted">Export your list</span>
        <ExportButtons rows={liveDashboardExportRows(data)} filename="my-accounts" />
      </div>

      {recs.length === 0 ? (
        <p className="alert" role="status">
          No published recommendations are available for the latest authorized run in this
          workspace.
        </p>
      ) : null}

      {recs.map((rec) => {
        const profile = data.accountsById[rec.accountId];
        const detailHref = `/accounts/${encodeURIComponent(rec.accountId)}?workspace=${encodeURIComponent(
          data.activeWorkspaceId ?? "",
        )}&recommendation=${encodeURIComponent(rec.id)}`;
        return (
          <article key={rec.id} className="card">
            <div className="account-card-head">
              <h3 style={{ margin: 0 }}>
                #{rec.rank} · {profile?.name ?? rec.accountId}
                {profile ? (
                  <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                    {" "}
                    · {profile.industry ?? "Industry not recorded"} · {profile.tier}
                  </span>
                ) : null}
              </h3>
              <div className="account-card-score">
                <div className="score-line">
                  <span className="score-num">{rec.score.toFixed(1)}</span>
                  <span className="score-den">/100 priority</span>
                </div>
                <div className={`ev-band ev-${evidenceBand(rec.confidence).tone}`}>
                  {evidenceBand(rec.confidence).label}
                </div>
              </div>
            </div>
            <div className="row-meta">
              <span
                className={`badge tag-${priorityTier(rec.score).tone === "high" ? "accent" : "warn"}`}
              >
                {priorityTier(rec.score).label}
              </span>
              {profile ? (
                <span className="muted">Updated {stableUpdatedAt(profile.updatedAt)}</span>
              ) : (
                <span className="muted">Canonical account summary unavailable</span>
              )}
            </div>
            <p style={{ marginBottom: 8 }}>{rec.reasonNarrative}</p>
            <div style={{ marginBottom: 8 }}>
              {rec.reasonCodes.map((code) => (
                <span key={code} className="badge">
                  {humanizeCode(code)}
                </span>
              ))}
            </div>
            <div>
              <strong>Next Best Action:</strong> {rec.nextBestAction.objective}{" "}
              <ActionBadge rec={rec} />
            </div>
            <details style={{ marginTop: 10 }}>
              <summary>Evidence · {rec.sourceSignals.length} verified signal(s)</summary>
              <ul>
                {rec.sourceSignals.map((signal) => (
                  <li key={`${signal.kind}:${signal.refId}`}>
                    {signal.description} <span className="muted">[{signal.refId}]</span>
                  </li>
                ))}
              </ul>
            </details>
            <div style={{ marginTop: 10 }}>
              <a className="btn-sm" href={detailHref}>
                Review action →
              </a>
            </div>
            <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              Verification: {rec.verification.status} · exact payload approval is rechecked on
              action detail.
            </div>
          </article>
        );
      })}
    </section>
  );
}

async function DemoDashboard({ denied }: { denied?: string }) {
  await requireSession();
  const recs = MOCK_RECOMMENDATIONS.filter((r) => r.ownerId === DEMO_REP_ID).sort(
    (a, b) => a.rank - b.rank,
  );
  const pipeline = recs.reduce((sum, r) => sum + accountValue(r.accountId), 0);
  const pending = recs.filter((r) => r.approvalStatus === "pending_approval").length;

  return (
    <section>
      <div className="page-header">
        <h1>Rep Dashboard</h1>
        <p className="muted">
          {repName(DEMO_REP_ID)} · your ranked accounts for today, with evidence and next steps.
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

      <p className="disclaimer">{NOT_A_WIN_PROBABILITY}</p>

      <div className="toolbar">
        <span className="muted">Export your list</span>
        <ExportButtons rows={exportRows(recs)} filename="my-accounts" />
      </div>

      {recs.map((rec) => {
        const profile = accountProfile(rec.accountId);
        const meta = workspaceMeta(rec.accountId);
        return (
          <article key={rec.id} className="card">
            <div className="account-card-head">
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
              <div className="account-card-score">
                <div className="score-line">
                  <span className="score-num">{rec.score.toFixed(1)}</span>
                  <span className="score-den">/100 priority</span>
                </div>
                <div className={`ev-band ev-${evidenceBand(rec.confidence).tone}`}>
                  {evidenceBand(rec.confidence).label}
                </div>
              </div>
            </div>
            <div className="row-meta">
              <span
                className={`badge tag-${priorityTier(rec.score).tone === "high" ? "accent" : "warn"}`}
              >
                {priorityTier(rec.score).label}
              </span>
              <span className={`badge wf-${meta.workflow}`}>{WORKFLOW_LABEL[meta.workflow]}</span>
              <span className="muted">{meta.freshness}</span>
              <span className="muted">· {repName(rec.ownerId)}</span>
            </div>
            <p style={{ marginBottom: 8 }}>{rec.reasonNarrative}</p>
            <div style={{ marginBottom: 8 }}>
              {rec.reasonCodes.map((code) => (
                <span key={code} className="badge">
                  {humanizeCode(code)}
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    denied?: string | string[];
    workspace?: string | string[];
  }>;
}) {
  const { denied, workspace } = await searchParams;
  const deniedValue = Array.isArray(denied) ? denied[0] : denied;
  const mode = resolveDashboardDataMode(process.env.NODE_ENV, isSupabaseConfigured());

  if (mode === "live") {
    const data = await loadLiveDashboardForCurrentUser(workspace);
    return <LiveDashboard data={data} denied={deniedValue} />;
  }

  return <DemoDashboard denied={deniedValue} />;
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
