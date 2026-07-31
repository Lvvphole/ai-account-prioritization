import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { SYSTEM, TELEMETRY_IS_SAMPLE } from "../lib/admin-data";
import { requireCapability } from "../lib/auth";
import AdminNav from "../components/AdminNav";

/**
 * Admin control-plane shell.
 *
 * The environment badge and the emergency controls are pinned to every admin
 * page so an operator can never mistake staging for production, and never has
 * to navigate to stop the system.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireCapability("edit_scoring_config");

  // Pause state is live: it is read back from the same store the controls write.
  const jar = await cookies();
  const recsPaused = jar.get("ops_pause_recs")?.value === "1";
  const sendsPaused = jar.get("ops_pause_sends")?.value === "1";
  const returnTo = (await headers()).get("x-pathname") ?? "/admin";

  const s = SYSTEM;
  const health = sendsPaused || recsPaused ? "degraded" : s.health;

  return (
    <div className="admin">
      <header className="cp-header">
        <div className="cp-status">
          <span className={`env-badge env-${s.environment.toLowerCase()}`}>
            {s.environment}
          </span>
          <span className="cp-meta">Policy {s.policyVersion}</span>
          <span className="cp-sep">·</span>
          <span className="cp-meta">Prompt {s.promptVersion}</span>
          <span className="cp-sep">·</span>
          <span className="cp-meta">Last run {s.lastRunAt}</span>
          <span className="cp-sep">·</span>
          <span className={`cp-health health-${health}`}>
            <i />
            {recsPaused || sendsPaused ? "Operator pause active" : "System healthy"}
          </span>
        </div>

        <div className="cp-controls">
          <Control
            action="pause_recommendations"
            returnTo={returnTo}
            paused={recsPaused}
            onLabel="Resume recommendations"
            offLabel="Pause new recommendations"
          />
          <Control
            action="pause_sends"
            returnTo={returnTo}
            paused={sendsPaused}
            onLabel="Resume customer sends"
            offLabel="Pause customer-facing sends"
            tone="ctl-warn"
          />
          <a className="ctl" href="/admin/environments">
            Roll back latest release
          </a>
          <a className="ctl ctl-bad" href="/admin/audit#incidents">
            Open incident{s.activeIncidents === 1 ? "" : "s"} ({s.activeIncidents})
          </a>
        </div>

        {recsPaused || sendsPaused ? (
          <p className="cp-paused" role="status">
            {recsPaused ? "New recommendations are paused. " : ""}
            {sendsPaused ? "Customer-facing sends are paused. " : ""}
            The pause is recorded as an audit event and stays in force until an
            operator resumes it.
          </p>
        ) : (
          <p className="cp-note">
            Recommendations and customer sends pause independently, so an operator can
            stop outbound activity without stopping analysis.
          </p>
        )}

        {TELEMETRY_IS_SAMPLE ? (
          <p className="cp-note">
            Environment is read from the deploy. Counters and rates on these pages are
            sample data — live telemetry needs a metrics backend this demo does not run.
          </p>
        ) : null}
      </header>

      <AdminNav />
      <div className="cp-body">{children}</div>
    </div>
  );
}

function Control({
  action,
  returnTo,
  paused,
  onLabel,
  offLabel,
  tone,
}: {
  action: string;
  returnTo: string;
  paused: boolean;
  onLabel: string;
  offLabel: string;
  tone?: string;
}) {
  return (
    <form action="/admin/controls" method="post" style={{ display: "inline" }}>
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        className={`ctl${paused ? " ctl-active" : tone ? ` ${tone}` : ""}`}
      >
        {paused ? onLabel : offLabel}
      </button>
    </form>
  );
}
