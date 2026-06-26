import { redirect } from "next/navigation";
import { getAppRole, type AppRole } from "@repo/supabase-client";
import { can, type Capability } from "@repo/security";
import { createClient } from "./supabase/server";

export interface SessionContext {
  userId: string;
  email: string | null;
  role: AppRole;
}

/** Resolve the signed-in user + app role, or null when unauthenticated. */
export async function getSessionContext(): Promise<SessionContext | null> {
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
