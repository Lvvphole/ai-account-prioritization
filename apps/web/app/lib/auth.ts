import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppRole, type AppRole } from "@repo/supabase-client";
import { can, type Capability } from "@repo/security";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";

export interface SessionContext {
  userId: string;
  email: string | null;
  role: AppRole;
}

export const APP_ROLES: readonly AppRole[] = ["rep", "manager", "admin"];

/** The home page a role lands on after signing in. */
export function roleHome(role: AppRole): string {
  // Managers and admins start at the oversight view; reps at their plan.
  return role === "rep" ? "/dashboard" : "/manager";
}

function normalizeRole(value: string | undefined): AppRole {
  return value === "manager" || value === "admin" || value === "rep" ? value : "rep";
}

/** Resolve the signed-in user + app role, or null when unauthenticated. */
export async function getSessionContext(): Promise<SessionContext | null> {
  if (!isSupabaseConfigured()) {
    // Demo mode: the chosen role is carried in a cookie so Rep vs Manager vs
    // Admin each get a coherent portal experience.
    const role = normalizeRole((await cookies()).get("demo_role")?.value);
    return { userId: "demo", email: `demo · ${role}`, role };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  // Fail-closed to least privilege if no profile role is visible.
  const role = (await getAppRole(supabase, user.id)) ?? "rep";
  return { userId: user.id, email: user.email ?? null, role };
}

/** Require a session; redirect unauthenticated users to /login. */
export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/**
 * Require a capability (RBAC, via @repo/security). Unauthenticated -> /login;
 * authenticated-but-forbidden -> back to the dashboard with a denied flag.
 */
export async function requireCapability(capability: Capability): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!can(ctx.role, capability)) redirect("/dashboard?denied=1");
  return ctx;
}
