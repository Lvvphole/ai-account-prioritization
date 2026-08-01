import {
  MOCK_BLOCKED,
  MOCK_RECOMMENDATIONS,
  accountProfile,
  accountValue,
} from "./lib/mock-data";
import { formatUsd, humanizeCode } from "./lib/display";
import { isSupabaseConfigured } from "./lib/supabase/config";
import styles from "./marketing.module.css";

export default function HomePage() {
  const plan = [...MOCK_RECOMMENDATIONS].sort((a, b) => a.rank - b.rank);
  const signals = plan.flatMap((rec) => rec.sourceSignals);
  const verified = signals.filter((signal) => signal.verified).length;
  const pipeline = plan.reduce((sum, rec) => sum + accountValue(rec.accountId), 0);
  const demo = !isSupabaseConfigured();

  return (
    <section className={styles.page}>
      <section className={styles.hero} id="product">
        <div className={styles.heroCopy}>
          <div className={styles.demoPill}>
            <span className={styles.liveDot} aria-hidden="true" />
            <span>{demo ? "LIVE DEMO" : "AI SALES WORKSPACE"}</span>
            <span className={styles.demoMuted}>
              {demo ? "No credit card required" : "Verified CRM priorities"}
            </span>
          </div>

          <h1>
            Focus on the accounts <span className={styles.gradientText}>that matter most today.</span>
          </h1>
          <p className={styles.heroSub}>
            AI turns verified CRM signals into a ranked daily plan, explains why each
            account matters, and drafts the next best move so your team can spend less
            time sorting data and more time selling.
          </p>

          <div className={styles.heroActions}>
            <a className={styles.primaryCta} href="/login">
              Enter the Live Demo →
            </a>
            <a className={styles.secondaryCta} href="#how-it-works">
              See How It Works
            </a>
          </div>

          <div className={styles.stats} aria-label="Demo metrics">
            <Stat icon="↗" value={String(plan.length)} label="Accounts ranked today" />
            <Stat icon="$" value={formatUsd(pipeline)} label="Revenue in view" />
            <Stat icon="✓" value={`${verified}/${signals.length}`} label="Signals verified" />
            <Stat icon="▣" value={String(MOCK_BLOCKED.length)} label="Held for review" />
          </div>
        </div>

        <ProductPreview plan={plan.slice(0, 3)} pipeline={pipeline} verified={verified} totalSignals={signals.length} />
      </section>

      <section className={styles.valueBand} id="how-it-works">
        <div className={styles.valueInner}>
          <span className={styles.valueKicker}>One clear daily workflow</span>
          <span className={styles.valueItem}>
            <i className={styles.valueDot} /> Connect CRM signals
          </span>
          <span className={styles.valueItem}>
            <i className={styles.valueDot} /> Prioritize the right accounts
          </span>
          <span className={styles.valueItem}>
            <i className={styles.valueDot} /> Review the evidence
          </span>
          <span className={styles.valueItem}>
            <i className={styles.valueDot} /> Approve the next move
          </span>
        </div>
      </section>

      <section className={styles.features} id="security">
        <h2 className={styles.featuresTitle}>Built for revenue teams that need clarity and control</h2>
        <div className={styles.featureGrid}>
          <Feature
            icon="↗"
            title="Explainable Priorities"
            body="Every account is ordered from verified CRM inputs, with the exact business signals that put it on the list."
          />
          <Feature
            icon="◎"
            title="Evidence You Can Inspect"
            body="Reps see the opportunity, intent, activity, and account context behind each recommendation before they act."
          />
          <Feature
            icon="○"
            title="Human Approval"
            body="Drafted customer actions stay under human control. Nothing customer-facing sends without approval."
          />
          <Feature
            icon="◇"
            title="Enterprise Controls"
            body="Role-based access, audit history, guardrails, and evaluation gates keep the workflow accountable."
          />
          <Feature
            icon="$"
            title="Built Around Revenue Work"
            body="The workspace centers each seller on the accounts, pipeline, and next actions that deserve attention now."
          />
        </div>
      </section>
    </section>
  );
}

type PreviewRecommendation = (typeof MOCK_RECOMMENDATIONS)[number];

function ProductPreview({
  plan,
  pipeline,
  verified,
  totalSignals,
}: {
  plan: PreviewRecommendation[];
  pipeline: number;
  verified: number;
  totalSignals: number;
}) {
  return (
    <div className={styles.productStage} aria-label="Product dashboard preview">
      <div className={styles.productGlow} aria-hidden="true" />
      <div className={styles.productWindow}>
        <div className={styles.windowTop}>
          <div className={styles.windowTitle}>
            <span className={styles.windowLogo} aria-hidden="true">A</span>
            <span>Rep Dashboard</span>
          </div>
          <div className={styles.userRow}>
            <span>Filters</span>
            <span>⌁</span>
            <span className={styles.avatar} aria-hidden="true">AR</span>
            <span>Alex Rivera</span>
          </div>
        </div>

        <div className={styles.tabs} aria-hidden="true">
          <span className={styles.tabActive}>Today&apos;s Plan</span>
          <span>All Accounts</span>
          <span>Activity</span>
        </div>

        <div className={styles.windowBody}>
          <div>
            <div className={styles.accountList}>
              {plan.map((rec) => {
                const profile = accountProfile(rec.accountId);
                return (
                  <article className={styles.accountRow} key={rec.id}>
                    <div className={styles.accountHead}>
                      <span className={styles.rankBadge}>{rec.rank}</span>
                      <div>
                        <div className={styles.accountName}>{profile?.name ?? rec.accountId}</div>
                        <div className={styles.accountMeta}>
                          {profile
                            ? `${profile.industry} · ${formatTier(profile.tier)}`
                            : rec.accountId}
                        </div>
                      </div>
                      <div className={styles.score}>
                        <span className={styles.scoreNumber}>{rec.score.toFixed(1)}</span>
                        <span className={styles.scoreMax}> /100</span>
                        <div className={styles.scoreBar} aria-hidden="true">
                          <span
                            className={styles.scoreFill}
                            style={{ width: `${Math.min(rec.score, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <p className={styles.recommendation}>{rec.nextBestAction.objective}</p>
                    <div className={styles.reasonRow}>
                      {rec.reasonCodes.slice(0, 3).map((reason) => (
                        <span className={styles.reason} key={reason}>
                          {humanizeCode(reason)}
                        </span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className={styles.viewAll}>View all accounts →</div>
          </div>

          <aside className={styles.sideRail}>
            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>Revenue in view</div>
              <div className={styles.metricValue}>{formatUsd(pipeline)}</div>
              <div className={styles.metricSub}>Across today&apos;s ranked account list</div>
              <svg className={styles.sparkline} viewBox="0 0 180 44" role="img" aria-label="Revenue trend illustration">
                <polyline
                  points="0,32 14,27 28,30 42,22 56,24 70,14 84,25 98,22 112,31 126,20 140,11 154,18 168,8 180,3"
                  fill="none"
                  stroke="#5b7cff"
                  strokeWidth="2"
                />
              </svg>
            </div>

            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>Signals verified</div>
              <div className={styles.signalRingWrap}>
                <div className={styles.signalRing}>
                  <div className={styles.signalCenter}>
                    {verified}/{totalSignals}
                    <small>This run</small>
                  </div>
                </div>
                <div className={styles.signalLegend}>
                  <span><b>Account</b><em>verified</em></span>
                  <span><b>Intent</b><em>verified</em></span>
                  <span><b>Opportunity</b><em>verified</em></span>
                  <span><b>Activity</b><em>verified</em></span>
                </div>
              </div>
            </div>

            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>Human review</div>
              <div className={styles.guardrailValue}>
                <span className={styles.shield} aria-hidden="true">✓</span>
                <div>
                  <div className={styles.metricValue}>{MOCK_BLOCKED.length}</div>
                  <div className={styles.metricSub}>Accounts held before outreach</div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>
        <span className={styles.statIcon} aria-hidden="true">{icon}</span>
        {value}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <article className={styles.feature}>
      <span className={styles.featureIcon} aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function formatTier(tier: string): string {
  return tier
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
