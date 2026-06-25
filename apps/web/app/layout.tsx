import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Account Prioritization",
  description: "Verified daily sales action plans for B2B teams.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <strong>AI Account Prioritization</strong>
          <a href="/dashboard">Rep Dashboard</a>
          <a href="/manager">Manager</a>
          <a href="/admin/scoring">Admin · Scoring</a>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
