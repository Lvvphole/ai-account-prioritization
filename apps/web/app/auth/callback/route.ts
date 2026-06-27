import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "../../lib/supabase/server";
import { isSupabaseConfigured } from "../../lib/supabase/config";

/** OAuth / magic-link callback: exchange the code for a session, then redirect. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  if (!isSupabaseConfigured()) return NextResponse.redirect(`${origin}/dashboard`);

  const code = searchParams.get("code");
  const requested = searchParams.get("next") ?? "/dashboard";
  const next = requested.startsWith("/") ? requested : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=Could not sign in.`);
}
