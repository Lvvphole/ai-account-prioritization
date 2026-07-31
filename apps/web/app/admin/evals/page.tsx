import { EVAL_SUITES, EXPERIMENTS } from "../../lib/admin-data";
import { HealthPill, Section, StatePill } from "../../components/AdminBits";

export default function AdminEvalsPage() {
  const deterministic = EVAL_SUITES.filter((s) => s.kind === "deterministic");
  const generative = EVAL_SUITES.filter((s) => s.kind === "generative");

  return (
    <section>
      <div className="page-header">
        <h1>Evals & Experiments</h1>
        <p className="muted">
          Quality tests gate releases; experiments measure whether a change actually
          helped.
        </p>
      </div>

      <Section
        title="Deterministic Suites"
        sub="Blocking. A ranking change cannot ship unless these pass."
      >
        <SuiteTable suites={deterministic} />
      </Section>

      <Section
        title="Generative Suites"
        sub="Non-blocking and asynchronous. A judge model grades drafts after the fact; it never sits in the runtime path."
      >
        <SuiteTable suites={generative} />
        <p className="note">
          2 checks failing. Groundedness regressions hold the affected drafts rather
          than sending them.
        </p>
      </Section>

      <Section title="Experiments" sub="Lift against a holdout, not against intuition.">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Experiment</th>
                <th>State</th>
                <th>Cohort</th>
                <th>Metric</th>
                <th className="num">Control</th>
                <th className="num">Variant</th>
                <th className="num">Lift</th>
                <th>Significance</th>
              </tr>
            </thead>
            <tbody>
              {EXPERIMENTS.map((e) => (
                <tr key={e.name}>
                  <td>
                    <strong>{e.name}</strong>
                  </td>
                  <td>
                    <StatePill state={e.state} />
                  </td>
                  <td className="muted">{e.cohort}</td>
                  <td className="muted">{e.metric}</td>
                  <td className="num">{e.control}</td>
                  <td className="num">{e.variant}</td>
                  <td className="num">
                    <strong>{e.lift}</strong>
                  </td>
                  <td className="muted">{e.significance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </section>
  );
}

function SuiteTable({ suites }: { suites: typeof EVAL_SUITES }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Suite</th>
            <th className="num">Passing</th>
            <th>Status</th>
            <th>Last run</th>
          </tr>
        </thead>
        <tbody>
          {suites.map((s) => (
            <tr key={s.name}>
              <td>
                <strong>{s.name}</strong>
              </td>
              <td className="num">
                {s.passed} / {s.total}
              </td>
              <td>
                <HealthPill status={s.status} />
              </td>
              <td className="muted">{s.lastRun}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
