import { ENVIRONMENTS } from "../../lib/admin-data";
import { Section, StatePill } from "../../components/AdminBits";

export default function AdminEnvironmentsPage() {
  return (
    <section>
      <div className="page-header">
        <h1>Environments</h1>
        <p className="muted">
          What is running where, and what is queued to promote. Production never
          auto-publishes.
        </p>
      </div>

      <Section
        title="Environments"
        sub="Policy and prompt versions are tracked separately because they promote on different schedules."
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Environment</th>
                <th>Policy</th>
                <th>Prompt</th>
                <th>State</th>
                <th>Last release</th>
                <th>Auto-publish</th>
              </tr>
            </thead>
            <tbody>
              {ENVIRONMENTS.map((e) => (
                <tr key={e.name}>
                  <td>
                    <span className={`env-badge env-${e.name.toLowerCase()}`}>{e.name}</span>
                  </td>
                  <td>
                    <strong>{e.policyVersion}</strong>
                  </td>
                  <td className="muted">{e.promptVersion}</td>
                  <td>
                    <StatePill state={e.status} />
                  </td>
                  <td className="muted">{e.lastRelease}</td>
                  <td>
                    {e.autoPublish ? (
                      <span className="badge tag-warn">Enabled</span>
                    ) : (
                      <span className="badge tag-good">Manual only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Promotion Path" sub="A change moves in one direction, and only after its evals pass.">
        <ol className="workflow">
          <li className="done">
            <span className="wf-num">1</span>Development
          </li>
          <li className="done">
            <span className="wf-num">2</span>Staging · evals run
          </li>
          <li>
            <span className="wf-num">3</span>Approval
          </li>
          <li>
            <span className="wf-num">4</span>Production · scheduled publish
          </li>
          <li>
            <span className="wf-num">5</span>Monitor · rollback available
          </li>
        </ol>
        <p className="note">
          Policy v13 is in staging with 18 of 23 checks complete. It cannot be promoted
          until the suite passes and an approver signs off.
        </p>
      </Section>
    </section>
  );
}
