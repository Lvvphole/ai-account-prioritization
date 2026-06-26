import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Server-side, RLS-aware Supabase client.
 *
 * Pass the signed-in user's access token (e.g. from the Supabase auth cookie/
 * session) so Postgres RLS evaluates as that user. With no token it behaves as
 * an anonymous client. This client NEVER uses the service role key.
 *
 * NOTE: the Next.js cookie-bound SSR client (@supabase/ssr) is introduced in the
 * web-auth sprint; this token-based factory is the framework-agnostic core.
 */
export type TypedSupabaseClient = SupabaseClient<Database>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function createServerSupabaseClient(accessToken?: string): TypedSupabaseClient {
  const headers: Record<string, string> = {};
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  return createClient<Database>(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: { headers },
    },
  );
}
