import { MOCK_BLOCKED, MOCK_RECOMMENDATIONS, accountProfile } from "./lib/mock-data";
import type { Recommendation } from "./lib/types";
import {
  actionIcon,
  actionLabel,
  formatUsd,
  humanizeCode,
  pipelineValue,
  priorityTier,
} from "./lib/display";

export default function HomePage() {
  const plan = [...MOCK_RECOMMENDATIONS].sort((a, b) => a.rank - b.rank);
  const signals = plan.flatMap((rec) => rec.sourceSignals);
  const verified = signals.filter((s) => s.verified).length;
  const pipeline = plan.reduce((sum, rec) => sum + pipelineValue(rec), 0);

  return (
    <section>
      <div className="hero">
        <span className="hero-pill">
          <span className="pulse" aria-hidden="true" />
          Live demo · no credentials required
        </span>
        <h1>
          Turn CRM noise into a <span className="hl">verified</span> daily action plan
        </h1>
        <p className="hero-sub">
          Which accounts to contact first, why they matter, what to do next, and the
          evidence behind it — with a safety gate on every recommendation.
        </p>
        <div className="hero-cta">
          <a className="btn-cta" href="/login">
            Enter the portal →
          </a>
          <a className="btn-ghost" href="#how">
            How it works
          </a>
        </div>

        <div className="stat-strip">
          <Stat value={String(plan.length)} label="Accounts ranked today" />
          <Stat value={formatUsd(pipeline)} label="Pipeline in view" />
          <Stat value={`${verified}/${signals.length}`} label="Signals verified" />
          <Stat value={String(MOCK_BLOCKED.length)} label="Held by guardrails" />
        </div>
      </div>

      <div className="preview">
        <div className="preview-chrome">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="preview-url">Rep Dashboard · today’s plan</span>
        </div>
        <div className="preview-body">
          <div className="preview-head">
            <div>
              <h3>Today’s plan</h3>
              <p className="preview-sub">Ranked by the deterministic scorer · run_demo</p>
            </div>
            <a className="btn-sm" href="/dashboard">
              View all →
            </a>
          </div>
          <ol className="plan">
            {plan.map((rec) => (
              <PlanRow key={rec.id} rec={rec} />
            ))}
          </ol>
        </div>
      </div>

      <section className="band" id="how">
        <p className="band-label">How it works</p>
        <h2 className="band-title">Evidence in, ranked plan out</h2>
        <div className="steps">
          <Step
            n="1"
            title="Ingest & verify"
            body="CRM signals are pulled and every fact is checked against the record it came from. Unverified evidence fails closed."
          />
          <Step
            n="2"
            title="Score deterministically"
            body="A fixed, weighted formula ranks every account. Same inputs, same order — the model never decides the ranking."
          />
          <Step
            n="3"
            title="Draft & gate"
            body="A next best action is drafted with its reason codes, then held for human approval before anything reaches a customer."
          />
        </div>
      </section>

      <section className="band">
        <p className="band-label">Built on guarantees, not vibes</p>
        <div className="guarantees">
          <Guarantee
            icon="◎"
            title="Deterministic scoring"
            body="Ranking is a pure function of verified inputs. No drift between runs."
          />
          <Guarantee
            icon="≡"
            title="Reason codes"
            body="Every rank ships with the specific signals that produced it."
          />
          <Guarantee
            icon="✓"
            title="Human approval"
            body="Customer-facing sends are gated on a person, never a prompt."
          />
          <Guarantee
            icon="⛁"
            title="Immutable audit"
            body="Every run and every decision is written once and retained."
          />
          <Guarantee
            icon="⚑"
            title="Eval-gated CI"
            body="Ranking changes must pass deterministic evals before they ship."
          />
        </div>
      </section>
    </section>
  );
}

function PlanRow({ rec }: { rec: Recommendation }) {
  const profile = accountProfile(rec.accountId);
  const tier = priorityTier(rec.score);
  const evidence = rec.sourceSignals[0];

  return (
    <li className="plan-item">
      <div className="plan-main">
        <span className={`rank-badge rank-${tier.tone}`}>{rec.rank}</span>
        <div className="plan-id">
          <a className="plan-name" href={`/accounts/${rec.accountId}`}>
            {profile?.name ?? rec.accountId}
          </a>
          <p className="plan-meta">
            {profile ? `${profile.industry} · ${profile.tier}` : rec.accountId}
          </p>
        </div>
        <div className="plan-score">
          <div className="score-row">
            <span className="score-val">{rec.score.toFixed(1)}</span>
            <span className="score-max">/100</span>
          </div>
          <div className={`meter meter-${tier.tone}`}>
            <span style={{ width: `${Math.min(rec.score, 100)}%` }} />
          </div>
          <span className="score-tier">{tier.label}</span>
        </div>
      </div>

      <p className="plan-obj">
        <span className="act-pill">
          <span aria-hidden="true">{actionIcon(rec.nextBestAction.type)}</span>
          {actionLabel(rec.nextBestAction.type)}
        </span>
        {rec.nextBestAction.objective}
      </p>

      <div className="chip-row">
        {rec.reasonCodes.map((code) => (
          <span className="chip" key={code}>
            {humanizeCode(code)}
          </span>
        ))}
        <span className="chip chip-conf">
          {(rec.confidence * 100).toFixed(0)}% confidence
        </span>
      </div>

      {evidence ? (
        <p className="evidence">
          <span className="tick" aria-hidden="true">
            ✓
          </span>
          <span>
            {evidence.description}
            <span className="muted">
              {" "}
              · {rec.sourceSignals.length} verified signal
              {rec.sourceSignals.length === 1 ? "" : "s"}
            </span>
          </span>
        </p>
      ) : null}
    </li>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <span className="stat-val">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="step">
      <span className="step-num">{n}</span>
      <h3>{title}</h3>
      <p className="muted">{body}</p>
    </div>
  );
}

function Guarantee({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="g-card">
      <span className="g-icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      <p className="muted">{body}</p>
    </div>
  );
}
