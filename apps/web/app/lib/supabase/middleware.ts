import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createSsrServerClient } from "@repo/supabase-client";

/**
 * Refresh the Supabase auth session on every request and surface the current
 * user. Follows the documented @supabase/ssr Next.js middleware pattern: cookies
 * are read from the request and written to BOTH the request (for downstream
 * server components) and the response (for the browser).
 */
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request });

  const supabase = createSsrServerClient({
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
