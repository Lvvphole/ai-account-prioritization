import { INTEGRATIONS, LINEAGE_EXAMPLE } from "../../lib/admin-data";
import { HealthPill, Section } from "../../components/AdminBits";

export default function AdminDataPage() {
  return (
    <section>
      <div className="page-header">
        <h1>Data & Integrations</h1>
        <p className="muted">
          Source health, freshness and rejects. Every recommendation is only as good
          as the record underneath it, so this page shows where records come from and
          what is failing to arrive.
        </p>
      </div>

      {INTEGRATIONS.map((s) => (
        <div className="card" key={s.id}>
          <div className="card-head">
            <div>
              <h3>
                {s.name} <HealthPill status={s.status} />
              </h3>
              <p className="card-sub">
                Owner {s.owner} · scope {s.scope}
              </p>
            </div>
            <div className="actions">
              <button className="action-btn">Test connection</button>
              <button className="action-btn">Field mappings</button>
              <button className="action-btn">Rejected records</button>
              {s.status !== "healthy" ? (
                <button className="action-btn btn-primary">Reprocess sync</button>
              ) : null}
            </div>
          </div>

          <div className="metric-grid compact">
            <Fact label="Last successful sync" value={s.lastSync} />
            <Fact
              label="Sync lag"
              value={`${s.lagMinutes} min`}
              tone={s.lagMinutes > 30 ? "warn" : undefined}
            />
            <Fact label="Records processed" value={s.recordsProcessed.toLocaleString("en-US")} />
            <Fact
              label="Records rejected"
              value={String(s.recordsRejected)}
              tone={s.recordsRejected > 40 ? "warn" : undefined}
            />
            <Fact
              label="Duplicate rate"
              value={`${s.duplicateRatePct}%`}
              tone={s.duplicateRatePct > 2 ? "warn" : undefined}
            />
            <Fact
              label="API error rate"
              value={`${s.apiErrorRatePct}%`}
              tone={s.apiErrorRatePct > 5 ? "bad" : s.apiErrorRatePct > 1 ? "warn" : undefined}
            />
            <Fact
              label="Dependent recommendations"
              value={String(s.dependentRecommendations)}
              hint={
                s.dependentRecommendations === 0
                  ? "Nothing in today's run relies on this source"
                  : undefined
              }
            />
          </div>

          {s.missingRequiredFields.length > 0 ? (
            <p className="note">
              Missing required field{s.missingRequiredFields.length === 1 ? "" : "s"}:{" "}
              {s.missingRequiredFields.join(", ")}
            </p>
          ) : null}
        </div>
      ))}

      <Section
        title="Data Lineage"
        sub="Trace any recommendation back to the integration run that produced its evidence."
      >
        <ol className="lineage">
          {LINEAGE_EXAMPLE.map((hop, i) => (
            <li key={hop.ref}>
              <span className="lineage-step">{i + 1}</span>
              <div>
                <div className="lineage-layer">{hop.layer}</div>
                <div className="lineage-ref">{hop.ref}</div>
                <div className="muted lineage-detail">{hop.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      </Section>
    </section>
  );
}

function Fact({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "warn" | "bad";
  hint?: string;
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className={`metric-val${tone ? ` m-${tone}` : ""}`}>{value}</span>
      {hint ? <span className="metric-hint">{hint}</span> : null}
    </div>
  );
}
