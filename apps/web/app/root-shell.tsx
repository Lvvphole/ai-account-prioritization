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
  const useMarketingShell = pathname === "/" || !identity;

  if (useMarketingShell) {
    return (
      <div className={marketing.frame}>
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

  return (
    <div className="app-frame">
      <nav className="nav">
        <strong>
          <span className="brand-dot" aria-hidden="true" />
          AI Account Prioritization
        </strong>
        <a href="/dashboard">Rep Dashboard</a>
        {identity.canViewTeamCoverage ? <a href="/manager">Manager</a> : null}
        {identity.canEditScoringConfig ? <a href="/admin">Admin</a> : null}
        <span className="user-chip">
          <span className="avatar" aria-hidden="true">
            {(identity.email ?? "?").charAt(0).toUpperCase()}
          </span>
          <span className="user-meta">
            <span className="user-name">{identity.email}</span>
            <span className="user-role">{identity.role}</span>
          </span>
        </span>
        <a className="btn-link" href="/login">
          Switch Role
        </a>
        <form action="/auth/signout" method="post" style={{ display: "inline" }}>
          <button type="submit">Sign Out</button>
        </form>
      </nav>
      <main className="container">{children}</main>
    </div>
  );
}
