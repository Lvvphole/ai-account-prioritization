import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import type { AppRole } from "@repo/supabase-client";
import { roleHome } from "../../lib/auth";

/**
 * Demo-mode role entry: pick Rep / Manager / Admin (no real auth configured).
 * Stores the choice in a cookie so the portal reflects that role, then routes
 * to the role's home.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const raw = String(form.get("role") ?? "rep");
  const role: AppRole = raw === "manager" || raw === "admin" ? (raw as AppRole) : "rep";

  (await cookies()).set("demo_role", role, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });

  // Honor the page the visitor was heading for before being sent to the picker,
  // else drop them at the role's home. Only same-site absolute paths ("//host"
  // is protocol-relative and would leave the app).
  const requested = String(form.get("redirectTo") ?? "");
  const safe =
    requested.startsWith("/") && !requested.startsWith("//") ? requested : null;

  const url = request.nextUrl.clone();
  url.pathname = safe ?? roleHome(role);
  url.search = "";
  return NextResponse.redirect(url, { status: 303 });
}
