/**
 * Whether Supabase auth is configured for this environment.
 *
 * When false (e.g. an env-less preview/production deploy), the web app runs in a
 * no-auth DEMO mode instead of crashing: the SSR client requires these public
 * vars, so middleware/server code that calls it would otherwise throw a
 * site-wide `MIDDLEWARE_INVOCATION_FAILED`. Set both vars to enable real auth.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
