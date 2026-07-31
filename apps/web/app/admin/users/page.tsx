import { USERS } from "../../lib/admin-data";
import { Section } from "../../components/AdminBits";

const MATRIX: { capability: string; rep: boolean; manager: boolean; admin: boolean }[] = [
  { capability: "View own recommendations", rep: true, manager: true, admin: true },
  { capability: "Approve customer action", rep: true, manager: true, admin: true },
  { capability: "View team coverage", rep: false, manager: true, admin: true },
  { capability: "View audit evidence", rep: false, manager: true, admin: true },
  { capability: "Edit scoring config", rep: false, manager: false, admin: true },
];

export default function AdminUsersPage() {
  return (
    <section>
      <div className="page-header">
        <h1>Users & Roles</h1>
        <p className="muted">
          The capability matrix below is the same one the API and the database enforce.
          It is not a second copy of the rules.
        </p>
      </div>

      <Section
        title="Capability Matrix"
        sub="Mirrors @repo/security and the Supabase row-level-security predicates. Unknown roles are denied."
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Capability</th>
                <th>Rep</th>
                <th>Manager</th>
                <th>Admin</th>
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((m) => (
                <tr key={m.capability}>
                  <td>
                    <strong>{m.capability}</strong>
                  </td>
                  <Cell on={m.rep} />
                  <Cell on={m.manager} />
                  <Cell on={m.admin} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="People" sub="Role, team and the accounts each person can reach.">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Team</th>
                <th>Account access</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {USERS.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                    <div className="muted cell-sub">{u.email}</div>
                  </td>
                  <td>
                    <span
                      className={`badge ${u.role === "Admin" ? "tag-accent" : u.role === "Auditor" ? "tag-warn" : ""}`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="muted">{u.team}</td>
                  <td className="muted">{u.accountAccess}</td>
                  <td className="muted">{u.lastActive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </section>
  );
}

function Cell({ on }: { on: boolean }) {
  return (
    <td>
      {on ? (
        <span className="badge tag-good">Granted</span>
      ) : (
        <span className="muted">—</span>
      )}
    </td>
  );
}
