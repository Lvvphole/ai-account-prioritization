import { cookies } from "next/headers";
import { createSsrServerClient, type TypedSupabaseClient } from "@repo/supabase-client";

/**
 * Server-side, RLS-aware Supabase client bound to the request cookies (Next.js
 * App Router). Use in Server Components, Route Handlers, and Server Actions.
 */
export async function createClient(): Promise<TypedSupabaseClient> {
  const cookieStore = await cookies();
  return createSsrServerClient({
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      } catch {
        // Called from a Server Component (cookies are read-only there); the
        // middleware refreshes the session cookies, so this is safe to ignore.
      }
    },
  });
}
