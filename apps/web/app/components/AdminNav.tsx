"use client";

import { usePathname } from "next/navigation";

/**
 * Control-plane section nav. The deterministic scorer (Decision Policy) and the
 * generative drafter (AI Drafting) are deliberately separate entries: they have
 * different risks, metrics, release processes and rollback paths, so collapsing
 * them into one "AI settings" tab would hide the boundary that matters most.
 */
const SECTIONS: { href: string; label: string; hint: string }[] = [
  { href: "/admin", label: "Overview", hint: "Production health, outcomes, open risks" },
  { href: "/admin/data", label: "Data & Integrations", hint: "Source health, mappings, freshness, lineage" },
  { href: "/admin/policy", label: "Decision Policy", hint: "Deterministic scoring, weights, thresholds" },
  { href: "/admin/drafting", label: "AI Drafting", hint: "Models, prompts, schemas, allowed actions" },
  { href: "/admin/evals", label: "Evals & Experiments", hint: "Quality tests, regressions, lift" },
  { href: "/admin/guardrails", label: "Guardrails & Approvals", hint: "Holds, policy failures, approval rules" },
  { href: "/admin/runs", label: "Runs & Recommendations", hint: "Inspect a single decision" },
  { href: "/admin/users", label: "Users & Roles", hint: "RBAC, teams, account access" },
  { href: "/admin/audit", label: "Audit & Incidents", hint: "Immutable changes and investigations" },
  { href: "/admin/environments", label: "Environments", hint: "Development, staging, production" },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="cp-nav" aria-label="Admin sections">
      {SECTIONS.map((s) => {
        const active = s.href === "/admin" ? pathname === "/admin" : pathname.startsWith(s.href);
        return (
          <a
            key={s.href}
            href={s.href}
            className={`cp-tab${active ? " active" : ""}`}
            title={s.hint}
            aria-current={active ? "page" : undefined}
          >
            {s.label}
          </a>
        );
      })}
    </nav>
  );
}
