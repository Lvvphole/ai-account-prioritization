import type { Metadata } from "next";
import type { ReactNode } from "react";
import { can } from "@repo/security";
import { getSessionContext } from "./lib/auth";
import { isSupabaseConfigured } from "./lib/supabase/config";
import marketing from "./marketing.module.css";
import "./globals.css";
import "./public-shell.css";

export const metadata: Metadata = {
  title: "AI Account Prioritization | Verified Sales Priorities",
  description:
    "Turn verified CRM signals into a ranked daily sales plan with evidence, next-best actions, and human approval.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const ctx = await getSessionContext();
  const demo = !isSupabaseConfigured();

  if (!ctx) {
    return (
      <html lang="en">
        <body>
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
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body>
        <div className="app-frame">
          <nav className="nav">
            <strong>
              <span className="brand-dot" aria-hidden="true" />
              AI Account Prioritization
            </strong>
            <a href="/dashboard">Rep Dashboard</a>
            {can(ctx.role, "view_team_coverage") ? <a href="/manager">Manager</a> : null}
            {can(ctx.role, "edit_scoring_config") ? <a href="/admin">Admin</a> : null}
            <span className="user-chip">
              <span className="avatar" aria-hidden="true">
                {(ctx.email ?? "?").charAt(0).toUpperCase()}
              </span>
              <span className="user-meta">
                <span className="user-name">{ctx.email}</span>
                <span className="user-role">{ctx.role}</span>
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
      </body>
    </html>
  );
}
