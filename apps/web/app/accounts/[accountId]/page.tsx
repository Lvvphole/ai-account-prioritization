import ActionApprovalPanel from "../../components/ActionApprovalPanel";
import DemoAccountDetail from "./DemoAccountDetail";
import {
  NOT_A_WIN_PROBABILITY,
  actionLabel,
  evidenceBand,
  formatUsd,
  humanizeCode,
  priorityTier,
} from "../../lib/display";
import { resolveDashboardDataMode } from "../../lib/live-dashboard-data";
import { loadLiveRecommendationDetailForCurrentUser } from "../../lib/live-recommendations-data";
import { isSupabaseConfigured } from "../../lib/supabase/config";

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{
    workspace?: string | string[];
    recommendation?: string | string[];
    feedback?: string | string[];
  }>;
}) {
  const mode = resolveDashboardDataMode(process.env.NODE_ENV, isSupabaseConfigured());
  const resolvedParams = await params;
  const query = await searchParams;

  if (mode === "demo") {
    const feedback = Array.isArray(query.feedback) ? query.feedback[0] : query.feedback;
    return (
      <DemoAccountDetail
        params={Promise.resolve(resolvedParams)}
        searchParams={Promise.resolve({ feedback })}
      />
    );
  }

  const result = await loadLiveRecommendationDetailForCurrentUser(
    resolvedParams.accountId,
    query.workspace,
    query.recommendation,
  );

  if (result.status === "invalid_scope") {
    return (
      <section>
        <h1>Recommendation unavailable</h1>
        <p className="alert" role="alert">
          This action link is incomplete or ambiguous. No customer or CRM action was authorized.
        </p>
        <p className="muted">Reference: {result.reason}</p>
        <p>
          <a href="/dashboard">← Back to dashboard</a>
        </p>
      </section>
    );
  }

  if (result.status === "not_found") {
    return (
      <section>
        <h1>Recommendation unavailable</h1>
        <p className="alert" role="alert">
          No currently authorized, fully verified published recommendation matches this link.
        </p>
        <p>
          <a href="/dashboard">← Back to dashboard</a>
        </p>
      </section>
    );
  }

  const { recommendation: rec, account, workspaceId, payload, approval } = result.data;
  const tier = priorityTier(rec.score);
  const band = evidenceBand(rec.confidence);
  const dashboardHref = `/dashboard?workspace=${encodeURIComponent(workspaceId)}`;

  return (
    <section>
      <p>
        <a href={dashboardHref}>← Back to dashboard</a>
      </p>

      <div className="page-header">
        <h1>{account.name}</h1>
        <p className="muted">
          {account.industry ?? "Industry not recorded"} · {account.tier} · {account.id} · updated{" "}
          {stableUpdatedAt(account.updatedAt)}
        </p>
      </div>

      <div className="card decision">
        <span className="decision-eyebrow">Work this account today because</span>
        <p className="decision-line">{rec.reasonNarrative}</p>

        <div className="decision-facts">
          <Fact label="Priority rank" value={`#${rec.rank}`} />
          <Fact label="Priority score" value={`${rec.score.toFixed(1)} / 100`} sub={tier.label} />
          <Fact
            label="Evidence confidence"
            value={band.label}
            sub={`${(rec.confidence * 100).toFixed(0)}% deterministic confidence`}
          />
          <Fact
            label="Open pipeline"
            value={formatUsd(account.openPipelineUsd)}
            sub="Canonical account value in view"
          />
          <Fact label="Recommended action" value={actionLabel(rec.nextBestAction.type)} />
          <Fact label="Verification" value={rec.verification.status.toUpperCase()} />
        </div>

        <p className="disclaimer">{NOT_A_WIN_PROBABILITY}</p>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Verified Evidence</h3>
            <p className="card-sub">
              Only persisted recommendation evidence is shown. Missing source metadata is not
              inferred from demo fixtures.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Signal</th>
                <th>Kind</th>
                <th>Source record</th>
                <th>Verified</th>
              </tr>
            </thead>
            <tbody>
              {rec.sourceSignals.map((signal, index) => (
                <tr key={`${signal.kind}:${signal.refId}:${index}`}>
                  <td>{signal.description}</td>
                  <td className="muted">{signal.kind}</td>
                  <td className="muted mono">{signal.refId}</td>
                  <td>
                    <span className={`badge ${signal.verified ? "tag-good" : "tag-bad"}`}>
                      {signal.verified ? "verified" : "unverified"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="chip-row" style={{ marginTop: 12 }}>
          {rec.reasonCodes.map((code) => (
            <span className="chip" key={code}>
              {humanizeCode(code)}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Next Best Action</h3>
            <p className="card-sub">{rec.nextBestAction.objective}</p>
          </div>
          <div>
            <span className="badge tag-accent">{actionLabel(rec.nextBestAction.type)}</span>
            {payload.requiresApproval ? (
              <span className="badge tag-warn">exact-payload approval required</span>
            ) : (
              <span className="badge tag-good">no protected approval required</span>
            )}
          </div>
        </div>

        <ActionApprovalPanel
          workspaceId={workspaceId}
          recommendationId={rec.id}
          payload={payload}
          initialApproval={approval}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Safety Verification</h3>
            <p className="card-sub">
              Deterministic gates that passed before this recommendation was published.
            </p>
          </div>
        </div>
        <div className="chip-row">
          <Gate label="Schema valid" ok={rec.verification.schemaValid} />
          <Gate label="Guardrails passed" ok={rec.verification.guardrailsPassed} />
          <Gate label="Source signals verified" ok={rec.verification.sourceSignalsVerified} />
          <Gate label="Permission granted" ok={rec.verification.permissionGranted} />
        </div>
        <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
          Recommendation {rec.id} · run {rec.runId} · publication approval {rec.approvalStatus} ·
          payload decision {approval.status}
        </p>
      </div>
    </section>
  );
}

function stableUpdatedAt(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="dfact">
      <span className="dfact-label">{label}</span>
      <span className="dfact-value">{value}</span>
      {sub ? <span className="dfact-sub">{sub}</span> : null}
    </div>
  );
}

function Gate({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`badge ${ok ? "tag-good" : "tag-bad"}`}>
      {ok ? "✓" : "✗"} {label}
    </span>
  );
}
