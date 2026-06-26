import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Service-role Supabase client. BYPASSES RLS — use ONLY in trusted server
 * contexts (agent runtime, migrations, background jobs), never in the browser
 * and never behind a user-supplied token.
 *
 * Isolation rule (Execution Rules #6, security): keep service-role usage
 * confined to this module's callers and audit every privileged action.
 */
export type TypedSupabaseClient = SupabaseClient<Database>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

let cached: TypedSupabaseClient | null = null;

export function createServiceRoleClient(): TypedSupabaseClient {
  if (cached) return cached;
  cached = createClient<Database>(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
  return cached;
}

/** Test/seam helper: reset the cached service-role client. */
export function __resetServiceRoleClient(): void {
  cached = null;
}
