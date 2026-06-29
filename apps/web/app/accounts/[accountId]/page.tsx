import { getRecommendation } from "../../lib/mock-data";
import ActionBar from "../../components/ActionBar";

/**
 * Account detail. In Next 15, dynamic route `params` is async.
 */
export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const rec = getRecommendation(accountId);

  if (!rec) {
    return (
      <section>
        <h1>Account {accountId}</h1>
        <p className="muted">No published recommendation for this account today.</p>
        <p>
          <a href="/dashboard">← Back to dashboard</a>
        </p>
      </section>
    );
  }

  return (
    <section>
      <p>
        <a href="/dashboard">← Back to dashboard</a>
      </p>
      <h1>
        {accountId} <span className="badge tag-accent">score {rec.score}</span>
      </h1>
      <div className="card">
        <h3>Why this account matters</h3>
        <p>{rec.reasonNarrative}</p>
        <div>
          {rec.reasonCodes.map((c) => (
            <span key={c} className="badge">
              {c}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Evidence (verified source signals)</h3>
        <ul>
          {rec.sourceSignals.map((s, i) => (
            <li key={i}>
              <span className={`badge ${s.verified ? "tag-good" : "tag-bad"}`}>
                {s.verified ? "verified" : "unverified"}
              </span>
              <span className="badge">{s.kind}</span> {s.description}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>Take action</h3>
        <p>
          <span className="badge">{rec.nextBestAction.type}</span>
          {rec.nextBestAction.customerFacing || rec.nextBestAction.crmWriteBack ? (
            <span className="badge tag-warn">requires human approval</span>
          ) : null}
        </p>
        <p>{rec.nextBestAction.objective}</p>
        <ActionBar rec={rec} />
      </div>

      <div className="card">
        <h3>Safety verification</h3>
        <table>
          <tbody>
            <tr>
              <td>Status</td>
              <td>{rec.verification.status}</td>
            </tr>
            <tr>
              <td>Schema valid</td>
              <td>{String(rec.verification.schemaValid)}</td>
            </tr>
            <tr>
              <td>Guardrails passed</td>
              <td>{String(rec.verification.guardrailsPassed)}</td>
            </tr>
            <tr>
              <td>Source signals verified</td>
              <td>{String(rec.verification.sourceSignalsVerified)}</td>
            </tr>
            <tr>
              <td>Permission granted</td>
              <td>{String(rec.verification.permissionGranted)}</td>
            </tr>
            <tr>
              <td>Approval</td>
              <td>{rec.approvalStatus}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
