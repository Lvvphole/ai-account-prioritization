import { MOCK_RECOMMENDATIONS, MOCK_BLOCKED, accountProfile, repName } from "../lib/mock-data";
import { formatUsd, humanizeCode } from "../lib/display";
import {
  exportRows,
  postureSplit,
  repRollup,
  teamTotals,
  type PostureItem,
} from "../lib/analytics";
import ExportButtons from "../components/ExportButtons";
import { requireCapability } from "../lib/auth";

export default async function ManagerPage() {
  await requireCapability("view_team_coverage");

  const recs = [...MOCK_RECOMMENDATIONS].sort((a, b) => a.rank - b.rank);
  const totals = teamTotals(recs);
  const reps = repRollup(recs);
  const split = postureSplit(recs);

  return (
    <section>
      <div className="page-header">
        <h1>Manager View</h1>
        <p className="muted">
          Team coverage for run_demo, what is driving today’s list, and everything the
          safety gates are holding back.
        </p>
      </div>

      <div className="kpi-row">
        <Kpi value={formatUsd(totals.pipeline)} label="Pipeline in View" />
        <Kpi value={String(totals.accounts)} label="Accounts Ranked" />
        <Kpi value={String(reps.length)} label="Reps Covered" />
        <Kpi value={`${(totals.avgConfidence * 100).toFixed(0)}%`} label="Avg Confidence" />
        <Kpi value={String(totals.awaitingApproval)} label="Awaiting Approval" tone="warn" />
        <Kpi value={String(totals.held)} label="Held by Guardrails" tone="bad" />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Coverage by Rep</h3>
            <p className="card-sub">Ranked by pipeline in view.</p>
          </div>
          <ExportButtons rows={reps as unknown as Record<string, string | number>[]} filename="coverage-by-rep" />
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Rep</th>
                <th className="num">Accounts</th>
                <th className="num">Pipeline</th>
                <th className="num">Avg Score</th>
                <th className="num">Avg Conf.</th>
                <th>Top Action</th>
                <th className="num">Pending</th>
                <th className="num">Held</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((rep) => (
                <tr key={rep.ownerId}>
                  <td>
                    <strong>{rep.name}</strong>
                    <div className="muted cell-sub">{rep.ownerId}</div>
                  </td>
                  <td className="num">{rep.accounts}</td>
                  <td className="num">{formatUsd(rep.pipeline)}</td>
                  <td className="num">{rep.avgScore.toFixed(1)}</td>
                  <td className="num">{(rep.avgConfidence * 100).toFixed(0)}%</td>
                  <td>
                    <span className="badge tag-accent">{rep.topAction}</span>
                  </td>
                  <td className="num">
                    {rep.awaitingApproval > 0 ? (
                      <span className="badge tag-warn">{rep.awaitingApproval}</span>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                  <td className="num">
                    {rep.held > 0 ? (
                      <span className="badge tag-bad">{rep.held}</span>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Where Today’s Revenue Sits</h3>
            <p className="card-sub">
              {formatUsd(split.total)} in view. An account counts once, as Defending if
              it carries any risk signal.
            </p>
          </div>
        </div>

        <div className="split-bar">
          <span
            className="split-seg seg-protect"
            style={{ width: `${pct(split.protect.value, split.total)}%` }}
          />
          <span
            className="split-seg seg-grow"
            style={{ width: `${pct(split.grow.value, split.total)}%` }}
          />
        </div>
        <div className="split-legend">
          <span>
            <i className="dot-protect" /> Defending{" "}
            <strong>{formatUsd(split.protect.value)}</strong> ·{" "}
            {pct(split.protect.value, split.total)}%
          </span>
          <span>
            <i className="dot-grow" /> Pursuing{" "}
            <strong>{formatUsd(split.grow.value)}</strong> ·{" "}
            {pct(split.grow.value, split.total)}%
          </span>
        </div>

        <div className="posture-grid">
          <PostureGroup
            tone="protect"
            title="Defending"
            sub="Revenue already booked that is exposed."
            items={split.protect.items}
          />
          <PostureGroup
            tone="grow"
            title="Pursuing"
            sub="New and expansion revenue in play."
            items={split.grow.items}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Held by the Safety Gates</h3>
            <p className="card-sub">
              Fail-closed. These never reached a rep, and never reached a customer.
            </p>
          </div>
        </div>
        {MOCK_BLOCKED.length === 0 ? (
          <p className="muted">Nothing held on this run.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Owner</th>
                  <th>Gate</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_BLOCKED.map((b) => (
                  <tr key={b.accountId}>
                    <td>
                      <strong>{b.name}</strong>
                      <div className="muted cell-sub">{b.accountId}</div>
                    </td>
                    <td>{repName(b.ownerId)}</td>
                    <td>
                      {b.failedGates.map((g) => (
                        <span key={g} className="badge tag-bad">
                          {humanizeCode(g)}
                        </span>
                      ))}
                    </td>
                    <td className="muted">{b.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Full Run Export</h3>
            <p className="card-sub">
              Every published recommendation with its score, evidence and approval state.
            </p>
          </div>
          <ExportButtons rows={exportRows(recs)} filename="run_demo-recommendations" />
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Account</th>
                <th>Owner</th>
                <th className="num">Score</th>
                <th>Next Action</th>
                <th>Approval</th>
              </tr>
            </thead>
            <tbody>
              {recs.map((rec) => (
                <tr key={rec.id}>
                  <td className="num">{rec.rank}</td>
                  <td>
                    <a href={`/accounts/${rec.accountId}`}>
                      {accountProfile(rec.accountId)?.name ?? rec.accountId}
                    </a>
                  </td>
                  <td>{repName(rec.ownerId)}</td>
                  <td className="num">{rec.score.toFixed(1)}</td>
                  <td className="muted">{rec.nextBestAction.objective}</td>
                  <td>
                    <span
                      className={`badge ${
                        rec.approvalStatus === "approved" ? "tag-good" : "tag-warn"
                      }`}
                    >
                      {humanizeCode(rec.approvalStatus)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const pct = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

function PostureGroup({
  tone,
  title,
  sub,
  items,
}: {
  tone: "protect" | "grow";
  title: string;
  sub: string;
  items: PostureItem[];
}) {
  return (
    <div className="posture-group">
      <div className={`posture-head head-${tone}`}>
        <h4>{title}</h4>
        <span className="muted">{sub}</span>
      </div>
      {items.length === 0 ? (
        <p className="muted posture-empty">Nothing in this group today.</p>
      ) : (
        items.map((item) => (
          <div className="posture-row" key={item.id}>
            <div className="posture-main">
              <a href={`/accounts/${item.accountId}`}>{item.name}</a>
              <span className="posture-owner">{item.owner}</span>
            </div>
            <span className="posture-val">{formatUsd(item.value)}</span>
            <div className="posture-drivers">
              {item.drivers.map((d) => (
                <span key={d} className="chip">
                  {d}
                </span>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Kpi({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="kpi">
      <span className={`kpi-val${tone ? ` kpi-${tone}` : ""}`}>{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}
