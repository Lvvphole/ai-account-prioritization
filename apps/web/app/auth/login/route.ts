import { NextResponse, type NextRequest } from "next/server";
import { getAppRole } from "@repo/supabase-client";
import { createClient } from "../../lib/supabase/server";
import { isSupabaseConfigured } from "../../lib/supabase/config";
import { roleHome } from "../../lib/auth";

/** Email + password sign-in. Sets the session cookies, then redirects. */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url, { status: 303 });
  }

  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const requested = String(formData.get("redirectTo") ?? "/dashboard");
  const redirectTo = requested.startsWith("/") ? requested : "/dashboard";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  const url = request.nextUrl.clone();
  url.search = "";
  if (error || !data.user) {
    url.pathname = "/login";
    url.searchParams.set("error", "Invalid email or password.");
    url.searchParams.set("redirectTo", redirectTo);
  } else {
    // Honor an explicit destination (e.g. a protected page) else go to the
    // role's home so Reps and Managers land on the right view.
    const role = (await getAppRole(supabase, data.user.id)) ?? "rep";
    url.pathname = requested === "/dashboard" ? roleHome(role) : redirectTo;
  }
  return NextResponse.redirect(url, { status: 303 });
}
