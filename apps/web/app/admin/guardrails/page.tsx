import { HOLDS } from "../../lib/admin-data";
import { humanizeCode } from "../../lib/display";
import { Section } from "../../components/AdminBits";

export default function AdminGuardrailsPage() {
  return (
    <section>
      <div className="page-header">
        <h1>Guardrails & Approvals</h1>
        <p className="muted">
          Everything the gates stopped, why, and what to do about it. Held items never
          reached a rep and never reached a customer.
        </p>
      </div>

      {HOLDS.map((h) => (
        <div className="card hold" key={h.id}>
          <div className="card-head">
            <div>
              <h3>
                Held: {humanizeCode(h.failedRule)}{" "}
                <span className={`badge sev-${h.severity}`}>{h.severity} severity</span>
              </h3>
              <p className="card-sub">
                <a href={`/accounts/${h.accountId}`}>{h.account}</a> · {h.owner} ·{" "}
                {h.proposedAction} · held {h.heldFor}
              </p>
            </div>
            <span className={`badge ${h.status === "escalated" ? "tag-bad" : "tag-warn"}`}>
              {h.status}
            </span>
          </div>

          <p className="hold-why">{h.explanation}</p>

          <dl className="rule-list tight">
            <div>
              <dt>Evidence used</dt>
              <dd>{h.evidence}</dd>
            </div>
            <div>
              <dt>Recommended resolution</dt>
              <dd>{h.recommendedResolution}</dd>
            </div>
            <div>
              <dt>Reviewer</dt>
              <dd>{h.reviewer}</dd>
            </div>
          </dl>

          <div className="actions">
            <button className="action-btn btn-primary">Approve exception</button>
            <button className="action-btn">Change action</button>
            <button className="action-btn">Return to rep</button>
            <button className="action-btn">Block account</button>
            <button className="action-btn">Escalate</button>
          </div>
          <p className="note">
            An exception requires a written reason and is written to the audit trail as
            an immutable event. It cannot be edited or removed afterwards.
          </p>
        </div>
      ))}

      <Section
        title="Approval Rules"
        sub="What requires a human before it can leave the system."
      >
        <dl className="rule-list">
          <div>
            <dt>Customer-facing sends</dt>
            <dd>Always require rep approval. No exceptions, no auto-send path exists.</dd>
          </div>
          <div>
            <dt>CRM write-back</dt>
            <dd>Requires rep approval; manager approval when the account is not theirs.</dd>
          </div>
          <div>
            <dt>Guardrail exception</dt>
            <dd>Admin only, with a written reason, recorded as an audit event.</dd>
          </div>
          <div>
            <dt>Fail-closed default</dt>
            <dd>
              Any gate that cannot be evaluated counts as a failure. Unverified evidence
              is never published.
            </dd>
          </div>
        </dl>
      </Section>
    </section>
  );
}
