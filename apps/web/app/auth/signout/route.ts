import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "../../lib/supabase/server";
import { isSupabaseConfigured } from "../../lib/supabase/config";

/** Sign out and return to the login page. */
export async function POST(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.search = "";

  if (!isSupabaseConfigured()) {
    // No real session in demo mode; just return to the dashboard.
    url.pathname = "/dashboard";
    return NextResponse.redirect(url, { status: 303 });
  }

  const supabase = await createClient();
  await supabase.auth.signOut();

  url.pathname = "/login";
  return NextResponse.redirect(url, { status: 303 });
}
