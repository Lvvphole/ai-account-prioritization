import { MOCK_RECOMMENDATIONS, MOCK_BLOCKED } from "../lib/mock-data";
import { requireCapability } from "../lib/auth";

export default async function ManagerPage() {
  await requireCapability("view_team_coverage");

  const byOwner = new Map<string, number>();
  for (const rec of MOCK_RECOMMENDATIONS) {
    byOwner.set(rec.ownerId, (byOwner.get(rec.ownerId) ?? 0) + 1);
  }

  return (
    <section>
      <h1>Manager View</h1>
      <p className="muted">Team coverage and recommendations held by the safety gates.</p>

      <div className="card">
        <h3>Coverage by rep</h3>
        <table>
          <thead>
            <tr>
              <th>Rep</th>
              <th>Published recommendations</th>
            </tr>
          </thead>
          <tbody>
            {[...byOwner.entries()].map(([owner, count]) => (
              <tr key={owner}>
                <td>{owner}</td>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Coverage gaps — blocked / held (fail-closed)</h3>
        {MOCK_BLOCKED.length === 0 ? (
          <p className="muted">No blocked recommendations.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Reason held</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_BLOCKED.map((b) => (
                <tr key={b.accountId}>
                  <td>
                    {b.name} ({b.accountId})
                  </td>
                  <td>
                    {b.failedGates.map((g) => (
                      <span key={g} className="badge tag-bad">
                        {g}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
