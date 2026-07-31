import { DRAFTING_CONFIG, DRAFTING_EVALS } from "../../lib/admin-data";
import { MetricGrid, ReadOnlyBar, Section } from "../../components/AdminBits";

export default function AdminDraftingPage() {
  return (
    <section>
      <div className="page-header">
        <h1>AI Drafting</h1>
        <p className="muted">
          The generative component. It writes the email, call prep and meeting
          language — and nothing else.
        </p>
      </div>

      <div className="boundary">
        <span className="boundary-title">Why this is a separate page</span>
        <p>
          Ranking is deterministic and drafting is probabilistic. They fail in
          different ways, are measured with different tests, and roll back on
          different timescales: a policy change re-orders every rep&rsquo;s day and is
          reversed by publishing the previous version, while a prompt change alters
          wording and is reversed by pinning the previous template. Putting them
          behind one &ldquo;AI settings&rdquo; tab would hide the boundary that makes the
          system auditable.
        </p>
        <p className="boundary-rule">
          The model never sets rank, never selects an account, and never sends.
        </p>
      </div>

      <ReadOnlyBar what="The live drafting configuration" />

      <Section
        title="Configuration"
        sub="Model, template, schema and the hard limits on what a draft may contain or do."
      >
        <dl className="rule-list">
          {DRAFTING_CONFIG.map((c) => (
            <div key={c.label}>
              <dt>{c.label}</dt>
              <dd>{c.value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section
        title="Quality Evaluations"
        sub="Run asynchronously, outside the runtime, so a judge model can never gate or delay a recommendation."
      >
        <MetricGrid items={DRAFTING_EVALS} />
        <p className="note">
          Unsupported claims sit at 0.9% against a 1% budget. Drafts that fail
          groundedness are held, not sent.
        </p>
      </Section>

      <Section
        title="Rep Corrections"
        sub="What reps actually change before sending. The clearest signal for the next prompt version."
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Correction</th>
                <th className="num">Frequency</th>
                <th>Example</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Shortened opening</strong>
                </td>
                <td className="num">31%</td>
                <td className="muted">Removed two-sentence preamble before the ask</td>
                <td>
                  <span className="badge tag-warn">Unreviewed</span>
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Removed formal sign-off</strong>
                </td>
                <td className="num">24%</td>
                <td className="muted">&ldquo;Kind regards&rdquo; replaced with first name</td>
                <td>
                  <span className="badge tag-warn">Unreviewed</span>
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Added specific date</strong>
                </td>
                <td className="num">18%</td>
                <td className="muted">Replaced &ldquo;soon&rdquo; with a concrete proposed time</td>
                <td>
                  <span className="badge tag-good">Folded into 2026.06.3</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </section>
  );
}
