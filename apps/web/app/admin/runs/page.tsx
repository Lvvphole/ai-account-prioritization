import { INSPECTED, RUNS } from "../../lib/admin-data";
import { humanizeCode } from "../../lib/display";
import { HealthPill, Section } from "../../components/AdminBits";

export default function AdminRunsPage() {
  const i = INSPECTED;
  const maxContribution = Math.max(...i.contributions.map((c) => c.weight));

  return (
    <section>
      <div className="page-header">
        <h1>Runs & Recommendations</h1>
        <p className="muted">
          Every production decision is reproducible. Pick a run, then take any single
          recommendation apart down to the signal that caused it.
        </p>
      </div>

      <Section title="Recent Runs">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Started</th>
                <th>Policy</th>
                <th>Prompt</th>
                <th>Snapshot</th>
                <th className="num">Evaluated</th>
                <th className="num">Published</th>
                <th className="num">Held</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {RUNS.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.id}</strong>
                    <div className="muted cell-sub">{r.durationSec}s</div>
                  </td>
                  <td className="muted">{r.startedAt}</td>
                  <td>{r.policyVersion}</td>
                  <td className="muted">{r.promptVersion}</td>
                  <td className="muted">{r.dataSnapshot}</td>
                  <td className="num">{r.accountsEvaluated.toLocaleString("en-US")}</td>
                  <td className="num">{r.published}</td>
                  <td className="num">{r.held}</td>
                  <td>
                    <HealthPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Recommendation Inspector"
        sub={`${i.recommendationId} · ${i.account} · from ${i.runId}`}
      >
        <div className="prov">
          <Prov label="Environment" value="Production" />
          <Prov label="Data snapshot" value={i.dataSnapshot} />
          <Prov label="Policy version" value={i.policyVersion} />
          <Prov label="Prompt version" value={i.promptVersion} />
          <Prov label="Owner" value={i.owner} />
          <Prov label="Final rank" value={`#${i.finalRank}`} />
          <Prov label="Final score" value={i.finalScore.toFixed(2)} />
          <Prov label="Confidence" value={`${(i.confidence * 100).toFixed(0)}%`} />
        </div>

        <p className="card-sub" style={{ marginTop: 18 }}>
          Score contributions — these sum to the final score. A factor whose trigger was
          not met contributes zero.
        </p>
        <ul className="contrib">
          {i.contributions.map((c) => (
            <li key={c.factor}>
              <span className="contrib-name">{c.factor}</span>
              <span className="contrib-raw muted">{c.raw}</span>
              <span className="contrib-bar">
                <span
                  style={{ width: `${(c.contribution / maxContribution) * 100}%` }}
                  className={c.contribution === 0 ? "zero" : ""}
                />
              </span>
              <span className="contrib-val">
                {c.contribution === 0 ? "—" : `+${c.contribution}`}
              </span>
            </li>
          ))}
        </ul>

        <p className="card-sub" style={{ marginTop: 18 }}>
          Reason codes emitted
        </p>
        <div className="chip-row">
          {i.reasonCodes.map((c) => (
            <span className="chip" key={c}>
              {humanizeCode(c)}
            </span>
          ))}
        </div>

        <p className="card-sub" style={{ marginTop: 18 }}>
          Guardrail results
        </p>
        <div className="chip-row">
          {i.guardrails.map((g) => (
            <span className="badge tag-good" key={g.gate}>
              {g.gate} · {g.result}
            </span>
          ))}
        </div>

        <dl className="rule-list tight" style={{ marginTop: 18 }}>
          <div>
            <dt>Human approvals</dt>
            <dd>
              {i.approvals
                .map((a) => `${a.actor} ${a.decision} at ${a.at}`)
                .join("; ")}
            </dd>
          </div>
          <div>
            <dt>CRM writes</dt>
            <dd>{i.crmWrites.length === 0 ? "None on this recommendation" : i.crmWrites.length}</dd>
          </div>
          <div>
            <dt>Outcome</dt>
            <dd>{i.outcome}</dd>
          </div>
        </dl>
      </Section>
    </section>
  );
}

function Prov({ label, value }: { label: string; value: string }) {
  return (
    <div className="prov-item">
      <span className="prov-label">{label}</span>
      <span className="prov-value">{value}</span>
    </div>
  );
}
