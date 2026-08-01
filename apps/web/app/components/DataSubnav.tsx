"use client";

import { usePathname } from "next/navigation";

/**
 * Sub-nav for the Data & Integrations section.
 *
 * Imports, quarantine and triggers are separate destinations rather than tabs
 * inside the source-health page: each is a queue somebody works through, and a
 * queue that lives inside another screen's tab is a queue nobody links to.
 */
const PAGES: { href: string; label: string; hint: string }[] = [
  { href: "/admin/data", label: "Sources", hint: "Connection health, freshness, lineage" },
  { href: "/admin/data/imports", label: "Imports", hint: "Manual CSV imports and their change sets" },
];

export default function DataSubnav() {
  const pathname = usePathname();

  return (
    <nav className="subnav" aria-label="Data sections">
      {PAGES.map((p) => {
        const active =
          p.href === "/admin/data" ? pathname === "/admin/data" : pathname.startsWith(p.href);
        return (
          <a
            key={p.href}
            href={p.href}
            className={`subnav-tab${active ? " active" : ""}`}
            title={p.hint}
            aria-current={active ? "page" : undefined}
          >
            {p.label}
          </a>
        );
      })}
    </nav>
  );
}
