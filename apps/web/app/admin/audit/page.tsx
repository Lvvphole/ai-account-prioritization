import { AUDIT_EVENTS, INCIDENTS } from "../../lib/admin-data";
import { humanizeCode } from "../../lib/display";
import { Section } from "../../components/AdminBits";

export default function AdminAuditPage() {
  return (
    <section>
      <div className="page-header">
        <h1>Audit & Incidents</h1>
        <p className="muted">
          Write-once history of every critical action, and the investigations opened
          against it.
        </p>
      </div>

      <Section
        title="Audit Trail"
        sub="Publishes, blocks, approvals, policy changes and rollbacks. Rows are append-only: nothing here can be edited or deleted, including by an admin."
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {AUDIT_EVENTS.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{e.at}</td>
                  <td>
                    {e.actor === "system" ? (
                      <span className="badge">system</span>
                    ) : (
                      <strong>{e.actor}</strong>
                    )}
                  </td>
                  <td>
                    <span className="badge tag-accent">{humanizeCode(e.action)}</span>
                  </td>
                  <td className="muted">{e.target}</td>
                  <td className="muted">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Audit evidence is inserted through a service role and has no update or delete
          policy, so the trail cannot be rewritten from the application.
        </p>
      </Section>

      <div id="incidents">
        <Section title="Incidents" sub="Open investigations and their blast radius.">
          {INCIDENTS.map((inc) => (
            <div className="incident" key={inc.id}>
              <div className="incident-head">
                <span className={`badge sev-${inc.severity === "SEV1" ? "high" : inc.severity === "SEV2" ? "medium" : "low"}`}>
                  {inc.severity}
                </span>
                <strong>{inc.id}</strong>
                <span className="incident-title">{inc.title}</span>
                <span className={`badge ${inc.state === "open" ? "tag-bad" : inc.state === "mitigated" ? "tag-warn" : "tag-good"}`}>
                  {inc.state}
                </span>
              </div>
              <p className="muted incident-meta">
                Opened {inc.opened} · owner {inc.owner}
              </p>
              <p className="incident-impact">{inc.impact}</p>
            </div>
          ))}
        </Section>
      </div>
    </section>
  );
}
