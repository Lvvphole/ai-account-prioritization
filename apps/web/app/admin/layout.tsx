import type { ReactNode } from "react";
import { SYSTEM } from "../lib/admin-data";
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
  const s = SYSTEM;

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
          <span className={`cp-health health-${s.health}`}>
            <i />
            {s.health === "healthy" ? "System healthy" : `System ${s.health}`}
          </span>
        </div>

        <div className="cp-controls">
          <button className="ctl">
            {s.recommendationsPaused ? "Resume recommendations" : "Pause new recommendations"}
          </button>
          <button className="ctl ctl-warn">
            {s.sendsPaused ? "Resume customer sends" : "Pause customer-facing sends"}
          </button>
          <button className="ctl">Roll back latest release</button>
          <a className="ctl ctl-bad" href="/admin/audit#incidents">
            Open incident{s.activeIncidents === 1 ? "" : "s"} ({s.activeIncidents})
          </a>
        </div>
        <p className="cp-note">
          Recommendations and customer sends pause independently, so an operator can
          stop outbound activity without stopping analysis.
        </p>
      </header>

      <AdminNav />
      <div className="cp-body">{children}</div>
    </div>
  );
}
