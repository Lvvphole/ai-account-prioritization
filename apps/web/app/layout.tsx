import type { Metadata } from "next";
import type { ReactNode } from "react";
import { can } from "@repo/security";
import { getSessionContext } from "./lib/auth";
import { isSupabaseConfigured } from "./lib/supabase/config";
import RootShell from "./root-shell";
import "./globals.css";
import "./public-shell.css";
import "./mobile-marketing.css";
import "./workspace-mobile.css";
import "./workspace-mobile-corrections.css";

export const metadata: Metadata = {
  title: "AI Account Prioritization | Verified Sales Priorities",
  description:
    "Turn verified CRM signals into a ranked daily sales plan with evidence, next-best actions, and human approval.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const ctx = await getSessionContext();
  const demo = !isSupabaseConfigured();
  const identity = ctx
    ? {
        email: ctx.email ?? null,
        role: ctx.role,
        canViewTeamCoverage: can(ctx.role, "view_team_coverage"),
        canEditScoringConfig: can(ctx.role, "edit_scoring_config"),
      }
    : null;

  return (
    <html lang="en">
      <body>
        <RootShell identity={identity} demo={demo}>
          {children}
        </RootShell>
      </body>
    </html>
  );
}
