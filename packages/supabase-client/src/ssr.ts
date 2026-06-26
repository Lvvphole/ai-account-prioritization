import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Cookie-bound SSR Supabase client — the `@supabase/ssr` adapter deferred from
 * Sprint 2.
 *
 * Framework-agnostic: the caller supplies the cookie get/set adapter (e.g. a
 * Next.js `cookies()` binding). Uses the PUBLIC anon env so the client is
 * RLS-scoped to the signed-in user; it NEVER uses the service-role key.
 */
export type TypedSupabaseClient = SupabaseClient<Database>;

/** The cookie adapter shape expected by `@supabase/ssr` (getAll / setAll). */
export type SsrCookieAdapter = CookieMethodsServer;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function createSsrServerClient(cookies: SsrCookieAdapter): TypedSupabaseClient {
  // The runtime object is a SupabaseClient<Database>; the cast bridges a generic
  // arity mismatch between @supabase/ssr's and @supabase/supabase-js's
  // SupabaseClient types, while keeping full Database typing for consumers.
  return createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { cookies },
  ) as unknown as TypedSupabaseClient;
}
