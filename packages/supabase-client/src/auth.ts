import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/** Auth helpers shared across server and browser contexts. */
export type AppRole = Database["public"]["Enums"]["app_role"];

/** Resolve the current user from a client, or null if unauthenticated. */
export async function getUser(
  client: SupabaseClient<Database>,
): Promise<User | null> {
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user;
}

/** Resolve the current user or throw — for protected server paths. */
export async function requireUser(
  client: SupabaseClient<Database>,
): Promise<User> {
  const user = await getUser(client);
  if (!user) throw new Error("Unauthenticated: a signed-in user is required.");
  return user;
}

/**
 * Resolve the app role for a user via the profiles table (RLS-aware).
 * Returns null when no profile row is visible/found.
 */
export async function getAppRole(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<AppRole | null> {
  const { data, error } = await client
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data.role;
}
