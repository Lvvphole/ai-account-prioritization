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

  const url = request.nextUrl.clone();
  url.pathname = roleHome(role);
  url.search = "";
  return NextResponse.redirect(url, { status: 303 });
}
