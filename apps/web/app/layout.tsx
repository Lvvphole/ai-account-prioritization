import type { Metadata } from "next";
import type { ReactNode } from "react";
import { can } from "@repo/security";
import { getSessionContext } from "./lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Account Prioritization",
  description: "Verified daily sales action plans for B2B teams.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const ctx = await getSessionContext();

  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <strong>AI Account Prioritization</strong>
          {ctx ? (
            <>
              <a href="/dashboard">Rep Dashboard</a>
              {can(ctx.role, "view_team_coverage") ? <a href="/manager">Manager</a> : null}
              {can(ctx.role, "edit_scoring_config") ? (
                <a href="/admin/scoring">Admin · Scoring</a>
              ) : null}
              <span className="muted" style={{ marginLeft: "auto" }}>
                {ctx.email} · {ctx.role}
              </span>
              <form action="/auth/signout" method="post" style={{ display: "inline" }}>
                <button type="submit">Sign out</button>
              </form>
            </>
          ) : (
            <a href="/login">Sign in</a>
          )}
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
