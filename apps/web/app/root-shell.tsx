"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import marketing from "./marketing.module.css";

type WorkspaceIdentity = {
  email: string | null;
  role: string;
  canViewTeamCoverage: boolean;
  canEditScoringConfig: boolean;
};

export default function RootShell({
  children,
  identity,
  demo,
}: {
  children: ReactNode;
  identity: WorkspaceIdentity | null;
  demo: boolean;
}) {
  const pathname = usePathname();
  const useMarketingShell = pathname === "/" || pathname === "/login" || !identity;

  if (useMarketingShell) {
    return (
      <div className={`${marketing.frame} marketing-mobile-scope`}>
        <nav className={marketing.nav} aria-label="Marketing navigation">
          <a className={marketing.brand} href="/" aria-label="AI Account Prioritization home">
            <span className={marketing.brandMark} aria-hidden="true">
              <span className={marketing.brandBar} />
            </span>
            AI Account Prioritization
          </a>

          <div className={marketing.navLinks}>
            <a href="/#product">Product</a>
            <a href="/#how-it-works">How It Works</a>
            <a href="/#security">Security</a>
          </div>

          <div className={marketing.navActions}>
            <a href="/login">Sign in</a>
            <a className={marketing.navCta} href="/login">
              {demo ? "Open Live Demo" : "Sign in to Workspace"}
            </a>
          </div>
        </nav>
        <main className={marketing.main}>{children}</main>
      </div>
    );
  }

  const workspaceRoute = pathname.startsWith("/manager")
    ? "workspace-route-manager"
    : pathname.startsWith("/admin")
      ? "workspace-route-admin"
      : pathname.startsWith("/accounts")
        ? "workspace-route-accounts"
        : "workspace-route-dashboard";

  const workspaceLinks = (
    <>
      <a href="/dashboard">Rep Dashboard</a>
      {identity.canViewTeamCoverage ? <a href="/manager">Manager</a> : null}
      {identity.canEditScoringConfig ? <a href="/admin">Admin</a> : null}
    </>
  );

  return (
    <div className="app-frame workspace-mobile-scope">
      <nav className="nav workspace-nav" aria-label="Workspace navigation">
        <strong className="workspace-brand">
          <span className="brand-dot" aria-hidden="true" />
          AI Account Prioritization
        </strong>

        <div className="workspace-links">{workspaceLinks}</div>

        <span className="user-chip">
          <span className="avatar" aria-hidden="true">
            {(identity.email ?? "?").charAt(0).toUpperCase()}
          </span>
          <span className="user-meta">
            <span className="user-name">{identity.email}</span>
            <span className="user-role">{identity.role}</span>
          </span>
        </span>

        <div className="workspace-actions">
          <a className="btn-link" href="/login">
            Switch Role
          </a>
          <form action="/auth/signout" method="post">
            <button type="submit">Sign Out</button>
          </form>
        </div>

        <details className="workspace-mobile-menu">
          <summary>Menu</summary>
          <div className="workspace-mobile-panel">
            <div className="workspace-mobile-route-links">{workspaceLinks}</div>
            <div className="workspace-mobile-session-actions">
              <a href="/login">Switch Role</a>
              <form action="/auth/signout" method="post">
                <button type="submit">Sign Out</button>
              </form>
            </div>
          </div>
        </details>
      </nav>
      <main className={`container ${workspaceRoute}`}>{children}</main>
    </div>
  );
}
