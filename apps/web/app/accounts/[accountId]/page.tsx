import { cookies } from "next/headers";
import { accountProfile, accountValue, getRecommendation, repName } from "../../lib/mock-data";
import {
  OUTCOME_LABEL,
  OUTCOMES,
  WORKFLOW_LABEL,
  accountContext,
  provenanceFor,
  workspaceMeta,
} from "../../lib/account-context";
import {
  NOT_A_WIN_PROBABILITY,
  actionLabel,
  evidenceBand,
  formatUsd,
  humanizeCode,
  priorityTier,
} from "../../lib/display";
import ActionBar from "../../components/ActionBar";
import FeedbackPanel from "../../components/FeedbackPanel";

/**
 * Account detail, ordered by the questions a rep actually asks: what should I
 * do, why, can I trust it, and what happens next. Decision first, evidence
 * second, surrounding context third.
 */
export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ feedback?: string }>;
}) {
  const { accountId } = await params;
  const { feedback } = await searchParams;
  const recordedFeedback = (await cookies()).get(`fb_${accountId}`)?.value;
  const rec = getRecommendation(accountId);
  const profile = accountProfile(accountId);

  if (!rec) {
    return (
      <section>
        <h1>{profile?.name ?? `Account ${accountId}`}</h1>
        <p className="muted">No published recommendation for this account today.</p>
        <p>
          <a href="/dashboard">← Back to dashboard</a>
        </p>
      </section>
    );
  }

  const tier = priorityTier(rec.score);
  const band = evidenceBand(rec.confidence);
  const meta = workspaceMeta(accountId);
  const ctx = accountContext(accountId);
  const outcomes = OUTCOMES.filter((o) => o.accountId === accountId);
  const gated = rec.nextBestAction.customerFacing || rec.nextBestAction.crmWriteBack;

  return (
    <section>
      <p>
        <a href="/dashboard">← Back to dashboard</a>
      </p>

      <div className="page-header">
        <h1>{profile?.name ?? accountId}</h1>
        <p className="muted">
          {profile ? `${profile.industry} · ${profile.tier} · ` : ""}
          {accountId} · owner {repName(rec.ownerId)} · {meta.freshness}
        </p>
      </div>

      {/* 1 — Decision summary. Why this account, today. */}
      <div className="card decision">
        <span className="decision-eyebrow">Work this account today because</span>
        <p className="decision-line">{rec.reasonNarrative}</p>

        <div className="decision-facts">
          <Fact label="Priority rank" value={`#${rec.rank}`} />
          <Fact label="Priority score" value={`${rec.score.toFixed(1)} / 100`} sub={tier.label} />
          <Fact label="Evidence confidence" value={band.label} sub={`${(rec.confidence * 100).toFixed(0)}% data completeness`} />
          <Fact label="Business impact" value={formatUsd(accountValue(accountId))} sub="Revenue at stake" />
          <Fact label="Recommended action" value={actionLabel(rec.nextBestAction.type)} />
          <Fact label="Workflow state" value={WORKFLOW_LABEL[meta.workflow]} />
        </div>

        <p className="disclaimer">{NOT_A_WIN_PROBABILITY}</p>

        {meta.restriction ? (
          <p className="note">Restriction: {meta.restriction}</p>
        ) : null}
      </div>

      {/* 2 — Evidence, inspectable down to the source record. */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Verified Evidence</h3>
            <p className="card-sub">
              Each reason should trace to a source record. Anything without recorded
              lineage is flagged rather than filled in.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Signal</th>
                <th>Source system</th>
                <th>Source record</th>
                <th>Observed</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              {rec.sourceSignals.map((s, i) => {
                const p = provenanceFor(s.refId);
                return (
                  <tr key={`${s.refId}-${i}`}>
                    <td>{s.description}</td>
                    <td className="muted">{p ? p.sourceSystem : "—"}</td>
                    <td className="muted mono">{p ? p.sourceRecord : "—"}</td>
                    <td className="muted">{p ? p.observed : "—"}</td>
                    <td>
                      {!s.verified ? (
                        <span className="badge tag-bad">unverified</span>
                      ) : p ? (
                        <span className="badge tag-good">{p.basis}</span>
                      ) : (
                        <span className="badge tag-warn">lineage not recorded</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="chip-row" style={{ marginTop: 12 }}>
          {rec.reasonCodes.map((c) => (
            <span className="chip" key={c}>
              {humanizeCode(c)}
            </span>
          ))}
        </div>
      </div>

      {/* 3 — Next best action workspace. */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Next Best Action</h3>
            <p className="card-sub">{rec.nextBestAction.objective}</p>
          </div>
          <div>
            <span className="badge tag-accent">{actionLabel(rec.nextBestAction.type)}</span>
            {gated ? <span className="badge tag-warn">requires approval</span> : null}
          </div>
        </div>

        <ActionBar rec={rec} />

        <div className="writeback">
          <span className="writeback-title">CRM write-back preview</span>
          <pre className="draft">
{`Account:  ${profile?.name ?? accountId} (${accountId})
Activity: ${actionLabel(rec.nextBestAction.type)}
Note:     ${rec.nextBestAction.objective}
Evidence: ${rec.reasonCodes.map(humanizeCode).join(", ")}
Run:      ${rec.runId} · policy v12`}
          </pre>
          <p className="note">
            Nothing is written until you approve. Approval status: {rec.approvalStatus}.
          </p>
        </div>
      </div>

      {/* 4 — Surrounding context, so nobody acts blind. */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Account Context</h3>
            <p className="card-sub">What else is true about this account right now.</p>
          </div>
        </div>

        <div className="ctx-grid">
          <div>
            <h4 className="ctx-title">Contract</h4>
            <dl className="rule-list tight">
              <div>
                <dt>Renewal</dt>
                <dd>{ctx.contract.renewalDate}</dd>
              </div>
              <div>
                <dt>ARR</dt>
                <dd>{ctx.contract.arrUsd ? formatUsd(ctx.contract.arrUsd) : "—"}</dd>
              </div>
              <div>
                <dt>Seats</dt>
                <dd>{ctx.contract.seats || "—"}</dd>
              </div>
              <div>
                <dt>Products</dt>
                <dd>{ctx.contract.products}</dd>
              </div>
            </dl>
          </div>

          <div>
            <h4 className="ctx-title">Contacts</h4>
            {ctx.contacts.length === 0 ? (
              <p className="muted">No contacts on record.</p>
            ) : (
              ctx.contacts.map((c) => (
                <div className="contact" key={c.name}>
                  <div>
                    <strong>{c.name}</strong>
                    {c.decisionMaker ? (
                      <span className="badge tag-accent">Decision maker</span>
                    ) : null}
                    {!c.emailPermission ? (
                      <span className="badge tag-bad">No email permission</span>
                    ) : null}
                  </div>
                  <div className="muted cell-sub">
                    {c.title} · last engaged {c.lastEngaged}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {ctx.timeline.length > 0 ? (
          <>
            <h4 className="ctx-title" style={{ marginTop: 18 }}>
              Recent activity
            </h4>
            <ul className="timeline">
              {ctx.timeline.map((t, i) => (
                <li key={i}>
                  <span className={`tl-kind tl-${t.kind}`}>{t.kind}</span>
                  <span className="tl-when muted">{t.when}</span>
                  <span className="tl-detail">{t.detail}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {ctx.openSupport.length > 0 ? (
          <p className="note">Open support: {ctx.openSupport.join(" · ")}</p>
        ) : null}
        {ctx.exclusions.length > 0 ? (
          <p className="note">Exclusions: {ctx.exclusions.join(" · ")}</p>
        ) : null}

        {ctx.priorRecommendations.length > 0 ? (
          <>
            <h4 className="ctx-title" style={{ marginTop: 18 }}>
              Previous recommendations
            </h4>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {ctx.priorRecommendations.map((p, i) => (
                    <tr key={i}>
                      <td className="muted">{p.when}</td>
                      <td>{p.action}</td>
                      <td className="muted">{p.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {outcomes.length > 0 ? (
          <p className="outcome-line">
            Recorded outcome:{" "}
            {outcomes
              .map(
                (o) =>
                  `${OUTCOME_LABEL[o.outcome]} in ${o.daysToOutcome}d${o.valueUsd ? ` · ${formatUsd(o.valueUsd)}` : ""}`,
              )
              .join(" · ")}
          </p>
        ) : null}
      </div>

      {/* 5 — Correction path. */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Something Wrong?</h3>
            <p className="card-sub">
              Corrections are how the ranking gets better. Each reason has a different
              effect, stated up front.
            </p>
          </div>
        </div>
        <FeedbackPanel
          accountId={accountId}
          account={profile?.name ?? accountId}
          recorded={recordedFeedback}
          failed={feedback === "error"}
        />
      </div>

      {/* 6 — Safety verification, last because it is reassurance not decision input. */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Safety Verification</h3>
            <p className="card-sub">Gates this recommendation passed before publication.</p>
          </div>
        </div>
        <div className="chip-row">
          <Gate label="Schema valid" ok={rec.verification.schemaValid} />
          <Gate label="Guardrails passed" ok={rec.verification.guardrailsPassed} />
          <Gate label="Source signals verified" ok={rec.verification.sourceSignalsVerified} />
          <Gate label="Permission granted" ok={rec.verification.permissionGranted} />
        </div>
        <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
          Status {rec.verification.status} · approval {rec.approvalStatus} · run {rec.runId}
        </p>
      </div>
    </section>
  );
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
