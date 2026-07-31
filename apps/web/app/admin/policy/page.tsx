import {
  POLICY_FACTORS,
  POLICY_RULES,
  POLICY_SIMULATION,
  POLICY_VERSIONS,
  SIMULATION_SUMMARY,
} from "../../lib/admin-data";
import { formatUsd } from "../../lib/display";
import { MetricGrid, ReadOnlyBar, Section, StatePill } from "../../components/AdminBits";

const WORKFLOW = [
  "Create draft",
  "Run against historical accounts",
  "Compare rankings",
  "Run deterministic evals",
  "Request approval",
  "Schedule or publish",
  "Monitor",
  "Roll back",
];

export default function AdminPolicyPage() {
  const draft = POLICY_VERSIONS.find((v) => v.state === "evaluating");
  const totalWeight = POLICY_FACTORS.reduce((t, f) => t + f.weight, 0);

  return (
    <section>
      <div className="page-header">
        <h1>Decision Policy</h1>
        <p className="muted">
          The deterministic scorer. This formula alone decides rank — the model has no
          vote here. Same inputs, same order, every run.
        </p>
      </div>

      <ReadOnlyBar what="The live policy" />

      <Section
        title="Factor Weights"
        sub={`Policy v12 · weights total ${totalWeight}%. Mirrors the runtime scorer: each feature is clamped to 0–1 and scaled continuously toward saturation, then multiplied by its weight.`}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Factor</th>
                <th className="num">Weight</th>
                <th>Scaling</th>
                <th className="num">Max contribution</th>
              </tr>
            </thead>
            <tbody>
              {POLICY_FACTORS.map((f) => (
                <tr key={f.factor}>
                  <td>
                    <strong>{f.factor}</strong>
                  </td>
                  <td className="num">{f.weight}%</td>
                  <td className="muted">{f.scaling}</td>
                  <td className="num">{f.maxContribution}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Rules and Constraints" sub="Everything the weights alone do not express.">
        <dl className="rule-list">
          {POLICY_RULES.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section
        title="Safe Change Workflow"
        sub="Moving a weight in production would silently re-rank every rep's day. It is not possible here."
      >
        <ol className="workflow">
          {WORKFLOW.map((step, i) => (
            <li key={step} className={i < 3 ? "done" : ""}>
              <span className="wf-num">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </Section>

      {draft ? (
        <Section
          title={`Proposed ${draft.version} · Simulation`}
          sub={`${draft.rationale} Run against historical accounts before anything is published.`}
          action={
            <div className="actions">
              <button className="action-btn">Discard draft</button>
              <button className="action-btn btn-primary">Request approval</button>
            </div>
          }
        >
          <MetricGrid items={SIMULATION_SUMMARY} />

          <p className="card-sub" style={{ marginTop: 16 }}>
            Accounts entering and leaving the top group
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Owner</th>
                  <th className="num">Current</th>
                  <th className="num">Proposed</th>
                  <th className="num">Revenue</th>
                  <th>Movement</th>
                </tr>
              </thead>
              <tbody>
                {POLICY_SIMULATION.map((row) => (
                  <tr key={row.account}>
                    <td>
                      <strong>{row.account}</strong>
                    </td>
                    <td className="muted">{row.owner}</td>
                    <td className="num">{row.currentRank}</td>
                    <td className="num">{row.proposedRank}</td>
                    <td className="num">{formatUsd(row.revenue)}</td>
                    <td>
                      <Movement change={row.change} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            Territory concentration shifts +18% to West. Check for skew before approving.
          </p>
        </Section>
      ) : null}

      <Section
        title="Version History"
        sub="Versions are immutable. A change is a new version with an owner, a rationale and a rollback target."
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>State</th>
                <th>Owner</th>
                <th>Rationale</th>
                <th>Evals</th>
                <th>Approver</th>
                <th>Effective</th>
                <th>Rollback to</th>
              </tr>
            </thead>
            <tbody>
              {POLICY_VERSIONS.map((v) => (
                <tr key={v.version}>
                  <td>
                    <strong>{v.version}</strong>
                  </td>
                  <td>
                    <StatePill state={v.state} />
                  </td>
                  <td>{v.owner}</td>
                  <td className="muted">{v.rationale}</td>
                  <td className="muted">{v.evalResult}</td>
                  <td>{v.approver}</td>
                  <td className="muted">{v.effective}</td>
                  <td className="muted">{v.rollbackTarget}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </section>
  );
}

function Movement({ change }: { change: "enters" | "leaves" | "up" | "down" | "same" }) {
  const map = {
    enters: { label: "Enters top 25", cls: "tag-warn" },
    leaves: { label: "Leaves top 25", cls: "tag-bad" },
    up: { label: "Moves up", cls: "tag-good" },
    down: { label: "Moves down", cls: "tag-warn" },
    same: { label: "Unchanged", cls: "" },
  } as const;
  const m = map[change];
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}
